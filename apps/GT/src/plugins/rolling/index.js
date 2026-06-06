/**
 * Amount rolling animation — slot-machine style digit reels.
 * GPU-accelerated via transform; only diffed cells re-animate.
 *
 * Per-digit DOM uses TWO swappable rows (rowA on top, rowB below):
 *   1. Set rowB.textContent = new digit.
 *   2. Animate reel transform: 0 → -1em (rowB slides into view).
 *   3. On end: snap reel back to 0 with transition disabled, sync rowA = new digit.
 *
 * Length rule:
 *   render length = max(from.length, latest value.length)
 *   - from.length acts as an immutable floor; below it the value is left-padded with "0".
 *   - Above the floor, DOM grows/shrinks at the front while keeping existing cells intact.
 *
 * Length-change animation:
 *   Grow:   new front cells are created empty (value = -1, rowA = "") and "roll in"
 *           only when their staggered turn arrives — until then they occupy 1ch of
 *           layout space but render nothing.
 *   Shrink: old front cells are NOT removed immediately. They're marked `leaving`
 *           and animated to empty (rowB = "", reel slides), then detached from the
 *           DOM when their own animation timer fires.
 *   The "hidden" state reuses the reel's transform animation — same GPU path as
 *   digit-to-digit, no extra layout/paint properties involved.
 */

const DEFAULTS = {
    duration: 700,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    stagger: 40,
    staggerFrom: "right",
};

const STYLE_ID = "__rolling_style__";

const CSS = `
.rolling-root {
    display: inline-flex;
    align-items: stretch;
    line-height: 1;
    font-variant-numeric: tabular-nums;
}
.rolling-cell {
    position: relative;
    display: inline-block;
    height: 1em;
    overflow: hidden;
    vertical-align: top;
}
.rolling-cell-digit { width: 1ch; }
.rolling-reel {
    display: flex;
    flex-direction: column;
    will-change: transform;
    backface-visibility: hidden;
}
.rolling-reel > span {
    height: 1em;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.rolling-static {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1em;
}
`;

let styleInjected = false;
function ensureStyle() {
    if (styleInjected || typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) {
        styleInjected = true;
        return;
    }
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
    styleInjected = true;
}

const isDigit = (c) => c >= "0" && c <= "9";

const digitText = (v) => (v < 0 ? "" : String(v));

function makeDigitCell(value) {
    const el = document.createElement("span");
    el.className = "rolling-cell rolling-cell-digit";
    const reel = document.createElement("span");
    reel.className = "rolling-reel";
    const rowA = document.createElement("span");
    rowA.textContent = digitText(value);
    const rowB = document.createElement("span");
    rowB.textContent = "";
    reel.appendChild(rowA);
    reel.appendChild(rowB);
    reel.style.transform = "translate3d(0, 0, 0)";
    el.appendChild(reel);
    return {
        kind: "digit",
        el,
        reel,
        rowA,
        rowB,
        value,           // -1 = empty, 0-9 = settled digit
        pendingTo: null, // null = no in-flight; -1 = animating to empty; 0-9 = animating to digit
        generation: 0,
        leaving: false,  // remove from DOM after current animation completes
    };
}

function makeStaticCell(char) {
    const el = document.createElement("span");
    el.className = "rolling-cell rolling-static";
    el.textContent = char;
    return { kind: "static", el, char };
}

function structureMatches(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const da = isDigit(a[i]);
        const db = isDigit(b[i]);
        if (da !== db) return false;
        if (!da && a[i] !== b[i]) return false;
    }
    return true;
}

class Rolling {
    constructor(el, from, to, options) {
        this.el = el;
        this.from = from;
        this.to = to;
        this.current = from;
        this.options = { ...DEFAULTS, ...(options || {}) };
        this.cells = [];
    }

    init() {
        ensureStyle();
        this.el.classList.add("rolling-root");
        this.el.textContent = "";
        this.cells = [];

        const initLen = Math.max(this.from.length, this.to.length);
        const initialPadded = this.from.padStart(initLen, "0");
        const targetPadded = this.to.padStart(initLen, "0");

        this.build(initialPadded);
        this.current = initialPadded;

        if (this.from === this.to) return;

        if (structureMatches(initialPadded, targetPadded)) {
            this.current = targetPadded;
            requestAnimationFrame(() => this.animateTo(targetPadded));
        } else {
            this.rebuildWithText(targetPadded);
            this.current = targetPadded;
        }
    }

    update(value, options) {
        if (options) this.options = { ...this.options, ...options };

        // Drop any not-yet-finished leaving cells from a previous shrink so length
        // math below operates on the visible cell count, not stale DOM.
        this.finalizeLeaving();

        if (value === this.to) return;

        const newLen = Math.max(this.from.length, value.length);
        const targetPadded = value.padStart(newLen, "0");
        const sourceCurrent = this.current;

        const sourceAfter =
            newLen > sourceCurrent.length
                ? sourceCurrent.padStart(newLen, "0")
                : newLen < sourceCurrent.length
                ? sourceCurrent.slice(sourceCurrent.length - newLen)
                : sourceCurrent;

        if (!structureMatches(sourceAfter, targetPadded)) {
            this.snap(value);
            return;
        }

        let textAligned;
        if (newLen > sourceCurrent.length) {
            this.growFront(newLen - sourceCurrent.length);
            textAligned = targetPadded;
        } else if (newLen < sourceCurrent.length) {
            const diff = sourceCurrent.length - newLen;
            this.markFrontLeaving(diff);
            // Leading `diff` chars are placeholders; animateTo ignores text[i]
            // for cells with leaving=true and animates them to empty instead.
            textAligned = "0".repeat(diff) + targetPadded;
        } else {
            textAligned = targetPadded;
        }

        this.to = value;
        this.current = targetPadded;
        requestAnimationFrame(() => this.animateTo(textAligned));
    }

    snap(value) {
        const newLen = Math.max(this.from.length, value.length);
        const padded = value.padStart(newLen, "0");
        this.to = value;
        this.current = padded;
        this.rebuildWithText(padded);
    }

    destroy() {
        this.el.textContent = "";
        this.el.classList.remove("rolling-root");
        this.cells = [];
    }

    finalizeLeaving() {
        if (this.cells.length === 0) return;
        let any = false;
        for (const c of this.cells) {
            if (c.kind === "digit" && c.leaving) { any = true; break; }
        }
        if (!any) return;
        const remaining = [];
        for (const c of this.cells) {
            if (c.kind === "digit" && c.leaving) {
                c.generation++; // invalidate any pending removal timer
                c.el.remove();
            } else {
                remaining.push(c);
            }
        }
        this.cells = remaining;
    }

    markFrontLeaving(n) {
        for (let i = 0; i < n && i < this.cells.length; i++) {
            const c = this.cells[i];
            if (c.kind === "digit") c.leaving = true;
        }
    }

    removeCell(cell) {
        const idx = this.cells.indexOf(cell);
        if (idx !== -1) this.cells.splice(idx, 1);
        cell.el.remove();
    }

    build(text) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            const cell = isDigit(c) ? makeDigitCell(parseInt(c, 10)) : makeStaticCell(c);
            frag.appendChild(cell.el);
            this.cells.push(cell);
        }
        this.el.appendChild(frag);
    }

    rebuildWithText(text) {
        this.el.textContent = "";
        this.cells = [];
        this.build(text);
    }

    growFront(n) {
        const frag = document.createDocumentFragment();
        const newCells = [];
        for (let i = 0; i < n; i++) {
            // Empty (value = -1) — rowA is "" so the cell occupies 1ch of layout
            // but renders blank until its staggered turn slides a digit in via rowB.
            const cell = makeDigitCell(-1);
            frag.appendChild(cell.el);
            newCells.push(cell);
        }
        this.el.insertBefore(frag, this.el.firstChild);
        this.cells = [...newCells, ...this.cells];
    }

    animateTo(text) {
        const { duration, easing, stagger, staggerFrom } = this.options;

        const digitIndices = [];
        for (let i = 0; i < this.cells.length; i++) {
            if (this.cells[i].kind === "digit") digitIndices.push(i);
        }
        const total = digitIndices.length;

        // Pass 1: snap-cancel any in-flight animation whose target differs.
        let anyCancelled = false;
        for (let k = 0; k < total; k++) {
            const cell = this.cells[digitIndices[k]];
            const targetTo = cell.leaving ? -1 : parseInt(text[digitIndices[k]], 10);
            if (cell.pendingTo === targetTo) continue;
            if (cell.pendingTo !== null) {
                cell.value = cell.pendingTo;
                cell.rowA.textContent = digitText(cell.value);
                cell.reel.style.transition = "none";
                cell.reel.style.transform = "translate3d(0, 0, 0)";
                cell.pendingTo = null;
                anyCancelled = true;
            }
        }
        if (anyCancelled) void this.el.offsetWidth;

        // Pass 2: start new animations.
        for (let k = 0; k < total; k++) {
            const i = digitIndices[k];
            const cell = this.cells[i];
            const targetTo = cell.leaving ? -1 : parseInt(text[i], 10);

            if (targetTo === cell.value && cell.pendingTo === null) continue;
            if (cell.pendingTo === targetTo) continue;

            const gen = ++cell.generation;
            cell.rowB.textContent = digitText(targetTo);
            cell.pendingTo = targetTo;
            const isLeaving = cell.leaving;

            const delay =
                staggerFrom === "right" ? (total - 1 - k) * stagger : k * stagger;

            cell.reel.style.transition = `transform ${duration}ms ${easing} ${delay}ms`;
            cell.reel.style.transform = "translate3d(0, -1em, 0)";

            setTimeout(() => {
                if (cell.generation !== gen || cell.pendingTo === null) return;
                if (isLeaving) {
                    cell.pendingTo = null;
                    this.removeCell(cell);
                    return;
                }
                cell.value = cell.pendingTo;
                cell.pendingTo = null;
                cell.rowA.textContent = digitText(cell.value);
                cell.reel.style.transition = "none";
                cell.reel.style.transform = "translate3d(0, 0, 0)";
            }, duration + delay + 20);
        }
    }
}

function render(options) {
    const target =
        typeof options.el === "string"
            ? document.querySelector(options.el)
            : options.el;
    if (!(target instanceof HTMLElement)) {
        throw new Error("[rolling] target element not found");
    }
    const { el: _el, value, to, ...rest } = options;
    const inst = new Rolling(target, value, to ?? value, rest);
    inst.init();
    return inst;
}

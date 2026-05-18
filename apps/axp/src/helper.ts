import type { PluginLogger, Primitive } from './types';

declare const process: { env: { NODE_ENV?: string } };

/**
 * 编译期常量：
 *   - Vite / Rollup / esbuild / Webpack 等都会把 `process.env.NODE_ENV` 替换成字面量，
 *     生产构建中本常量折叠成 `false`，配合 `if (__DEV__) {...}` 整块被 DCE 掉。
 *   - 未走打包（直接 Node 运行测试）时退化成运行时判断，结果一致。
 */
export const __DEV__: boolean = process.env.NODE_ENV !== 'production';

/** Project-wide log namespace used for tagging. */
export const NS = '[http-plugins]';

/** No-op logger — used when `Core` is constructed without `debug: true`. */
export const NOOP_LOGGER: PluginLogger = {
    log: () => { },
    warn: () => { },
    error: () => { },
};

/** Default logger sink — wraps `console.*`. */
export const CONSOLE_LOGGER: PluginLogger = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

/* Browser DevTools support `%c` CSS substitution; Node terminals support ANSI
 * SGR codes. Detect once at module load and pick the right path. */
const IS_BROWSER =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { document?: unknown }).document !== 'undefined';

const BROWSER_TAG_STYLE =
    'background:#2563eb;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600';
const BROWSER_RESET_STYLE = '';

const ANSI_TAG = '\x1b[44;97m'; // bg blue, fg bright white
const ANSI_RESET = '\x1b[0m';

/** Decorate a logger so every line is prefixed with `tag` rendered in
 *  blue-background / white-foreground. Falls back gracefully on sinks that
 *  don't understand `%c` or ANSI — the tag still reads cleanly. */
export function tagged(base: PluginLogger, tag: string): PluginLogger {
    if (IS_BROWSER) {
        const fmt = `%c${tag}%c`;
        return {
            log: (...a) => base.log(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
            warn: (...a) => base.warn(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
            error: (...a) => base.error(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
        };
    }
    const colored = `${ANSI_TAG}${tag}${ANSI_RESET}`;
    return {
        log: (...a) => base.log(colored, ...a),
        warn: (...a) => base.warn(colored, ...a),
        error: (...a) => base.error(colored, ...a),
    };
}

/** Coerce `value | value[] | undefined` into a fresh `value[]`. */
export function asArray<X>(x: X | X[] | undefined): X[] {
    if (x == null) return [];
    return Array.isArray(x) ? [...x] : [x];
}


export class Type {
    private static readonly toString = Object.prototype.toString;

    private static stringify(val: unknown): string {
        return this.toString.call(val).slice(8, -1).toLowerCase();
    }

    // 判断是否为普通对象 (非 null, 非数组)
    static isObject(val: unknown): val is Record<string, any> {
        return this.stringify(val) === 'object';
    }

    static isArray(val: unknown): val is any[] {
        return Array.isArray(val);
    }

    static isString(val: unknown): val is string {
        return typeof val === 'string';
    }

    static isNumber(val: unknown): val is number {
        return typeof val === 'number';
    }

    static isFunction(val: unknown): val is Function {
        return typeof val === 'function';
    }

    static isDate(val: unknown): val is Date {
        return val instanceof Date;
    }

    static isNull(val: unknown): val is null {
        return val === null;
    }

    static isUndefined(val: unknown): val is undefined {
        return val === undefined;
    }

    // 针对 Map/Set 的判断
    static isMap(val: unknown): val is Map<any, any> {
        return val instanceof Map;
    }

    static isSet(val: unknown): val is Set<any> {
        return val instanceof Set;
    }

    static isPrimitive(val: unknown): val is Primitive {
        if (val === null) return true;
        const type = typeof val;
        return type !== 'object' && type !== 'function';
    }

    static falsy(val: unknown) {
        return val === void 0 || val === null || Number.isNaN(val)
    }
}




export function filterObjectEmpty<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v != null) // v != null 同时过滤了 null 和 undefined
    ) as Partial<T>;
};

/** 探测用的临时键 */
const PROBE_KEY = "__storage_probe__";
/** 避免随机源被固定时重复使用同一个探测键。 */
let probeId = 0;

/** 可探测的原生存储名 */
type NativeName = "localStorage" | "sessionStorage";

/**
 * 按名称探测原生存储是否可用（访问属性本身也可能抛 SecurityError，故一并放进 try）。
 * localStorage 与 sessionStorage 各自独立探测，互不影响。
 */
function _storage(name: NativeName): boolean {
  if (typeof window === "undefined") return false;
  try {
    const s = window[name];
    let key: string;
    do {
      key = `${PROBE_KEY}${Math.random().toString(36).slice(2)}_${probeId++}`;
    } while (s.getItem(key) !== null);
    try {
      s.setItem(key, "1");
    } finally {
      s.removeItem(key);
    }
    return true;
  } catch (e) {
    // 配额已满 ≠ 不支持：此时读取仍可用，写入失败由 proxy 的清理过期重试兜底；
    // 若按不支持处理会整体退回内存，反而读不到已落盘的数据
    return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
  }
}

/** 支持独立惰性探测的能力名。 */
type Capability = "storage" | "session" | "indexedDB";
/** 探测结果缓存；显式赋值仍可覆盖宿主能力。 */
const flags: Partial<Record<Capability, boolean>> = {};
/** 按能力名探测，IndexedDB getter 的访问也受异常保护。 */
function probe(name: Capability): boolean {
  if (name !== "indexedDB") return _storage(name === "storage" ? "localStorage" : "sessionStorage");
  try { return globalThis.indexedDB != null; } catch { return false; }
}
/** 运行环境能力；首次读取独立探测，导入时不访问浏览器 API。 */
export const supported = /*#__PURE__*/ (() => Object.defineProperties({} as Record<Capability, boolean>, Object.fromEntries(
  (["storage", "session", "indexedDB"] as const).map(name => [name, {
    enumerable: true,
    /** 首次访问才探测并缓存。 */
    get: () => flags[name] ??= probe(name),
    /** 保留显式能力覆盖契约。 */
    set: (value: boolean) => { flags[name] = value; },
  }]),
)))();

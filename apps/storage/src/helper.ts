/** 探测用的临时键 */
const PROBE_KEY = "__storage_probe__";

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
    s.setItem(PROBE_KEY, "1");
    s.removeItem(PROBE_KEY); // 探测后即清理，避免污染存储
    return true;
  } catch (e) {
    // 配额已满 ≠ 不支持：此时读取仍可用，写入失败由 proxy 的清理过期重试兜底；
    // 若按不支持处理会整体退回内存，反而读不到已落盘的数据
    return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
  }
}

/** 运行环境可用性标记：storage=localStorage，session=sessionStorage，indexedDB=IndexedDB */
export const supported = {
  storage: _storage("localStorage"),
  session: _storage("sessionStorage"),
  indexedDB: typeof indexedDB !== "undefined" && indexedDB !== null,
};

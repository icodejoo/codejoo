function _storage(): boolean {
  if (typeof window === "undefined") return false;
  const key = "__storage_probe__";
  try {
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key); // 探测后即清理，避免污染 localStorage
    return true;
  } catch (e) {
    // 配额已满 ≠ 不支持：此时读取仍可用，写入失败由 proxy 的清理过期重试兜底；
    // 若按不支持处理会整体退回内存，反而读不到已落盘的数据
    return e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
  }
}

export const supported = {
  storage: _storage(),
  indexedDB: typeof indexedDB !== "undefined" && indexedDB !== null,
};

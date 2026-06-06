function _storage(): boolean {
  if (typeof window === "undefined") return false;
  const key = "__storage_probe__";
  try {
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key); // 探测后即清理，避免污染 localStorage
    return true;
  } catch {
    return false;
  }
}

export const supported = {
  storage: _storage(),
  indexedDB: typeof indexedDB !== "undefined" && indexedDB !== null,
};

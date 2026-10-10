/** 已经提示过的开发警告键，保证每条只提示一次 */
const warned = new Set<string>();

/**
 * 是否开发模式：process.env.NODE_ENV 不是 production 即为开发。
 * 写成原样的 process.env.NODE_ENV 并包 try：打包器会静态替换它（生产构建里整段被摘掉），
 * 没有 process 也没被替换时（浏览器直引）读取抛错，按生产处理。
 * @returns 是否开发模式
 */
function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

/**
 * 开发模式下打印一次警告（同一个 key 只打一次）；生产模式什么都不做。
 * @param key 去重键
 * @param message 警告内容
 * @example warnOnce("engine:svg", "[skeletonizer] 没有注册 svg 方案");
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key) || !isDev()) return;
  warned.add(key);
  console.warn(message);
}

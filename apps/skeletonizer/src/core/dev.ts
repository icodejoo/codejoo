/** 已经提示过的开发警告键，保证每条只提示一次 */
const warned = new Set<string>();

/**
 * 打印一次警告（同一个 key 只打一次）。
 * 本函数自己不判断环境：每个调用点都要用下面的守卫包住，让使用方的打包器在生产构建里把整个调用（连同中文串）折叠掉。
 * 守卫写法（必须原样：process.env.NODE_ENV 会被打包器替换成字面量，vite dev 里是 "development"；没有 process 的浏览器直引抛 ReferenceError，由 catch 吞掉）：
 * `try { if (process.env.NODE_ENV !== "production") warnOnce(...) } catch {}`
 * @param key 去重键
 * @param message 警告内容
 * @example
 * try {
 *   if (process.env.NODE_ENV !== "production") warnOnce("engine:svg", "[skeletonizer] the svg scheme is not registered");
 * } catch {}
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

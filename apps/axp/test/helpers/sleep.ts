/**
 * 等待指定毫秒，测试里用来让出事件循环或等定时器。
 * @param ms 毫秒数
 * @returns 到时 resolve 的 Promise
 * @example await sleep(10);
 */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

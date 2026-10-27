import { BYPASS_TIMEOUT_MS } from './constants.ts';

/**
 * 等待指定毫秒。
 * @param ms 毫秒数
 * @returns 到时 resolve 的 Promise
 * @example await sleep(100);
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 旁路请求的原始结果：状态码与响应文本 */
export interface RawReply {
  /** HTTP 状态码 */
  status: number;
  /** 是否 2xx */
  ok: boolean;
  /** 响应体原文 */
  text: string;
}

/**
 * 发一个带统一超时的旁路 JSON 请求（不经过被测客户端），返回原始状态与文本，由调用方决定怎么解读。
 * @param url 完整地址
 * @param method HTTP 方法
 * @param body JSON 请求体，省略则不发 body
 * @param headers 额外请求头
 * @param onConnectError 连接失败时把原始异常转换成调用方自己的错误类型
 * @returns 状态码与响应文本
 * @example const r = await rawJson('http://127.0.0.1:9090/presets', 'GET', undefined, {}, (m) => new Error(m));
 */
export async function rawJson(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string>,
  onConnectError: (message: string) => Error,
): Promise<RawReply> {
  const h = body === undefined ? { ...headers } : { ...headers, 'content-type': 'application/json' };
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(BYPASS_TIMEOUT_MS),
    });
  } catch (e) {
    throw onConnectError(`连接失败: ${(e as Error).message}`);
  }
  return { status: res.status, ok: res.ok, text: await res.text() };
}

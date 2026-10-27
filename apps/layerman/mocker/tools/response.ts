import type { MockResponse } from './types'

const DEFAULT_DELAY = 2000

/** 按 HTTP 规范不允许带 body 的状态码。 */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

/** 生成 JSON 响应；无 body 状态码（204/205/304）改返回空 body，否则 Response.json 会抛 TypeError。 */
function jsonResponse(data: unknown, status: number): Response {
  if (NULL_BODY_STATUSES.has(status)) return new Response(null, { status })
  return Response.json(data, { status })
}

export function createResponse(): MockResponse {
  const resolve = Object.assign(
    <T>(data: T, code = 200): Response =>
      jsonResponse(data, code),
    {
      delay: async <T>(data: T, ms = DEFAULT_DELAY, code = 200): Promise<Response> => {
        await new Promise(r => setTimeout(r, ms))
        return jsonResponse(data, code)
      },
    },
  ) as MockResponse['resolve']

  const reject = Object.assign(
    (message: string, code = 500): Response =>
      jsonResponse({ error: message }, code),
    {
      delay: async (message: string, ms = DEFAULT_DELAY, code = 500): Promise<Response> => {
        await new Promise(r => setTimeout(r, ms))
        return jsonResponse({ error: message }, code)
      },
    },
  ) as MockResponse['reject']

  return { resolve, reject }
}

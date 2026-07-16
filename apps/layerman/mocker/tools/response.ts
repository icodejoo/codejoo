import type { MockResponse } from './types'

const DEFAULT_DELAY = 2000

export function createResponse(): MockResponse {
  const resolve = Object.assign(
    <T>(data: T, code = 200): Response =>
      Response.json(data, { status: code }),
    {
      delay: async <T>(data: T, ms = DEFAULT_DELAY, code = 200): Promise<Response> => {
        await new Promise(r => setTimeout(r, ms))
        return Response.json(data, { status: code })
      },
    },
  ) as MockResponse['resolve']

  const reject = Object.assign(
    (message: string, code = 500): Response =>
      Response.json({ error: message }, { status: code }),
    {
      delay: async (message: string, ms = DEFAULT_DELAY, code = 500): Promise<Response> => {
        await new Promise(r => setTimeout(r, ms))
        return Response.json({ error: message }, { status: code })
      },
    },
  ) as MockResponse['reject']

  return { resolve, reject }
}

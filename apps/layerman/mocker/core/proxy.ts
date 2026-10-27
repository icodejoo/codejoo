export async function proxyRequest(req: Request, targetBase: string, rewrittenPath?: string): Promise<Response> {
  const url = new URL(req.url)
  const pathname = rewrittenPath ?? url.pathname
  // 主机由 targetBase 固定，请求路径只作为 pathname 设置，避免 `//evil.com`、`/\evil.com` 改写目标主机
  const target = new URL(targetBase)
  target.pathname = pathname
  target.search = url.search
  return fetch(target.toString(), {
    method: req.method,
    headers: new Headers(req.headers),
    body: req.body,
    // @ts-ignore — required for streaming body passthrough in Bun
    duplex: 'half',
  })
}

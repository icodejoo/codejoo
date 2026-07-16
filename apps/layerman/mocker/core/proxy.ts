export async function proxyRequest(req: Request, targetBase: string, rewrittenPath?: string): Promise<Response> {
  const url = new URL(req.url)
  const pathname = rewrittenPath ?? url.pathname
  const target = new URL(pathname + url.search, targetBase)
  return fetch(target.toString(), {
    method: req.method,
    headers: new Headers(req.headers),
    body: req.body,
    // @ts-ignore — required for streaming body passthrough in Bun
    duplex: 'half',
  })
}

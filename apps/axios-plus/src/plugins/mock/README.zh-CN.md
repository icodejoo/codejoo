# `mock`

dev 下把请求 url 重写到 mock 服务器。生产环境通常用 `enable: import.meta.env.DEV` 让插件在编译期被 DCE 掉。

```ts
import mockPlugin from 'http-plugins/plugins/mock';

api.use(mockPlugin({
  enable: import.meta.env.DEV,
  mockUrl: 'http://localhost:4523',
  mock: false,                 // 默认不 mock；按请求 opt-in
}));

api.get('/api/x', { mock: true });                          // → http://localhost:4523/api/x
api.get('/api/y', { mock: { mockUrl: 'http://m2' } });      // → 自定义 mock host
```

URL 改写规则：

- **绝对 URL**（`http://prod/api/foo`）→ 去 origin，前接 `mockUrl`
- **相对 URL**（`/api/foo`）→ 简单拼接
- **未填 url** → 设 `baseURL = mockUrl`

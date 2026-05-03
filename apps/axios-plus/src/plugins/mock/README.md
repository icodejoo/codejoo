# `mock`

Rewrites request URLs to a mock server in development. Production builds typically wire `enable: import.meta.env.DEV` so this is a true compile-time no-op.

```ts
import mockPlugin from 'http-plugins/plugins/mock';

api.use(mockPlugin({
  enable: import.meta.env.DEV,
  mockUrl: 'http://localhost:4523',
  mock: false,                 // default: don't mock; opt-in per request
}));

api.get('/api/x', { mock: true });                          // → http://localhost:4523/api/x
api.get('/api/y', { mock: { mockUrl: 'http://m2' } });      // → custom mock host
```

URL rewrite cases:

- **Absolute URL** (`http://prod/api/foo`) → strip origin, prepend `mockUrl`
- **Relative URL** (`/api/foo`) → simple concat
- **No URL** → set `baseURL = mockUrl`

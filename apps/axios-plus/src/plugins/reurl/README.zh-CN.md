# `reurl`

请求发出前对 `config.url` 做两件事：

1. **路径变量替换** —— 把 `config.url` 中的 `{var}` / `[var]` / `:var` 用 `config.params` / `config.data` 中的同名值替换。
2. **分隔符规整** —— 让 `baseURL` 与 `url` 之间恰好 1 个 `/`，并压掉路径里出现的多余 `//`。

```ts
import reurlPlugin from 'http-plugins/plugins/reurl';
api.use(reurlPlugin());

api.get('/user/{id}', { id: 42 });        // → /user/42，params: {}
api.delete('/post/:id', undefined, { data: 99 });  // → /post/99

// baseURL='https://x.com/api'  +  url='users'  → url='/users'   （缺分隔符自动补）
// baseURL='https://x.com/api/' +  url='/users' → url='users'    （多分隔符自动去）
// url='https://x.com//a//b'                    → url='https://x.com/a/b' （path 段 // 压缩，protocol :// 不动）
```

## 选项

| 字段        | 默认值  | 含义 |
|-----------|------|------|
| `enable`   | `true`  | 总开关。`false` 直接跳过 install。 |
| `pattern`  | `/{([^}]+)}\|\[([^\]]+)]\|(?<!:):([^\s/?#&=]+)/g` | 占位符匹配正则。默认正则在 `:var` 形态加了负向断言 `(?<!:)` —— 绝对 URL 的 `://` 不会被错当成路径变量。 |
| `removeKey`| `true`  | 替换后从 `params` / `data` 中删除被命中的字段，避免它再以 query string / body 字段身份出现。 |
| `fixSlash` | `true`  | 规整 `baseURL` 与 `url` 间的 `/`，并压缩 url 自身 path 段中的连续 `//`（绝对 URL 的 `://` 保留）。 |

## 取值顺序

先 `params`，再 `data`（object 取同名字段，primitive 直接消费）。

## 重试请求短路

`isRetry(config) === true` 时拦截器提前 return —— 首发已经替换好 url，源字段也删了。
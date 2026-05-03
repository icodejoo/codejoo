export interface IReurlOptions {
    /** 是否启用插件 */
    enable?: boolean;
    /** 自定义 url 变量匹配规则 */
    pattern?: RegExp;
    /** 当 params/data被命中时，是否要从 params/data 中删除被命中的字段，默认 true */
    removeKey?: boolean;
    /**
     * 是否规整 baseURL 与 url 之间的分隔符
     *
     *   - 缺分隔符：`baseURL='https://x'` + `url='api'` → `url='/api'`
     *   - 多分隔符：`baseURL='https://x/'` + `url='/api'` → `url='api'`
     *   - 同时压缩 url 自身的连续 `//`（protocol `://` 不动）
     *
     * 默认 true。url 为绝对地址（含 protocol）时跳过 baseURL 拼接修正。
     */
    fixSlash?: boolean;
}
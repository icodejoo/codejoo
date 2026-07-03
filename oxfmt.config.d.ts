/**
 * monorepo 共享 fmt 配置。子工程通过 TS import 复用：
 *
 * ```ts
 * import { fmt as baseFmt } from "../../oxfmt.config";
 * const fmt = defineConfig({ ...baseFmt, /* per-package overrides * / });
 * export default { fmt };
 * ```
 *
 * 注意：oxfmt 不像 oxlint 有 `extends` 字段，所以走 ES module spread 而非 `extends: []`。
 * default export 必须是 `{ fmt: {...} }`（实测：flat OxfmtConfig 会报 "Expected a `fmt` field"）。
 */
declare const fmt: {
    printWidth: number;
    tabWidth: number;
    useTabs: false;
    semi: true;
    singleQuote: false;
    trailingComma: "all";
    endOfLine: "lf";
    ignorePatterns: string[];
};
export { fmt };
declare const _default: {
    fmt: {
        printWidth: number;
        tabWidth: number;
        useTabs: false;
        semi: true;
        singleQuote: false;
        trailingComma: "all";
        endOfLine: "lf";
        ignorePatterns: string[];
    };
};
export default _default;

/**
 * Web Component entry: importing this module registers `<pic-man>`.
 *
 * Web Component 入口:引入本模块即注册 `<pic-man>`。
 */
export * from "./element/index";

import { definePicMan } from "./element/index";

definePicMan();

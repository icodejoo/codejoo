export { default as counter } from "./core";
export type { Counter, IPlugin } from "./core/types";
export { createLazyObserver } from "./helper";
export * from "./count-up";
export * from "./count-down";
export * from "./plugins";
export { configure, resetAllDefaults } from "./config";
export type { ISharedOptions } from "./config";

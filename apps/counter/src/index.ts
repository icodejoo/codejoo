export { default as counter } from "./core";
export * from "./count-up";
export * from "./count-down";
// 懒加载观测：用于自定义 root/threshold 的 observer（其回调复用库内派发逻辑）
export { createLazyObserver, defaultObserver } from "./core/observer";

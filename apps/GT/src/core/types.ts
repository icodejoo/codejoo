export interface IPlugin {
  name: string;
  install(elapsed: number, dt: number): void;
  /** 插件暴露给 gt 的 API，会以 plugin.name 作为 key 挂到 gt 上 */
  api?: unknown;
}

/**
 * gt 的类型形状。每个插件通过 declare module "../core/types" 扩展此接口，
 * 在 register 被引入到编译图中时，gt 自动获得对应字段的类型。
 */
export interface Counter {
  start(): void;
  stop(): void;
  tick(dt: number): void;
  use(plugin: IPlugin): void;
}

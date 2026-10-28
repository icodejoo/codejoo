import { isPlainObject } from "./utils";

/** 请求级空字段表示继承，数组整体替换。 */
export type AxpOption<T, S = never> =
  | boolean
  | null
  | S
  | {
      /** 各字段依次继承插件配置和内置默认。 */
      [K in keyof T]?: T[K] | null;
    };

/** 插件与请求共享的关闭标记。 */
export interface IPluginSwitch {
  /** 显式 false 禁用本次能力。 */
  enable?: boolean;
}

/** 判断本次能力是否开启，非法选项沿用装配配置。
 * @param requestValue 请求级开关或选项。
 * @returns false 或普通对象的 enable:false 表示关闭。
 * @example `isEnabled({ enable: false }) // false`
 */
export function isEnabled(requestValue: unknown): boolean {
  return requestValue !== false && !(isPlainObject(requestValue) && requestValue.enable === false);
}

/** 统一解析请求开关、简写和对象覆盖；非法类型按省略处理。
 * @param request 请求选项，不会被调用或修改。
 * @param plugin 已由客户端保证开启的插件配置。
 * @param defaults 内置默认配置。
 * @param shorthand 识别已声明的简写，未识别返回 undefined。
 * @returns 生效配置的新对象，关闭时返回 null。
 * @example `resolveOption({ delay: 0 }, { delay: 20 }, { delay: 0 })`
 */
export function resolveOption<T extends object, D extends Partial<T>>(request: undefined, plugin: Partial<T>, defaults: D): T & Required<Pick<T, keyof D & keyof T>>;
export function resolveOption<T extends object, D extends Partial<T>>(
  request: unknown,
  plugin: Partial<T>,
  defaults: D,
  shorthand?: (value: unknown) => (Partial<T> & IPluginSwitch) | undefined,
): (T & Required<Pick<T, keyof D & keyof T>>) | null;
export function resolveOption<T extends object, D extends Partial<T>>(
  request: unknown,
  plugin: Partial<T>,
  defaults: D,
  shorthand?: (value: unknown) => (Partial<T> & IPluginSwitch) | undefined,
): (T & Required<Pick<T, keyof D & keyof T>>) | null {
  if (request === false) return null;
  const override = (isPlainObject(request) ? request : shorthand?.(request)) as (Partial<T> & IPluginSwitch) | undefined;
  if (override?.enable === false) return null;
  const resolved: Partial<T> = { ...defaults };
  for (const source of [plugin, override]) {
    if (!source) continue;
    for (const key of Object.keys(source) as (keyof T)[]) {
      const value = source[key];
      if (value != null) resolved[key] = value as T[keyof T];
    }
  }
  return resolved as T & Required<Pick<T, keyof D & keyof T>>;
}

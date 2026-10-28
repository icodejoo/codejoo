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

/** 合并内置默认之后的完整配置。 */
type TResolved<T, D> = T & Required<Pick<T, keyof D & keyof T>>;
/** 请求级简写识别：认得的值转成覆盖对象，其余类型一律返回 undefined。 */
type TShorthand<T> = (value: unknown) => (Partial<T> & IPluginSwitch) | undefined;

/** 统一解析请求开关、简写和对象覆盖；非法类型按省略处理。
 * @param request 请求选项，不会被调用或修改。
 * @param plugin 已由客户端保证开启的插件配置。
 * @param defaults 内置默认配置。
 * @param shorthand 识别已声明的简写，未识别返回 undefined。
 * @returns 生效配置的新对象，关闭时返回 null。
 * @example `resolveOption({ delay: 0 }, { delay: 20 }, { delay: 0 })`
 */
export function resolveOption<T extends object, D extends Partial<T>>(request: undefined, plugin: Partial<T>, defaults: D): TResolved<T, D>;
export function resolveOption<T extends object, D extends Partial<T>>(request: unknown, plugin: Partial<T>, defaults: D, shorthand?: TShorthand<T>): TResolved<T, D> | null;
export function resolveOption<T extends object, D extends Partial<T>>(request: unknown, plugin: Partial<T>, defaults: D, shorthand?: TShorthand<T>): TResolved<T, D> | null {
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
  return resolved as TResolved<T, D>;
}

/** 插件处理请求级选项的统一入口：关闭、省略、简写与对象覆盖一次判清。
 * `false` 与 `enable:false` 关闭；`true` 沿用插件配置；对象或认得的简写逐字段覆盖；
 * 省略或不认得的类型，需请求开启（optIn）的插件视为不开启，其余沿用插件配置。
 * @param value 请求级选项原值，不会被调用或修改。
 * @param base 插件装配期已解析好的配置，沿用时原样返回这个对象，调用方可据身份复用预处理结果。
 * @param defaults 内置默认配置。
 * @param shorthand 识别已声明的简写；对不认得的类型必须返回 undefined。
 * @param optIn 为 true 时省略或不认得的类型不开启，返回 null。
 * @returns 生效配置，不开启时返回 null。
 * @example `resolveRequestOption(ctx.request.cache, base, DEFAULTS, expiresShorthand, true)`
 */
export function resolveRequestOption<T extends object, D extends Partial<T>>(value: unknown, base: TResolved<T, D>, defaults: D, shorthand?: TShorthand<T>, optIn = false): TResolved<T, D> | null {
  if (value === false) return null;
  if (value === true) return base;
  const override = isPlainObject(value) ? value : shorthand?.(value);
  if (!override) return optIn ? null : base;
  return resolveOption(override, base, defaults);
}

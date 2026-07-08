const flag = "__jt__"; // json type tag

const ext = {
  map: "Map",
  set: "Set",
  date: "Date",
  bigint: "bigint",
} as const;

/** 被标记的特殊类型外壳 */
interface Tagged {
  [flag]: string;
  value: unknown;
}

// 严格外壳形状（恰好 flag+value 两键）而非仅存在性判断——降低与业务数据里恰好带同名字段的对象误撞的概率，
// 且能保证误判命中时不会静默丢掉外壳外的兄弟字段（形状不符则整体原样返回，见 replacer/reviver 的 default 分支）
function isTagged(v: unknown): v is Tagged {
  return typeof v === "object" && v !== null && flag in v && "value" in v && Object.keys(v).length === 2;
}

/**
 * 写入时把 JSON 原生不支持的类型转成 { [flag]: 类型, value: ... } 外壳。
 * - Date 自带 toJSON，replacer 收到的 value 已是 ISO 字符串，故从 this[key] 取原始值判别。
 * - 用 Object.prototype.toString 而非 instanceof，兼容跨 realm（iframe/worker）对象。
 */
function replacer(this: any, key: string, value: any) {
  const raw = this[key];
  if (typeof raw === "bigint") return { [flag]: ext.bigint, value: raw.toString() };
  switch (Object.prototype.toString.call(raw)) {
    case "[object Date]":
      return { [flag]: ext.date, value: raw.getTime() };
    case "[object Map]":
      return { [flag]: ext.map, value: [...raw] };
    case "[object Set]":
      return { [flag]: ext.set, value: [...raw] };
    default:
      return value;
  }
}

/**
 * 读取时把外壳还原成对应类型。
 * JSON.parse 自底向上调用 reviver，外壳的 value 在还原前已完成内部还原，
 * 因此 Map/Set 内嵌的 Date/bigint/Map 等都能正确递归恢复。
 */
function reviver(_key: string, value: any) {
  if (!isTagged(value)) return value;
  switch (value[flag]) {
    case ext.bigint:
      return BigInt(value.value as string);
    case ext.date:
      return new Date(value.value as number);
    case ext.map:
      return new Map(value.value as Iterable<[unknown, unknown]>);
    case ext.set:
      return new Set(value.value as Iterable<unknown>);
    default:
      return value;
  }
}

/**
 * 与 JSON 同名 API，额外支持 bigint / Date / Map / Set 的可逆序列化。
 * 方法不依赖 this，可安全解构传递（如作为 storage 的 serialize/deserialize）。
 */
export const JSONX = {
  stringify(value: any, space?: string | number): string {
    return JSON.stringify(value, replacer, space);
  },
  parse(text: string): any {
    return JSON.parse(text, reviver);
  },
};

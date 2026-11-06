import type { Codec } from "./interface";
/** 键转换缓存上限。 */
const LIMIT = 1024;
/** 有界缓存转换结果。 */
function cached(map: Map<string, string | null>, key: string, fn: () => string | null): string | null {
  if (map.has(key)) return map.get(key)!;
  if (map.size >= LIMIT) map.clear();
  const value = fn(); map.set(key, value); return value;
}
/** 创建不可变键空间；只转义命名空间里的 % 和冒号。 */
export function keyspace(namespace?: string, codec?: Codec) {
  const prefix = namespace ? namespace.replaceAll("%", "%25").replaceAll(":", "%3A") + ":" : "";
  const forward = new Map<string, string | null>(), reverse = new Map<string, string | null>();
  /** 解码物理键，复用逆向缓存。 */
  const decode = (key: string) => codec ? cached(reverse, key, () => codec.decode(key)) : key;
  return {
    prefix,
    /** 无键变换时可直接使用后端整库操作。 */
    plain: !prefix && !codec,
    /** 逻辑键转为物理键。 */
    full: (key: string) => codec ? cached(forward, prefix + key, () => codec.encode(prefix + key))! : prefix + key,
    /** 判断键的归属。 */
    owns: (key: string) => decode(key)?.startsWith(prefix) ?? false,
    /** 物理键恢复逻辑键。 */
    logical: (key: string) => (decode(key) ?? key).slice(prefix.length),
  };
}

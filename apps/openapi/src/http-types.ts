// paths.d.ts 中每个 (path, method) 的原始 entry：[response, request-tuple]
type Tuple = readonly [unknown, readonly unknown[]];
// self-referential constraint：要求 PathRefs 每个值都形如 { method: [resp, req] }
type RefsLike<R> = { [K in keyof R]: { [M in keyof R[K]]: Tuple } };

// 把 spec request 元组直接预编译成 rest 参数形态：
//   []           → [body?: undefined]   （spec 声明可空）
//   [payload: X] → [body: X]             （spec 必填）
type BodyTuple<Req> = Req extends readonly []
  ? [body?: undefined]
  : Req extends readonly [infer X]
    ? [body: X]
    : [body?: any];

/**
 * 由生成的 PathRefs 推导出完整的请求约束类型集合。
 *
 * 性能设计：
 *  - Method / PathsOf / Res / Body 全部 O(N×M) 预计算，调用点 O(1) 表查找。
 *  - 调用点（{@link Request}）的条件类型链路保持在 ≤ 2 层，对 IDE / tsserver 内存友好。
 *
 * @example
 * ```ts
 * import type { OpenApi, Request } from '@codejoo/openapi-to-lang'
 * import type { PathRefs } from './types/paths'
 *
 * type Api = OpenApi<PathRefs>
 * export const request: Request<PathRefs> = async (method, path, body) => { ... }
 * ```
 */
export type OpenApi<R extends RefsLike<R>> = {
  /** 所有路由路径字符串的联合类型 */
  Path: keyof R & string;

  /** 所有路由中 HTTP 方法字符串的联合类型 */
  Method: { [P in keyof R]: keyof R[P] & string }[keyof R];

  /** 各路径可用方法映射：`Api['MethodOf']['/pet']` → `'get' | 'post'` */
  MethodOf: { [P in keyof R & string]: keyof R[P] & string };

  /** `Api['PathsOf']['post']` → 拥有该 HTTP 方法的路径联合类型（IDE 补全过滤用） */
  PathsOf: {
    [M in { [P in keyof R]: keyof R[P] & string }[keyof R]]: {
      [P in keyof R & string]: M extends keyof R[P] ? P : never;
    }[keyof R & string];
  };

  /** `Api['Res']['/pet']['post']` → 响应类型（预计算） */
  Res: { [P in keyof R]: { [M in keyof R[P]]: R[P][M][0] } };

  /** `Api['Body']['/pet']['post']` → rest 参数元组（已展开为 `[body?: undefined]` 或 `[body: X]`） */
  Body: { [P in keyof R]: { [M in keyof R[P]]: BodyTuple<R[P][M][1]> } };
};

// ============================================================================
// Request 函数签名（消费者只需 `Request<PathRefs>`，无需再写任何条件类型）
// ============================================================================

// 调用点 path 参数的形态：
//   M 命中 spec → 该 method 下所有 path 字面量提示 + (string & {}) 兜底
//   M 未命中    → 任意字符串
type PathHint<A, M> = A extends { Method: infer KM; PathsOf: infer PM }
  ? M extends KM
    ? (M extends keyof PM ? PM[M] : never) | (string & {})
    : string & {}
  : string & {};

// 显式 R 优先，否则查 Res 表，未命中回退 any
type ResolveRes<A, R, M, P> = [unknown] extends [R]
  ? A extends { Res: infer T }
    ? P extends keyof T
      ? M extends keyof T[P]
        ? T[P][M]
        : any
      : any
    : any
  : R;

// 显式 Q 优先（强制 [body: Q]），否则查 Body 表，未命中回退 [body?: any]
type ResolveBody<A, Q, M, P> = [unknown] extends [Q]
  ? A extends { Body: infer T }
    ? P extends keyof T
      ? M extends keyof T[P]
        ? T[P][M]
        : [body?: any]
      : [body?: any]
    : [body?: any]
  : [body: Q];

// 内部签名：Refs 实例化的 OpenApi 作为闭包变量传入，避免每个泛型位置重复展开
type RequestSig<A> = A extends {
  Method: infer KM;
  PathsOf: any;
  Res: any;
  Body: any;
}
  ? <
      R = unknown,
      Q = unknown,
      const M extends KM | (string & {}) = KM,
      const P extends PathHint<A, M> = PathHint<A, M>,
    >(
      method: M,
      path: P,
      ...args: ResolveBody<A, NoInfer<Q>, M, P>
    ) => Promise<ResolveRes<A, NoInfer<R>, M, P>>
  : never;

/**
 * 根据 PathRefs 直接生成的 request 函数签名。
 *
 * 消费者只需：
 * ```ts
 * export const request: Request<PathRefs> = async (method, path, body) => { ... }
 * ```
 *
 * 类型规则：
 *  1. `request<R, Q>(...)` 显式泛型优先级最高，覆盖 spec 推断
 *  2. 未传 R → spec 响应类型；未传 Q → spec 请求体类型；spec 未命中 → any
 *  3. spec request 元组为空 (`[]`) → body 可选；非空 (`[payload: X]`) → body 必填
 *  4. 任意 method/path 字符串均可调用（兼容 mock / 第三方 / 未上线接口）
 */
export type Request<R extends RefsLike<R>> = RequestSig<OpenApi<R>>;

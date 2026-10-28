import { mergePatch, requestContext, type AxpContext } from "./context";
import { AXP_KINDS, type IAxpResponse } from "./response";
import { STAGE_BUILTINS } from "./stages";
import type {
  AxpMiddleware,
  AxpNext,
  AxpPlugin,
  AxpPluginInstance,
  AxpStage,
  AxpTap,
  IAxpInspection,
} from "./types";

/** 未指定阶段的自定义插件所在阶段。 */
const DEFAULT_STAGE: AxpStage = "attempt";
/** 按声明顺序从外到内的阶段，与阶段类型共用 STAGE_BUILTINS。 */
export const AXP_STAGES = Object.keys(STAGE_BUILTINS) as AxpStage[];
/** 自定义 pre 插件排在阶段内内置插件之前。 */
const PRE_ORDER = -1;
/** 自定义 post 插件排在阶段内内置插件之后。 */
const POST_ORDER = 100;

/** 一个挂载层在整条链中的排序位置。 */
interface IAxpPosition {
  /** 所在阶段。 */ stage: AxpStage;
  /** 阶段在链中的次序。 */ stageOrder: number;
  /** 阶段内的次序。 */ order: number;
}
/** 内置插件名到固定位置的索引，排序时按名字直接定位。 */
const BUILTIN_POSITIONS = new Map<string, IAxpPosition>();
for (const [stageOrder, stage] of AXP_STAGES.entries()) {
  for (const [order, name] of STAGE_BUILTINS[stage].entries()) {
    BUILTIN_POSITIONS.set(name, { stage, stageOrder, order });
  }
}

/** 已 setup 的插件注册记录。 */
export interface IAxpRegistration<R extends IAxpResponse> {
  /** extend 复用的插件定义。 */ plugin: AxpPlugin<R, any>;
  /** 当前客户端的独立实例。 */ instance: AxpPluginInstance<R, any>;
}
/** 编译后的挂载层。 */
export interface IAxpLayer<R extends IAxpResponse> extends IAxpInspection {
  /** 已编译的中间件。 */ readonly handle: AxpMiddleware<R>;
}

/** 两个回调都没写的 tap 只占位，直接转交内层。 */
const passThrough: AxpMiddleware<any> = (_ctx, next) => next();

/** 按实际写了哪些回调选择中间件变体，缺失的回调不 await。 */
function tapMiddleware<R extends IAxpResponse>({
  onRequest,
  onResponse,
}: AxpTap<R>): AxpMiddleware<R> {
  if (!onRequest && !onResponse) return passThrough;
  if (!onResponse) {
    return /** 只在进入内层前补丁请求。 */ async (ctx, next) =>
      next((await onRequest!(ctx)) || undefined);
  }
  if (!onRequest) {
    return /** 只在内层返回后改写响应。 */ async (ctx, next) => {
      const response = await next();
      return (await onResponse(response, ctx)) ?? response;
    };
  }
  return /** 进入前补丁请求，返回后改写响应。 */ async (ctx, next) => {
    const response = await next((await onRequest(ctx)) || undefined);
    return (await onResponse(response, ctx)) ?? response;
  };
}

/** 校验自定义阶段并算出阶段内位置；未知阶段直接抛错。 */
function position(stage: AxpStage, enforce: AxpPlugin["enforce"]): IAxpPosition {
  const stageOrder = AXP_STAGES.indexOf(stage);
  if (stageOrder < 0) throw new Error(`Unknown stage: ${stage}`);
  return { stage, stageOrder, order: enforce === "pre" ? PRE_ORDER : POST_ORDER };
}

/** 校验重名与阶段，独立排序所有 taps。
 * @param registrations 客户端的插件实例。
 * @returns 按阶段和阶段内位置稳定排序的挂载层。
 * @example `const layers = sortPipeline(registrations)`
 */
export function sortPipeline<R extends IAxpResponse>(
  registrations: readonly IAxpRegistration<R>[],
): IAxpLayer<R>[] {
  const names = new Set<string>();
  const layers: (IAxpLayer<R> & IAxpPosition)[] = [];
  for (const { plugin, instance } of registrations) {
    if (names.has(plugin.name)) throw new Error(`Duplicate plugin: ${plugin.name}`);
    names.add(plugin.name);
    if (plugin.enable === false) continue;
    const handle = instance.handle ?? plugin.handle;
    if (handle) {
      // 自定义阶段先校验；内置名称再按名字覆盖为固定位置，位置不依赖插件自述。
      const custom = position(plugin.stage ?? DEFAULT_STAGE, plugin.enforce);
      layers.push({ name: plugin.name, ...(BUILTIN_POSITIONS.get(plugin.name) ?? custom), handle });
    }
    for (const [index, tap] of (instance.taps ?? plugin.taps ?? []).entries()) {
      layers.push({
        name: `${plugin.name}#${index}`,
        ...position(tap.stage, tap.enforce),
        handle: tapMiddleware(tap),
      });
    }
  }
  return layers.toSorted(
    /** 阶段优先，同位置保持注册次序。 */ (a, b) =>
      a.stageOrder - b.stageOrder || a.order - b.order,
  );
}

/** 给一层中间件加上异常边界：同步抛错与异步拒绝都转为 internal 响应。 */
function guardLayer<R extends IAxpResponse>(
  handle: AxpMiddleware<R>,
  inner: (ctx: AxpContext<R>) => Promise<R>,
): (ctx: AxpContext<R>) => Promise<R> {
  return /** 本层执行器：外层总能拿到响应，不会收到拒绝。 */ async (ctx) => {
    /** 无补丁直接复用上下文，有补丁才派生；合并补丁时的同步异常（如 getter 抛错）转 internal。 */
    const next: AxpNext<R> = (patch) => {
      let target = ctx;
      try {
        if (patch) target = requestContext(ctx, mergePatch(ctx.request, patch), patch);
      } catch (error) {
        return Promise.resolve(ctx.fail({ kind: AXP_KINDS.INTERNAL, error }));
      }
      return inner(target);
    };
    try {
      return await handle(ctx, next);
    } catch (error) {
      return ctx.fail({ kind: AXP_KINDS.INTERNAL, error });
    }
  };
}

/** 由内向外逐层包装；每层自带异常边界，传输自身负责自己的兜底。
 * @param layers 已排序的层快照。
 * @param transport 自带异常边界的最内层传输。
 * @returns 可供逻辑请求复用的执行器。
 * @example `const run = composePipeline(layers, transport)`
 */
export function composePipeline<R extends IAxpResponse>(
  layers: readonly IAxpLayer<R>[],
  transport: (ctx: AxpContext<R>) => Promise<R>,
): (ctx: AxpContext<R>) => Promise<R> {
  let run = transport;
  for (let index = layers.length - 1; index >= 0; index--) {
    run = guardLayer(layers[index]!.handle, run);
  }
  return run;
}

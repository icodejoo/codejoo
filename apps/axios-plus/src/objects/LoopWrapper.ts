export interface ILoopWrapperOptions {
    /** 完成与下一轮之间的间隔（ms）；默认 1000 */
    interval?: number;
    /** 立即开第一轮（否则等 interval 后开始）；默认 true */
    immediate?: boolean;
}


const DEFAULT_INTERVAL = 1000;


/**
 * 轮询包装器 —— 反复调用一个请求工厂，每轮结果通过 `.then` 派发，错误通过 `.catch` 派发。
 *
 *   - **构造**：`(producer, config?)` —— 任意 `() => Promise<R>` thunk；R 自动推断
 *     - 直接传 `api.get('/...')` 这类 [HttpDispatch]（无 payload 路径）
 *     - 需要 payload 的请求自己包一层：`() => api.post('/...')(body)`
 *   - **then 多次触发**：每轮成功都按注册顺序回调所有 `.then`
 *   - **catch 兜底**：未注册 `.catch` ⇒ 错误被吞 + `console.error`；注册后由 catch 处理
 *   - **节奏**：上一轮 settle 之后再等 `interval` 毫秒才开下一轮，**不并发 / 不重叠**
 *   - **start / stop / dispose**：构造时按 `immediate` 自动启动；可手动 stop 后再 start；
 *     dispose 永久停止并清空回调（不可再 start）
 *
 * @example
 *   const api = create<model.PathRefs>();
 *   new LoopWrapper(api.get('/store/inventory'), { interval: 5000 })
 *     .then((data) => render(data))   // data: Record<string, number>，PathRefs 自动推断
 *     .catch((e) => console.warn('poll failed:', e));
 */
export default class LoopWrapper<R = unknown> {
    readonly #produce: () => Promise<R>;
    readonly #interval: number;
    readonly #thens: Array<(v: R) => void> = [];
    readonly #catches: Array<(e: unknown) => void> = [];
    #running = false;
    #timer?: ReturnType<typeof setTimeout>;
    #disposed = false;

    constructor(producer: () => Promise<R>, config?: ILoopWrapperOptions) {
        this.#produce = producer;
        this.#interval = config?.interval ?? DEFAULT_INTERVAL;
        if (config?.immediate ?? true) this.start();
    }

    /** 注册结果回调；可多次注册，按顺序触发 */
    then(cb: (v: R) => void): this {
        if (!this.#disposed) this.#thens.push(cb);
        return this;
    }

    /** 注册错误回调；可多次注册，按顺序触发；**未注册时错误被吞** + `console.error` */
    catch(cb: (e: unknown) => void): this {
        if (!this.#disposed) this.#catches.push(cb);
        return this;
    }

    /** 启动轮询；幂等（已运行 / 已 dispose 时无效） */
    start(): this {
        if (this.#disposed || this.#running) return this;
        this.#running = true;
        void this.#tick();
        return this;
    }

    /** 停止轮询；幂等。可后续再 start */
    stop(): this {
        this.#running = false;
        if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
        return this;
    }

    /** 永久停止 + 清空回调；不可再 start */
    dispose(): void {
        this.stop();
        this.#disposed = true;
        this.#thens.length = 0;
        this.#catches.length = 0;
    }

    async #tick(): Promise<void> {
        if (!this.#running) return;
        try {
            const v = await this.#produce();
            if (!this.#running) return;
            for (const cb of this.#thens) {
                try {
                    cb(v);
                } catch (handlerErr) {
                    console.error("[LoopWrapper] then handler threw:", handlerErr);
                }
            }
        } catch (err) {
            if (this.#catches.length) {
                for (const cb of this.#catches) {
                    try {
                        cb(err);
                    } catch (handlerErr) {
                        console.error(
                            "[LoopWrapper] catch handler threw:",
                            handlerErr,
                        );
                    }
                }
            } else {
                console.error("[LoopWrapper] unhandled error:", err);
            }
        }
        if (!this.#running) return;
        this.#timer = setTimeout(() => void this.#tick(), this.#interval);
    }
}

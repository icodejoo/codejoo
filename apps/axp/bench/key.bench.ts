import { bench, describe } from "vitest";
import { requestKey } from "../src/key";
import type { AxpRequestConfig } from "../src/types";

/** 三轮独立测量，汇报时按每次耗时取中位数。 */
const ROUNDS = 3;
/** 各轮共用的预热和采样配置。 */
const MEASURE = {
  /** 每轮正式测量时长，单位毫秒。 */
  time: 1_000,
  /** 每轮预热时长，单位毫秒。 */
  warmupTime: 300,
  /** 每轮最少采样次数。 */
  iterations: 100,
};
/** 基准地址。 */
const BENCH_URL = "/key-bench";
/** 请求体方法。 */
const POST_METHOD = "post";
/** 保留返回值，避免测量结果被当作无用计算。 */
let sink: string | null = null;
/** 只构造一次的请求样本，测量仅包含 requestKey。 */
const CASES: [string, AxpRequestConfig][] = [
  [
    "小 params",
    {
      /** 普通查询方法。 */ method: "get",
      /** 基准地址。 */ url: BENCH_URL,
      /** 常用分页与筛选。 */ params: {
        /** 当前页。 */ page: 1,
        /** 每页数量。 */ size: 20,
        /** 查询文本。 */ query: "pets",
      },
    },
  ],
  [
    "中等嵌套 data",
    {
      /** 携带请求体。 */ method: POST_METHOD,
      /** 基准地址。 */ url: BENCH_URL,
      /** 订单与嵌套项目。 */ data: {
        /** 所属账号。 */ account: {
          /** 账号标识。 */ id: 42,
          /** 有效标志。 */ active: true,
        },
        /** 订单项目。 */ items: Array.from(
          { length: 24 },
          /** 生成稳定项目。 */ (_, index) => ({
            /** 产品标识。 */ id: index,
            /** 产品名称。 */ name: "product-" + index,
            /** 项目数量。 */ quantity: index + 1,
            /** 分类标签。 */ tags: ["sale", "featured"],
            /** 送货信息。 */ shipping: {
              /** 区域。 */ region: "cn",
              /** 默认地址。 */ address: "Shanghai",
              /** 空备注不贡献字段。 */ note: null,
            },
          }),
        ),
        /** 嵌套空容器仍参与摘要。 */ unused: { /** 空数组。 */ nested: [] },
      },
    },
  ],
  [
    "长字符串 data",
    {
      /** 携带请求体。 */ method: POST_METHOD,
      /** 基准地址。 */ url: BENCH_URL,
      /** 默认全量散列的长文本。 */ data: {
        /** 长文本正文。 */ content: "中文😀 payload:".repeat(1_024),
        /** 业务版本。 */ version: 1,
      },
    },
  ],
];

for (const [name, request] of CASES) {
  describe(
    name,
    /** 为每组输入测量三轮当前实现。 */ () => {
      for (let round = 1; round <= ROUNDS; round++) {
        bench(
          "current round " + round,
          /** 同一输入仅计算指纹。 */ () => {
            sink = requestKey(request);
          },
          MEASURE,
        );
      }
    },
  );
}
// 暴露消费端，方便基准工具检查结果未被丢弃。
export { sink };

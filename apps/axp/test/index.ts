import { create as createAxios } from "axios";
import { createAxp } from "../src/client";
import axpFilter from "../src/plugins/filter";

/** 新管线的 Schema 使用示例，默认归一化由内核提供。 */
const githubApi = createAxp<model.MethodRefs>({
  /** 示例传输实例。 */
  axios: createAxios({ baseURL: "https://api.github.com", adapter: "fetch" }),
  /** 过滤装上即生效。 */
  plugins: [axpFilter()],
});
/** 示例接口集合。 */
const testApi = {
  /** 查询宠物状态。 */
  query: githubApi.get("/pet/findByStatus"),
};
// @ts-expect-error 生成 schema 拒绝错误的状态参数。
await testApi.query({ status: 1 }, { key: "example" });

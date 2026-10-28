import { expect, it, vi } from "vitest";
import type { AxpPlugin } from "../../src/types";
import type { AxpResponse } from "../../src/response";
import { createTestClient } from "../helpers/client";

/** 装配测试 URL。 */
const URL = "/assembly";
it("[core.method.eject][core.method.inspect] 非 LIFO 卸载保持剩余中间件，快照修改不污染链", /** 非 LIFO 卸载保持剩余中间件，快照修改不污染链。 */ async () => {
  const events: string[] = [];
  const plugins = ["outer", "inner"].map(
    /** 按名称批量生成记录执行顺序的插件。 */ (name): AxpPlugin<AxpResponse> => ({
      name,
      /** 记录本层被执行，再交给内层。 */ async handle(_ctx, next) {
        events.push(name);
        return next();
      },
    }),
  );
  const { api } = createTestClient(plugins);
  const snapshot = api.inspect() as unknown as {
    /** name 字段。 */ name: string;
  }[];
  snapshot[0].name = "mutated";
  snapshot.pop();
  expect(api.inspect().map(/** 取当前链的插件名。 */ (row) => row.name)).toEqual(["outer", "inner"]);
  api.eject("outer");
  await api.get(URL)();
  expect(events).toEqual(["inner"]);
  api.eject("inner");
  await api.get(URL)();
  expect(events).toEqual(["inner"]);
  expect(api.plugin(plugins[0])).toBeUndefined();
  expect(api.eject("outer")).toBe(false);
});
it("[core.method.dispose] 逆序尽力清理并抛出第一个错，重复清理不再调用", /** 逆序尽力清理并抛出第一个错，重复清理不再调用。 */ () => {
  const events: string[] = [];
  const first = new Error("last installed");
  const last = new Error("first installed");
  const plugins = [last, first].map(
    /** 为每个清理异常生成一个插件。 */ (error, index): AxpPlugin<AxpResponse> => ({
      name: String(index),
      setup: /** 返回会抛错的清理函数。 */ () => ({
        dispose: /** 记录清理次序后抛出预置异常。 */ () => {
          events.push(String(index));
          throw error;
        },
      }),
    }),
  );
  const { api } = createTestClient([...plugins, { name: "no-cleanup" }]);
  const axios = api.axios;
  expect(/** 销毁时抛出首个清理异常。 */ () => api.dispose()).toThrow(first);
  expect(events).toEqual(["1", "0"]);
  expect(api.axios).toBe(axios);
  expect(api.inspect()).toEqual([]);
  expect(/** 重复销毁不再有副作用。 */ () => api.dispose()).not.toThrow();
});
it("[core.method.use][core.opt.plugins] 禁用插件也保留唯一名称，初始化失败会清理已装实例", /** 禁用插件也保留唯一名称，初始化失败会清理已装实例。 */ () => {
  const { api } = createTestClient([{ name: "disabled", enable: false }]);
  expect(/** 禁用插件仍占用名称。 */ () => api.use({ name: "disabled" })).toThrow("Duplicate");
  const dispose = vi.fn();
  expect(
    /** 初始化中途失败应清理已装插件。 */ () =>
      createTestClient([
        { name: "first", setup: /** 第一个插件正常装载并登记清理。 */ () => ({ dispose }) },
        {
          name: "invalid",
          setup: /** 第二个插件 setup 失败。 */ () => {
            throw new Error("setup");
          },
        },
      ]),
  ).toThrow("setup");
  expect(dispose).toHaveBeenCalledTimes(1);
});

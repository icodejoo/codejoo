import { expect, it } from "vitest";
import axpRepath from "../../src/plugins/repath";
import axpFilter from "../../src/plugins/filter";
import { preparedClient } from "../helpers/prepare";

/** 必须先用于路径替换的空白主键。 */
const BLANK_ID = " ";
/** 过滤器需要剥离的空文本。 */
const EMPTY_TEXT = "";
/** 请求准备阶段。 */
const PREPARE_STAGE = "prepare";

it("[repath.fn.axpRepath][filter.fn.axpFilter] 反向注册仍先消费路径变量再过滤空字段，来源不可变", /** prepare 固定顺序。 */ async () => {
  const { api, request } = preparedClient([axpFilter(), axpRepath()]);
  const params = Object.freeze({ id: BLANK_ID, nil: null, keep: 0 });
  const data = Object.freeze({ empty: EMPTY_TEXT, valid: false });
  const response = await api.request({ url: "/users/:id", params, data, throws: false });
  expect(response.request.url).toBe("/users/%20");
  expect(request().params).toEqual({ keep: 0 });
  expect(request().data).toEqual({ valid: false });
  expect(params).toEqual({ id: BLANK_ID, nil: null, keep: 0 });
  expect(data).toEqual({ empty: EMPTY_TEXT, valid: false });
  expect(api.inspect()).toEqual([
    { stage: PREPARE_STAGE, name: "axp:repath" },
    { stage: PREPARE_STAGE, name: "axp:filter" },
  ]);
  api.dispose();
});

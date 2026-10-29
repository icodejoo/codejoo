import { expect, it } from "vitest";
import { requestKey } from "../../src/key";

/** 二进制哈希上限，与契约中的字节数一致。 */
const BINARY_HASH_LIMIT = 65_536;
/** 请求体参与哈希的基准请求。 */
const REQUEST = { method: "post", url: "/binary" };
/** 二进制样本内容。 */
const CONTENT = [1, 2, 3];

/** 仅计算请求体的指纹。 */
function key(data: unknown) {
  return requestKey({ ...REQUEST, data });
}

it("[core.method.key] 同长二进制按每个字节区分，同内容跨容器得到相同 key", /** 覆盖 buffer、共享内存和各类视图。 */ () => {
  const bytes = new Uint8Array(CONTENT);
  const shared = new SharedArrayBuffer(bytes.byteLength);
  new Uint8Array(shared).set(bytes);
  const expected = key(bytes);
  expect(expected).not.toBeNull();
  expect(expected).not.toBe(key(new Uint8Array([9, 9, 9]).buffer));
  for (const value of [bytes.buffer, shared, new DataView(bytes.buffer), new Int8Array(bytes.buffer), Buffer.from(CONTENT)]) expect(key(value)).toBe(expected);
  expect(key(new Uint16Array([256]))).toBe(key(new Uint8Array(new Uint16Array([256]).buffer)));
  expect(key(bytes)).not.toBe(key("bin3"));
  expect(key(bytes)).not.toBe(key(new Uint8Array([...CONTENT, 0])));
});

it("[core.method.key] TypedArray、DataView、Buffer 只哈希自己的偏移窗口", /** 外部字节和底层缓冲区长度不参与。 */ () => {
  const bytes = new Uint8Array([8, ...CONTENT, 7]);
  const expected = key(new Uint8Array(CONTENT));
  for (const value of [bytes.subarray(1, 4), new DataView(bytes.buffer, 1, 3), Buffer.from(bytes.buffer, 1, 3)]) expect(key(value)).toBe(expected);
  bytes[0] = 0;
  bytes[4] = 0;
  expect(key(bytes.subarray(1, 4))).toBe(expected);
  bytes[2] = 9;
  expect(key(bytes.subarray(1, 4))).not.toBe(expected);
  const huge = new ArrayBuffer(BINARY_HASH_LIMIT + 1);
  expect(key(new Uint8Array(huge, 1, 3))).toBe(key(new Uint8Array(3)));
});

it("[core.method.key] 上限内全量哈希，超过 65,536 字节返回 null", /** 上限按视图窗口计算。 */ () => {
  const bytes = new Uint8Array(BINARY_HASH_LIMIT);
  expect(key(bytes)).not.toBeNull();
  expect(key(bytes.buffer)).not.toBeNull();
  const huge = new ArrayBuffer(BINARY_HASH_LIMIT + 1);
  for (const value of [huge, new SharedArrayBuffer(huge.byteLength), new Uint8Array(huge), new DataView(huge), Buffer.alloc(huge.byteLength)]) expect(key(value)).toBeNull();
  expect(key({ nested: huge })).toBeNull();
});

it("[core.method.key] 二进制全量读取，中段字节差异改变 key", /** 上限处的中段字节同样参与摘要。 */ () => {
  const bytes = new Uint8Array(BINARY_HASH_LIMIT);
  const original = key(bytes);
  expect(original).toBe(key(bytes));
  bytes[123] = 1;
  expect(key(bytes)).not.toBe(original);
});

it("[core.method.key] 空二进制保留类型，嵌套字段也参与哈希", /** 空内容跨容器相等，但与缺省和空文本区分。 */ () => {
  const buffer = new ArrayBuffer(0);
  for (const value of [buffer, new SharedArrayBuffer(0), new Uint8Array(buffer), new DataView(buffer), Buffer.alloc(0)]) {
    expect(key(value)).toBe(key(buffer));
    expect(key(value)).not.toBe(key(undefined));
    expect(key(value)).not.toBe(key(""));
    expect(key({ empty: value, present: 1 })).not.toBe(key({ present: 1 }));
  }
});

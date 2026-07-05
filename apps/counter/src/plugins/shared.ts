/** 插件内部共享的小工具（card/odometer/ring 都会用到）。不对外导出，不引入任何运行时依赖，不影响 tree-shaking。 */

export function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** 数字位→#，分隔符/小数点原样保留 */
export function maskOf(s: string): string {
  let m = "";
  for (let i = 0; i < s.length; i++) m += isDigit(s[i]) ? "#" : s[i];
  return m;
}

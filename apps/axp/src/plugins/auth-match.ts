/**
 * 已归一化输入的匹配谓词。
 * @example const match: TAuthPredicate = compileMethods('get'); match('get');
 */
export type TAuthPredicate = (value: string) => boolean;
/** 恒真谓词。 */
const TRUE: TAuthPredicate = () => true;
/** 恒假谓词。 */
const FALSE: TAuthPredicate = () => false;
/** 全匹配通配符。 */
const WILDCARD = "*";
/** 空输入及被剥离的 URL 片段。 */
const EMPTY_INPUT = "";
/** 占位符替换必须覆盖所有出现位置。 */
const GLOBAL_REGEX_FLAGS = "g";

/**
 * 提取 pathname，剥离主机、查询和片段；空路径返回根路径。
 * @param url 相对、绝对或协议相对 URL。
 * @returns 至少为根路径的 pathname。
 * @example pathnameOf('https://example.com/me?q=1'); // '/me'
 */
export function pathnameOf(url: string): string {
  return url.replace(/^([a-z][a-z\d+\-.]*:)?\/\/[^/?#]*/i, EMPTY_INPUT).replace(/[?#].*$/, EMPTY_INPUT) || "/";
}

/**
 * 编译方法白名单；缺省、空串、空数组恒假，星号恒真。配置转小写，输入须已小写。
 * @param m 方法字符串或列表。
 * @returns 判断小写方法的谓词。
 * @example compileMethods(['GET', 'POST'])('get'); // true
 */
export function compileMethods(m: string | readonly string[] | undefined): TAuthPredicate {
  if (m == null) return FALSE;
  if (typeof m === "string") {
    if (m === WILDCARD) return TRUE;
    if (m === EMPTY_INPUT) return FALSE;
    const lower = m.toLowerCase();
    /** 比较调用方已归一化的小写动词。 */
    return (x) => x === lower;
  }
  if (m.length === 0) return FALSE;
  if (m.includes(WILDCARD)) return TRUE;
  const set = new Set(m.map(/** 归一化配置中的方法。 */ (s) => s.toLowerCase()));
  /** 多方法使用集合常数时间查找。 */
  return (x) => set.has(x);
}

/**
 * 编译 urlPattern 选项为谓词：undefined/[] 恒false；'*'/['*'] 恒true；否则用 URLPattern
 * （不可用回退正则），'*' 任意、':name' 单段、'!' 前缀否定。
 * @example compileUrlPatterns('/me')(pathnameOf('/me?q=1')); // true
 * @param p pathname 模式或模式列表。
 * @returns 对已提取 pathname 执行包含和排除规则的谓词。
 */
export function compileUrlPatterns(p: string | readonly string[] | undefined): TAuthPredicate {
  const arr = p == null ? [] : Array.isArray(p) ? p : [p as string];
  if (arr.length === 0) return FALSE;
  if (arr.length === 1 && arr[0] === WILDCARD) return TRUE;

  const Ctor = getURLPattern();
  const includes: TAuthPredicate[] = [];
  const excludes: TAuthPredicate[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const isNeg = raw.charCodeAt(0) === 33; // '!'
    const m = compileOne(Ctor, isNeg ? raw.slice(1) : raw);
    if (m) (isNeg ? excludes : includes).push(m);
  }

  if (includes.length === 0 && excludes.length === 0) return FALSE;
  if (excludes.length === 0) {
    /** 只含包含规则时任一命中即可。 */
    return includes.length === 1 ? includes[0] : (url) => includes.some((m) => m(url));
  }
  /** 排除规则优先；只有排除规则时默认放行其余路径。 */
  return (url) => {
    if (includes.length && !includes.some((m) => m(url))) return false;
    return !excludes.some((m) => m(url));
  };
}

/** 编译单个模式串：优先 URLPattern，失败或不可用时回退正则。 */
function compileOne(Ctor: typeof URLPattern | null, pat: string): TAuthPredicate | null {
  if (Ctor) {
    try {
      const p = new Ctor({ pathname: pat });
      /** 原生 test 失败按不匹配处理。 */
      return (url) => {
        try {
          return p.test({ pathname: url });
        } catch {
          return false;
        }
      };
    } catch {
      // 当前模式不受原生支持，继续尝试正则子集。
    }
  }
  const re = patternToRegex(pat);
  /** 编译失败时忽略当前模式。 */
  return re ? (url) => re.test(url) : null;
}

/**
 * URLPattern pathname 子集转正则：'*'⇒.*，':name'⇒[^/]+，其余转义为字面量。
 * @example patternToRegex('/users/:id')?.test('/users/1'); // true
 * @param pat URLPattern pathname 子集模式串。
 * @returns 锚定并允许可选尾斜杠的正则，解析失败返回 null。
 */
export function patternToRegex(pat: string): RegExp | null {
  try {
    const NAMED = " NAMED ",
      STAR = " STAR ";
    const tokenized = pat.replace(/:[A-Za-z_$][\w$]*/g, NAMED).replace(/\*/g, STAR);
    const escaped = tokenized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const body = escaped.replace(new RegExp(NAMED, GLOBAL_REGEX_FLAGS), "[^/]+").replace(new RegExp(STAR, GLOBAL_REGEX_FLAGS), ".*");
    return new RegExp(`^${body}/?$`);
  } catch {
    return null;
  }
}

/** 探测当前运行时是否提供原生 URLPattern。 */
function getURLPattern(): typeof URLPattern | null {
  const G = (globalThis as { URLPattern?: typeof URLPattern }).URLPattern;
  return typeof G === "function" ? G : null;
}

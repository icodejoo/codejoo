# Utils 架构文档

## 项目概述

**@codejoo/utils** 是一个共享工具库包，为 Codejoo Monorepo 中所有其他子项目提供通用的类型定义、函数工具和常量。该包不依赖其他库，只提供纯 JavaScript/TypeScript 工具。

## 设计原则

1. **最小化依赖**: 不依赖任何第三方库，仅使用 JavaScript 标准库
2. **Tree-shakeable**: 所有导出都支持树摇，未使用的代码会被删除
3. **类型安全**: 完整的 TypeScript 类型定义
4. **无副作用**: 纯函数，不修改全局状态
5. **高内聚低耦合**: 通用工具，不包含业务逻辑

## 核心架构

```
子项目们
    ↓ (import from '@codejoo/utils')
    ↓
[Utils 包]
    ├─ 类型工具 (Type Helpers)
    │  ├─ 泛型类型
    │  ├─ 条件类型
    │  ├─ 类型推导
    │  └─ 工具类型
    ├─ 函数工具 (Function Helpers)
    │  ├─ 数组操作
    │  ├─ 对象操作
    │  ├─ 字符串处理
    │  ├─ 数学运算
    │  └─ 通用工具函数
    ├─ 常量 (Constants)
    │  ├─ 魔数
    │  ├─ 枚举值
    │  └─ 配置常量
    └─ 声明 (Declarations)
        └─ 全局类型声明
```

## 文件结构

```
packages/utils/
├── src/
│   ├── index.ts                 # 主入口，导出所有公共 API
│   ├── types/
│   │   ├── generic.ts           # 泛型类型
│   │   ├── conditional.ts       # 条件类型
│   │   ├── utility.ts           # 工具类型 (Pick/Omit/Record 等)
│   │   ├── inferrence.ts        # 类型推导类型
│   │   └── index.ts             # 类型导出
│   ├── functions/
│   │   ├── array.ts             # 数组操作 (flatten/unique/group 等)
│   │   ├── object.ts            # 对象操作 (deep-merge/pick/omit 等)
│   │   ├── string.ts            # 字符串处理 (capitalize/case-convert 等)
│   │   ├── math.ts              # 数学运算 (clamp/lerp/round 等)
│   │   ├── common.ts            # 通用工具函数
│   │   └── index.ts             # 函数导出
│   ├── constants/
│   │   ├── numbers.ts           # 数字常量
│   │   ├── strings.ts           # 字符串常量
│   │   ├── enums.ts             # 枚举
│   │   └── index.ts             # 常量导出
│   └── declare/
│       └── global.ts            # 全局类型声明
├── package.json
└── tsconfig.json
```

## 主要模块

### 1. **类型工具**

#### 泛型类型
```typescript
// 强制对象值类型
type ValueOf<T> = T[keyof T]

// 构建对象类型
type Record<K extends string | number, T> = { [P in K]: T }

// 条件类型映射
type Flatten<T> = T extends Array<infer U> ? U : T
```

#### 条件类型
```typescript
// 判断是否是可选属性
type IsOptional<T, K extends keyof T> = undefined extends T[K] ? true : false

// 判断是否是数组
type IsArray<T> = T extends Array<any> ? true : false

// 判断是否是函数
type IsFunction<T> = T extends (...args: any[]) => any ? true : false
```

#### 工具类型
```typescript
// 提取联合类型
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

// 深度只读
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}

// 深度部分
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
```

### 2. **函数工具**

#### 数组操作
```typescript
// 扁平化数组
function flatten<T>(arr: T[][]): T[] { /* ... */ }

// 去重
function unique<T>(arr: T[]): T[] { /* ... */ }

// 分组
function groupBy<T, K>(arr: T[], key: (item: T) => K): Map<K, T[]> { /* ... */ }

// 首个满足条件的元素
function findFirst<T>(arr: T[], predicate: (item: T) => boolean): T | undefined { /* ... */ }
```

#### 对象操作
```typescript
// 深度合并
function deepMerge<T extends object>(target: T, ...sources: T[]): T { /* ... */ }

// 选择属性
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> { /* ... */ }

// 排除属性
function omit<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> { /* ... */ }

// 深度克隆
function deepClone<T>(obj: T): T { /* ... */ }
```

#### 字符串处理
```typescript
// 首字母大写
function capitalize(str: string): string { /* ... */ }

// 驼峰转下划线
function camelToSnake(str: string): string { /* ... */ }

// 下划线转驼峰
function snakeToCamel(str: string): string { /* ... */ }

// 模板字符串插值
function interpolate(template: string, values: Record<string, any>): string { /* ... */ }
```

#### 数学运算
```typescript
// 夹值
function clamp(value: number, min: number, max: number): number { /* ... */ }

// 线性插值
function lerp(a: number, b: number, t: number): number { /* ... */ }

// 四舍五入到小数位
function roundTo(value: number, decimals: number): number { /* ... */ }

// 取模（总是返回正数）
function mod(n: number, m: number): number { /* ... */ }
```

#### 通用工具
```typescript
// 延迟执行
function delay(ms: number): Promise<void> { /* ... */ }

// 防抖
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T { /* ... */ }

// 节流
function throttle<T extends (...args: any[]) => any>(func: T, limit: number): T { /* ... */ }

// 获取类型名称
function getTypeName(value: any): string { /* ... */ }

// 判断相等（深度比较）
function deepEqual(a: any, b: any): boolean { /* ... */ }
```

### 3. **常量**

#### 数字常量
```typescript
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER
const EPSILON = Number.EPSILON
const PI = Math.PI
const TAU = Math.PI * 2  // 2π
```

#### 字符串常量
```typescript
const EMPTY_STRING = ''
const SPACE = ' '
const NEWLINE = '\n'
const REGEX_EMPTY = /^\s*$/
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
```

#### 枚举
```typescript
enum StorageBackend {
  LocalStorage = 'localStorage',
  SessionStorage = 'sessionStorage',
  IndexedDB = 'indexeddb'
}

enum Direction {
  Up = 'up',
  Down = 'down',
  Left = 'left',
  Right = 'right'
}
```

## 使用示例

### 在 AXP 中
```typescript
import { deepClone, delay } from '@codejoo/utils'

// 克隆配置对象
const configClone = deepClone(config)

// 重试延迟
await delay(1000)
```

### 在 Counter 中
```typescript
import { clamp, lerp } from '@codejoo/utils'

// 限制缩放值
const scale = clamp(newScale, 0.5, 3)

// 线性插值（缓动计算）
const current = lerp(from, to, progress)
```

### 在 Storage 中
```typescript
import { deepMerge, deepEqual } from '@codejoo/utils'

// 合并配置
const config = deepMerge(defaultConfig, userConfig)

// 检查值是否改变
if (!deepEqual(oldValue, newValue)) {
  // 触发更新事件
}
```

### 在 Layerman 中
```typescript
import { groupBy, deepPartial } from '@codejoo/utils/types'

// 分组冷却规则
const grouped = groupBy(rules, (r) => r.scope)

// 部分配置类型
type PartialConfig = deepPartial<LayermanConfig>
```

## 导出策略

```typescript
// 主入口 index.ts
export * from './types'
export * from './functions'
export * from './constants'
export * from './declare/global'

// 子模块导出（支持细粒度导入）
export { type Record, type ValueOf } from './types/generic'
export { flatten, unique, groupBy } from './functions/array'
export { clamp, lerp } from './functions/math'
```

## Tree-shaking 优化

所有导出都被标记为可树摇，确保：

```typescript
// ✅ 只导入需要的函数
import { clamp } from '@codejoo/utils'

// ✅ 其他未使用的函数会被删除
// 最终包大小只包含 clamp 函数

// ❌ 避免默认导出（阻止树摇）
// export default { clamp, lerp, ... }  ← 这样做会阻止树摇
```

## 扩展性

### 添加新工具函数
```typescript
// src/functions/crypto.ts
/**
 * 使用 SHA-256 哈希字符串
 * @param str - 输入字符串
 * @returns 十六进制哈希值
 */
export async function sha256(str: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
```

### 添加新类型
```typescript
// src/types/async.ts
/**
 * Promise 的泛型参数
 * @example type Awaited<Promise<string>> = string
 */
type Awaited<T> = T extends Promise<infer U> ? U : T
```

## 与其他项目的关系

- **所有子项目**: 依赖 @codejoo/utils
- **零循环依赖**: Utils 不依赖任何其他子项目

## 性能考量

- 所有函数都是纯函数，无副作用
- 支持树摇，只加载使用的代码
- 没有外部依赖，包体积小

## 参考

- [README.md](./README.md)
- [源代码](./src)

# OpenAPI 架构文档

## 项目概述

**@codejoo/openapi2lang** (openapi) 是一个 OpenAPI 3.x / Swagger 2.0 文档转换工具，可将 API 规范转换为 TypeScript、Dart 以及 25+ 种其他语言的类型定义。

## 核心架构

```
OpenAPI/Swagger 文档 (YAML/JSON)
    ↓
[文档解析器]
    ├─ YAML 解析 (js-yaml)
    ├─ JSON 解析
    └─ 规范验证
    ↓
[Schema 分析器]
    ├─ 遍历 Components/Schemas
    ├─ 识别类型关系
    ├─ 构建依赖图
    └─ 处理引用解析 ($ref)
    ↓
[代码生成]
    └─ QuickType Core
        ├─ TypeScript 生成器
        ├─ Dart 生成器
        ├─ Kotlin 生成器
        ├─ Java 生成器
        ├─ Python 生成器
        ├─ Go 生成器
        ├─ Rust 生成器
        └─ 其他 20+ 语言生成器
        ↓
    目标语言的类型定义
        ↓
    应用代码中使用
```

## 主要特性

### 1. **多格式支持**
- **OpenAPI 3.0/3.1**: 最新规范支持
- **Swagger 2.0**: 向后兼容
- **YAML/JSON**: 两种格式都支持

### 2. **多语言代码生成**
- **TypeScript**: 完整的 TS 类型定义
- **Dart**: Flutter 应用使用
- **Kotlin**: Android 开发
- **Java**: 企业应用
- **Python**: Python 后端/脚本
- **Go**: 微服务开发
- **Rust**: 系统编程
- **C#/.NET**: .NET 应用
- **Objective-C/Swift**: iOS 应用
- **其他 15+ 语言**: 涵盖主流开发语言

### 3. **智能类型推导**
- 自动识别枚举类型
- 处理联合类型 (oneOf/anyOf)
- 继承关系处理 (allOf)
- 嵌套对象处理

### 4. **引用解析**
- 自动处理 `$ref` 引用
- 循环引用检测
- 跨文档引用支持

### 5. **集成能力**
- 与 @codejoo/axp 无缝集成，提供端到端类型推导
- CLI 工具支持
- 可编程 API

## 文件结构

```
src/
├── index.ts                 # 主入口，导出 API
├── parser/
│   ├── yaml-parser.ts      # YAML 文件解析
│   ├── json-parser.ts      # JSON 文件解析
│   └── validator.ts        # 规范验证
├── analyzer/
│   ├── schema-analyzer.ts  # Schema 分析
│   ├── type-builder.ts     # 类型构建
│   ├── ref-resolver.ts     # 引用解析
│   └── dependency-graph.ts # 依赖图构建
├── generators/
│   ├── base-generator.ts   # 生成器基类
│   ├── typescript-gen.ts   # TypeScript 生成
│   ├── dart-gen.ts         # Dart 生成
│   └── quicktype-adapter.ts # QuickType 适配器
├── types/
│   └── types.ts            # 内部类型定义
└── utils/
    ├── file-utils.ts       # 文件操作
    └── string-utils.ts     # 字符串处理
```

## 核心流程

### 1. 基础使用
```typescript
import { convert } from '@codejoo/openapi2lang'

// 转换 OpenAPI 文档为 TypeScript 类型
const typescriptCode = await convert({
  input: './openapi.yaml',
  output: './types.ts',
  language: 'typescript'
})
```

### 2. 处理流程

```
输入文件
    ↓
[读取和解析]
    ├─ 判断文件格式 (YAML/JSON)
    ├─ 使用相应解析器解析
    └─ 返回规范对象
    ↓
[验证]
    ├─ 检查是否符合 OpenAPI 规范
    ├─ 检查必需字段
    └─ 报告错误信息
    ↓
[Schema 分析]
    ├─ 遍历 Components/Schemas
    ├─ 提取所有类型定义
    ├─ 识别类型关系
    └─ 构建依赖图
    ↓
[引用解析]
    ├─ 查找所有 $ref
    ├─ 解析引用到具体类型
    ├─ 检测循环引用
    └─ 扁平化或递归处理
    ↓
[类型转换]
    ├─ 将 JSON Schema 转换为目标语言的类型
    ├─ 枚举类型处理
    ├─ 泛型和约束处理
    └─ 继承关系处理
    ↓
[代码生成]
    ├─ 调用 QuickType 生成器
    ├─ 处理语言特定的细节
    ├─ 生成导入语句
    └─ 生成类型定义
    ↓
[输出]
    ├─ 格式化代码
    ├─ 写入文件或返回字符串
    └─ 生成完毕
```

### 3. TypeScript 生成示例

```yaml
# openapi.yaml
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
          format: email
        role:
          type: string
          enum: [admin, user, guest]
      required: [id, name, email]
```

转换为 TypeScript：
```typescript
// generated types
export interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'user' | 'guest'
}
```

## 与 AXP 集成

```typescript
// 直接获得类型安全的 API 调用
import { User } from './types'  // 由 OpenAPI 生成
import { createAxp } from '@codejoo/axp'

const axp = createAxp()

// 完全类型安全
const user: User = await axp.get('/api/users/1')
const newUser: User = await axp.post('/api/users', {
  name: 'John',
  email: 'john@example.com',
  role: 'user'
})
```

## CLI 工具

```bash
# 转换为 TypeScript
npx openapi2lang convert --input openapi.yaml --output types.ts --language typescript

# 转换为 Dart
npx openapi2lang convert --input openapi.yaml --output lib/models.dart --language dart

# 批量转换
npx openapi2lang batch --config codegen.config.json
```

## 扩展性

### 自定义生成器
```typescript
import { BaseGenerator } from '@codejoo/openapi2lang'

class MyCustomGenerator extends BaseGenerator {
  protected generateType(schema: any): string {
    // 自定义生成逻辑
    return `// Custom type\ntype ${schema.name} = ...`
  }
}
```

## 与其他项目的关系

- **@codejoo/axp**: 为 AXP 提供端到端的类型推导
- **应用开发**: 简化 API 类型定义，提高开发效率

## 参考

- [README.md](./README.md)
- [源代码](./src)
- [QuickType 文档](https://github.com/glideapps/quicktype)

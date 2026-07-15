# @codejoo/picman

Framework-agnostic picture/image management library with type-safe operations.

## Features

- 📦 **Type-safe**: Full TypeScript support
- 🎯 **Simple API**: Intuitive methods for managing pictures
- 🔧 **Framework-agnostic**: Works with any framework
- 📝 **Metadata management**: Store and retrieve image metadata

## Installation

```bash
pnpm add @codejoo/picman
```

## Basic Usage

```typescript
import Picman, { PictureMetadata } from "@codejoo/picman";

const manager = new Picman();

const metadata: PictureMetadata = {
  url: "https://example.com/image.jpg",
  width: 800,
  height: 600,
  mimeType: "image/jpeg",
  size: 102400,
};

manager.add("pic1", metadata);
const pic = manager.get("pic1");
const all = manager.getAll();
manager.remove("pic1");
manager.clear();
```

## License

MIT

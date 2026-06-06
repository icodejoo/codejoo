// server.ts
Bun.serve({
  port: 8080,
  async fetch(req) {
    const url = new URL(req.url);
    let filePath = "." + url.pathname;

    // 如果访问根目录，默认指向 index.html
    if (url.pathname === "/") filePath = "./index.html";

    const file = Bun.file(filePath);
    
    // 检查文件是否存在
    if (await file.exists()) {
      return new Response(file);
    }
    
    return new Response("File Not Found", { status: 404 });
  },
});

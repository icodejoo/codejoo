export function middleware(req: any, res: any, next: any) {
  console.log("收到请求:", req.url);

  // 成功响应
  res.success = (data = null, message = "success", code = 200) => {
    res.json({
      code,
      message,
      data,
      timestamp: Date.now(),
    });
  };

  // 错误响应
  res.error = (message = "error", code = 400, data = null) => {
    res.json({
      code,
      message,
      data,
      timestamp: Date.now(),
    });
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  setTimeout(next, 1000);
}

export const user = {
  id: 1,
  name: "John Doe",
  email: "john.doe@example.com",
  sex: 0,
  age: 30,
};

export function json(code: number, message: string, data: any = null) {
  return {
    code,
    message,
    data,
  };
}

json.ok = (data: any = null, message: string = "success", code: number = 200) => {
  return json(code, message, data);
};

json.error = (message: string = "error", code: number = 400, data: any = null) => {
  return json(code, message, data);
};

export function createToken() {
  return btoa(Math.random().toString(36).repeat(6));
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

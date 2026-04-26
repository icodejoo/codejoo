import express from "express";
import { createToken, json, middleware, user, delay } from "./helper";

let accessToken: string | null = null;
let refreshToken: string | null = null;

const app = express();
app.use(express.json());
app.use(middleware);

app.get("/401", (_req, res) => {
  res.status(401).end();
});

app.post("/401", (_req, res) => {
  res.status(401).json(json.error("Unauthorized", 401));
});

app.get("/500", (_req, res) => {
  res.status(500).end();
});

app.post("/500", (_req, res) => {
  res.status(500).json(json.error("Internal Server Error", 500));
});

app.get("/ok", (_req, res) => {
  res.status(200).json(json.ok(user, "请求成功"));
});

app.get("/ok/null", (_req, res) => {
  res.status(200).end();
});

app.get("/login", (_req, res) => {
  accessToken = createToken();
  refreshToken = createToken();
  res.status(200).json(
    json.ok({
      accessToken: accessToken,
      refreshToken: refreshToken,
    }),
  );
});

app.get("/user", async (req, res) => {
  const authHeader = req.headers["authorization"];
  await delay(Math.random() * 3000); // Simulate delay
  if (authHeader === `Bearer ${accessToken}`) {
    res.status(200).json(json.ok(user));
  } else {
    res.status(401).json(json.error("Unauthorized", 401));
  }
});

app.post("/token", (_req, res) => {
  // if (req.body.refreshToken === refreshToken) {
  return res.status(401).json(json.error("Unauthorized", 401));
  // }
  accessToken = createToken();
  refreshToken = createToken();
  res.status(200).json(json.ok({ accessToken: accessToken, refreshToken: refreshToken }));
});

app.post("/expireToken", (_req, res) => {
  accessToken = null;
  res.status(200).json(json.ok());
});

app.post("/expireRefreshToken", (_req, res) => {
  refreshToken = null;
  res.status(200).json(json.ok());
});

app.listen(10001, () => {
  console.log("Server is running on http://localhost:10001");
});

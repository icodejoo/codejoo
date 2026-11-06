import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "jsdom",
    disableConsoleIntercept: true,
    reporters: ["verbose"],
    // 相对时长倒计时走单调钟（performance.now），假时钟必须一并接管，advanceTimersByTime 才会同时推进它
    fakeTimers: {
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date", "performance"],
    },
  },
});

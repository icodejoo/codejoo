const { exec } = require("child_process");
const { spawn } = require("child_process");

spawn("pnpm dev:fe", {
  shell: true,
  stdio: "inherit",
});

spawn("bun dev:be", {
  shell: true,
  stdio: "inherit",
});

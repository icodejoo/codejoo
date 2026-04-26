import { defineConfig } from "oxlint";

const lint = defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "promise"],
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
    style: "off",
    pedantic: "off",
  },
  rules: {
    "no-unused-vars": "off",
    "typescript/no-unused-vars": "off",
    "no-undef": "off",
  },
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "**/.smoke/**",
    "**/types/**",
    "**/.git/**",
    "**/.claude/**",
  ],
});

export { lint };
export default { lint };

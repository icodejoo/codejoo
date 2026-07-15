import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

function run(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function build() {
  try {
    // Build ESM entries (index, sw, element, shared)
    console.log("Building ESM entries...");
    await run("vp", ["pack"], {
      env: { ...process.env, PICMAN_BUILD_SW: "0" },
    });

    // Build standalone SW entry
    console.log("Building standalone SW...");
    await run("vp", ["pack"], {
      env: { ...process.env, PICMAN_BUILD_SW: "1" },
    });

    console.log("Build complete!");
  } catch (error) {
    console.error("Build failed:", error.message);
    process.exit(1);
  }
}

build();

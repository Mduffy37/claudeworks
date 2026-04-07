#!/usr/bin/env node
const { spawn, execFileSync } = require("child_process");
const { watch } = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
let electronProcess = null;

function compile() {
  try {
    execFileSync("npx", ["tsc", "-p", "tsconfig.electron.json"], {
      cwd: rootDir,
      stdio: "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

function startElectron() {
  if (electronProcess) {
    electronProcess.kill();
    electronProcess = null;
  }
  electronProcess = spawn("npx", ["electron", "."], {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  electronProcess.on("exit", (code) => {
    // Only exit if Electron was closed by user, not by us restarting
    if (!restarting) process.exit(code);
  });
}

let restarting = false;
let debounce = null;

function restart() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log("\n[dev] Recompiling...");
    restarting = true;
    if (compile()) {
      console.log("[dev] Restarting Electron...");
      startElectron();
    }
    restarting = false;
  }, 300);
}

// Initial compile + start
if (!compile()) process.exit(1);
startElectron();

// Watch for changes
watch(path.join(rootDir, "src", "electron"), { recursive: true }, restart);

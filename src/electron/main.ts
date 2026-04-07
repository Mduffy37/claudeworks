import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import {
  getPluginsWithItems,
  scanLocalItems,
  scanMcpServers,
  loadProfiles,
  saveProfile,
  deleteProfileByName,
  assembleProfile,
  copyCredentials,
  launchProfile,
} from "./core";
import type { Profile } from "./types";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-plugins", () => {
  return getPluginsWithItems();
});

ipcMain.handle("get-local-items", (_event, directory: string) => {
  return scanLocalItems(directory);
});

ipcMain.handle("get-mcp-servers", (_event, directory?: string) => {
  return scanMcpServers(directory);
});

ipcMain.handle("get-profiles", () => {
  return loadProfiles();
});

ipcMain.handle("create-profile", (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  copyCredentials(saved);
  return saved;
});

ipcMain.handle("update-profile", (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  return saved;
});

ipcMain.handle("delete-profile", (_event, name: string) => {
  deleteProfileByName(name);
});

ipcMain.handle("launch-profile", async (_event, name: string, directory?: string) => {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Profile "${name}" not found`);
  assembleProfile(profile);
  await launchProfile(profile, directory);
});

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("is-bin-in-path", () => {
  const binDir = require("path").join(require("os").homedir(), ".claude-profiles", "bin");
  return (process.env.PATH ?? "").split(":").includes(binDir);
});

ipcMain.handle("add-bin-to-path", () => {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");
  const binDir = path.join(os.homedir(), ".claude-profiles", "bin");
  fs.mkdirSync(binDir, { recursive: true });

  // Detect shell config file
  const shell = process.env.SHELL ?? "/bin/zsh";
  const rcFile = shell.includes("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");

  const exportLine = `\nexport PATH="$PATH:${binDir}"\n`;
  const existing = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf-8") : "";
  if (!existing.includes(binDir)) {
    fs.appendFileSync(rcFile, exportLine);
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

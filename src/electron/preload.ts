import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  getPlugins: () => ipcRenderer.invoke("get-plugins"),
  getLocalItems: (directory) => ipcRenderer.invoke("get-local-items", directory),
  getMcpServers: (directory) => ipcRenderer.invoke("get-mcp-servers", directory),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  createProfile: (profile) => ipcRenderer.invoke("create-profile", profile),
  updateProfile: (profile) => ipcRenderer.invoke("update-profile", profile),
  deleteProfile: (name) => ipcRenderer.invoke("delete-profile", name),
  duplicateProfile: (name) => ipcRenderer.invoke("duplicate-profile", name),
  launchProfile: (name, directory) =>
    ipcRenderer.invoke("launch-profile", name, directory),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  isBinInPath: () => ipcRenderer.invoke("is-bin-in-path"),
  addBinToPath: () => ipcRenderer.invoke("add-bin-to-path"),
};

contextBridge.exposeInMainWorld("api", api);

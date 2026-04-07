import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  getPlugins: () => ipcRenderer.invoke("get-plugins"),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  createProfile: (profile) => ipcRenderer.invoke("create-profile", profile),
  updateProfile: (profile) => ipcRenderer.invoke("update-profile", profile),
  deleteProfile: (name) => ipcRenderer.invoke("delete-profile", name),
  launchProfile: (name, directory) =>
    ipcRenderer.invoke("launch-profile", name, directory),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
};

contextBridge.exposeInMainWorld("api", api);

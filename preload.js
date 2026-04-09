const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fileyUpdater", {
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_, data) => callback(data));
  },
  checkForUpdates: () => {
    ipcRenderer.send("check-for-updates");
  },
});

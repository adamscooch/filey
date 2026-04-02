const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");

// Determine if running from packaged app or dev
const isPackaged = app.isPackaged;
const resourcesPath = isPackaged ? process.resourcesPath : __dirname;

// Prepend bundled binaries to PATH so server.js finds them
const bundledBinDir = path.join(resourcesPath, "bin");
process.env.PATH = `${bundledBinDir}:${bundledBinDir}/mozjpeg:${process.env.PATH}`;
process.env.FILEY_BIN_DIR = bundledBinDir;

const PORT = 3456;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: "Filey",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#171411",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- Auto-updater ---
function setupAutoUpdater() {
  if (!isPackaged) return; // Skip in dev

  const { autoUpdater } = require("electron-updater");

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Available",
        message: `Filey v${info.version} is available (you have v${app.getVersion()}).`,
        buttons: ["Download & Install", "Later"],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "Update downloaded. Filey will restart to install it.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    console.log("Auto-updater error:", err.message);
  });

  // Check for updates 3 seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

app.whenReady().then(() => {
  // Start Express server in-process
  require("./server.js");

  // Give server a moment to bind
  setTimeout(() => {
    createWindow();
    setupAutoUpdater();
  }, 500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

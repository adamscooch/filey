const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
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
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- Version helpers ---
function getDisplayVersion() {
  const pkg = require("./package.json");
  return pkg.version.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, yy, mdd, n) =>
    `${yy}${mdd.padStart(4, "0")}.${n}`
  );
}

// --- Auto-updater (electron-updater via GitHub Releases) ---
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: `Filey v${info.version} is available (you have v${getDisplayVersion()}).`,
      buttons: ["Download & Install", "Later"],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "Update downloaded. Filey will restart to install it.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on("error", (err) => {
    console.log("Auto-update error:", err.message);
  });
}

function checkForUpdates(manual) {
  if (manual) {
    autoUpdater.once("update-not-available", () => {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "No Updates",
        message: `Filey is up to date (v${getDisplayVersion()}).`,
      });
    });
    autoUpdater.once("error", (err) => {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Error",
        message: `Could not check for updates: ${err.message}`,
      });
    });
  }
  autoUpdater.checkForUpdates();
}

// --- App Menu ---
function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { label: `About Filey (v${getDisplayVersion()})`, role: "about" },
        { type: "separator" },
        {
          label: "Check for Updates...",
          click: () => checkForUpdates(true),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  require("./server.js");

  setTimeout(() => {
    buildMenu();
    createWindow();
    if (isPackaged) {
      setupAutoUpdater();
      setTimeout(() => checkForUpdates(false), 3000);
    }
  }, 500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

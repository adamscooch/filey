const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
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
let updater = null;

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

// --- App Menu with Check for Updates ---
function buildMenu() {
  const pkg = require("./package.json");
  const displayVersion = pkg.version.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, yy, mdd, n) =>
    `${yy}${mdd.padStart(4, "0")}.${n}`
  );

  const template = [
    {
      label: app.name,
      submenu: [
        { label: `About Filey (v${displayVersion})`, role: "about" },
        { type: "separator" },
        {
          label: "Check for Updates...",
          click: () => checkForUpdatesManual(),
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

// --- Auto-updater ---
function setupAutoUpdater() {
  if (!isPackaged) return;

  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;

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

  autoUpdater.on("update-not-available", () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "No Updates",
        message: "Filey is up to date.",
      });
      manualUpdateCheck = false;
    }
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
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Error",
        message: `Could not check for updates: ${err.message}`,
      });
      manualUpdateCheck = false;
    }
  });

  // Auto-check 3 seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
}

let manualUpdateCheck = false;

function checkForUpdatesManual() {
  if (!updater) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Updates",
      message: "Auto-update is only available in the packaged app.",
    });
    return;
  }
  manualUpdateCheck = true;
  updater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  // Start Express server in-process
  require("./server.js");

  // Give server a moment to bind
  setTimeout(() => {
    buildMenu();
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

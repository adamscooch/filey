const { app, BrowserWindow, shell } = require("electron");
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

app.whenReady().then(() => {
  // Start Express server in-process
  require("./server.js");

  // Give server a moment to bind
  setTimeout(createWindow, 500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const { app, BrowserWindow, shell, dialog, Menu, net } = require("electron");
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

const GITHUB_OWNER = "adamscooch";
const GITHUB_REPO = "filey";

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

// --- Version helpers ---
function getDisplayVersion() {
  const pkg = require("./package.json");
  return pkg.version.replace(/^(\d+)\.(\d+)\.(\d+)$/, (_, yy, mdd, n) =>
    `${yy}${mdd.padStart(4, "0")}.${n}`
  );
}

function semverToComparable(semver) {
  const parts = semver.split(".").map(Number);
  return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
}

// --- Update checker (GitHub Releases) ---
function checkForUpdates(manual) {
  const currentSemver = require("./package.json").version;

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const request = net.request(url);
  request.setHeader("User-Agent", "Filey-Updater");

  let body = "";
  request.on("response", (response) => {
    response.on("data", (chunk) => { body += chunk.toString(); });
    response.on("end", () => {
      try {
        const release = JSON.parse(body);
        const tagName = release.tag_name || "";
        // Tag is like "v260402.4", convert to semver-like for comparison
        // Or it might already be semver in the release
        const latestDisplay = tagName.replace(/^v/, "");

        // Find the DMG asset
        const dmgAsset = (release.assets || []).find(a => a.name.endsWith(".dmg"));

        // Compare: convert display version (260402.4) to semver (26.402.4) for comparison
        const latestParts = latestDisplay.match(/^(\d{2})(\d{4})\.(\d+)$/);
        if (!latestParts) {
          if (manual) showUpToDate();
          return;
        }
        const latestSemver = `${latestParts[1]}.${parseInt(latestParts[2])}.${latestParts[3]}`;

        const current = semverToComparable(currentSemver);
        const latest = semverToComparable(latestSemver);

        if (latest > current && dmgAsset) {
          dialog
            .showMessageBox(mainWindow, {
              type: "info",
              title: "Update Available",
              message: `Filey v${latestDisplay} is available (you have v${getDisplayVersion()}).`,
              detail: "This will download the installer. Drag Filey to Applications to update.",
              buttons: ["Download Update", "Later"],
              defaultId: 0,
            })
            .then((result) => {
              if (result.response === 0) {
                shell.openExternal(dmgAsset.browser_download_url);
              }
            });
        } else if (manual) {
          showUpToDate();
        }
      } catch (err) {
        console.log("Update check failed:", err.message);
        if (manual) {
          dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "Update Error",
            message: `Could not check for updates: ${err.message}`,
          });
        }
      }
    });
  });

  request.on("error", (err) => {
    console.log("Update check error:", err.message);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Error",
        message: `Could not check for updates: ${err.message}`,
      });
    }
  });

  request.end();
}

function showUpToDate() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "No Updates",
    message: `Filey is up to date (v${getDisplayVersion()}).`,
  });
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
    // Auto-check for updates 3 seconds after launch
    if (isPackaged) {
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

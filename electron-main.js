const { app, BrowserWindow, shell, dialog, Menu, net, ipcMain } = require("electron");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

// Prevent uncaught exceptions from crashing the app with ugly dialog
process.on("uncaughtException", (err) => {
  console.log("Uncaught exception:", err.message);
});

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
    width: 840,
    height: 720,
    title: "Filey",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#171411",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Intercept in-page link clicks to external URLs — open in system browser
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost")) {
      event.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
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

// --- Send update status to renderer ---
function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", { status, ...data });
  }
}

// --- Manual updater (bypasses Squirrel code signing) ---
function checkForUpdates(manual) {
  const currentSemver = require("./package.json").version;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const req = https.get(url, { headers: { "User-Agent": "Filey-Updater" }, timeout: 10000 }, (response) => {
    // Follow redirects
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      https.get(response.headers.location, { headers: { "User-Agent": "Filey-Updater" }, timeout: 10000 }, (res2) => {
        handleUpdateResponse(res2, currentSemver, manual);
      }).on("error", (err) => {
        console.log("Update check redirect error:", err.message);
        if (manual) showUpdateError("Could not reach GitHub. Check your internet connection.");
      });
      return;
    }
    handleUpdateResponse(response, currentSemver, manual);
  });

  req.on("error", (err) => {
    console.log("Update check error:", err.message);
    if (manual) showUpdateError("Could not reach GitHub. Check your internet connection.");
  });

  req.on("timeout", () => {
    req.destroy();
    console.log("Update check timed out");
    if (manual) showUpdateError("Update check timed out. Check your internet connection.");
  });
}

function handleUpdateResponse(response, currentSemver, manual) {
  let body = "";
  response.on("data", (chunk) => { body += chunk; });
  response.on("end", () => {
    try {
      const release = JSON.parse(body);
      const tagName = release.tag_name || "";
      const latestDisplay = tagName.replace(/^v/, "");

      const zipAsset = (release.assets || []).find(a => a.name.endsWith("-mac.zip") || a.name.endsWith("-arm64-mac.zip"));

      const latestParts = latestDisplay.match(/^(\d{2})(\d{4})\.(\d+)$/);
      if (!latestParts) {
        if (manual) showUpToDate();
        return;
      }
      const latestSemver = `${latestParts[1]}.${parseInt(latestParts[2])}.${latestParts[3]}`;
      const current = semverToComparable(currentSemver);
      const latest = semverToComparable(latestSemver);

      if (latest > current && zipAsset) {
        dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Update Available",
          message: `Filey v${latestDisplay} is available (you have v${getDisplayVersion()}).`,
          buttons: ["Download & Install", "Later"],
          defaultId: 0,
        }).then((result) => {
          if (result.response === 0) {
            downloadAndInstall(zipAsset.browser_download_url, latestDisplay);
          }
        });
      } else if (manual) {
        showUpToDate();
      }
    } catch (err) {
      console.log("Update check parse failed:", err.message);
      if (manual) showUpdateError("Could not check for updates.");
    }
  });
}

// --- Progress window (native, no preload needed) ---
let progressWindow = null;

function showProgressWindow(version) {
  if (progressWindow) { progressWindow.close(); progressWindow = null; }
  progressWindow = new BrowserWindow({
    width: 360,
    height: 140,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html><html><head><style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: rgba(30,26,23,0.95); color: #fff; margin: 0; padding: 24px 28px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(20px); -webkit-app-region: drag; overflow: hidden; }
    body::-webkit-scrollbar { display: none; }
    .title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 14px; }
    .bar-wrap { background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; overflow: hidden; }
    .bar { height: 100%; width: 0%; background: #E8923A; border-radius: 4px; transition: width 0.2s ease; }
    .pct { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 8px; text-align: right; font-variant-numeric: tabular-nums; }
  </style></head><body>
    <div class="title" id="title">Downloading Filey v${version}</div>
    <div class="sub" id="sub">This might take a minute...</div>
    <div class="bar-wrap"><div class="bar" id="bar"></div></div>
    <div class="pct" id="pct">0%</div>
  </body></html>`;

  progressWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  progressWindow.once("ready-to-show", () => progressWindow.show());
}

function updateProgressWindow(percent) {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  progressWindow.webContents.executeJavaScript(`
    document.getElementById('bar').style.width = '${percent}%';
    document.getElementById('pct').textContent = '${percent}%';
  `).catch(() => {});
}

function updateProgressWindowText(title, sub) {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  progressWindow.webContents.executeJavaScript(`
    document.getElementById('title').textContent = ${JSON.stringify(title)};
    document.getElementById('sub').textContent = ${JSON.stringify(sub)};
    document.getElementById('bar').style.width = '100%';
    document.getElementById('pct').textContent = '';
  `).catch(() => {});
}

function closeProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.close();
  }
  progressWindow = null;
}

function downloadAndInstall(zipUrl, version) {
  const tmpDir = path.join(app.getPath("temp"), "filey-update");
  const zipPath = path.join(tmpDir, "update.zip");

  // Clean up any previous update attempt
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  fs.mkdirSync(tmpDir, { recursive: true });

  // Show progress window
  showProgressWindow(version);

  // Download the ZIP using https module (follows redirects, proper timeout handling)
  const downloadFile = (url) => {
    const parsedUrl = new URL(url);
    const req = https.get(url, { headers: { "User-Agent": "Filey-Updater" }, timeout: 300000 }, (response) => {
      // Handle redirects (GitHub serves assets via S3 redirect)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location);
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"] || "0");
      let receivedBytes = 0;
      const chunks = [];

      response.on("data", (chunk) => {
        chunks.push(chunk);
        receivedBytes += chunk.length;
        const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
        updateProgressWindow(percent);
        if (mainWindow) mainWindow.setProgressBar(percent / 100);
      });

      response.on("end", () => {
        try {
          fs.writeFileSync(zipPath, Buffer.concat(chunks));
          if (mainWindow) mainWindow.setProgressBar(-1);
          updateProgressWindowText("Installing update...", "Extracting and verifying...");
          installUpdate(tmpDir, zipPath, version);
        } catch (err) {
          closeProgressWindow();
          showUpdateError(err.message);
          cleanup(tmpDir);
        }
      });
    });

    req.on("error", (err) => {
      closeProgressWindow();
      showUpdateError("Download failed: " + err.message);
      cleanup(tmpDir);
    });

    req.on("timeout", () => {
      req.destroy();
      closeProgressWindow();
      showUpdateError("Download timed out. The update file may be too large for your connection. Try again later.");
      cleanup(tmpDir);
    });
  };

  downloadFile(zipUrl);
}

function installUpdate(tmpDir, zipPath, version) {
  sendUpdateStatus("installing");

  const extractDir = path.join(tmpDir, "extracted");
  fs.mkdirSync(extractDir, { recursive: true });

  // Unzip
  execFile("ditto", ["-xk", zipPath, extractDir], (err) => {
    if (err) {
      sendUpdateStatus("error", { message: "Failed to extract update" });
      showUpdateError("Failed to extract update: " + err.message);
      cleanup(tmpDir);
      return;
    }

    // Find the .app in the extracted directory
    const appName = "Filey.app";
    const extractedApp = path.join(extractDir, appName);
    if (!fs.existsSync(extractedApp)) {
      sendUpdateStatus("error", { message: "Filey.app not found in update" });
      showUpdateError("Filey.app not found in the downloaded update.");
      cleanup(tmpDir);
      return;
    }

    // Get current app path
    const currentApp = path.dirname(path.dirname(path.dirname(app.getAppPath())));
    if (!currentApp.endsWith(".app")) {
      sendUpdateStatus("error", { message: "Cannot determine app location" });
      showUpdateError("Cannot determine the current app location for replacement.");
      cleanup(tmpDir);
      return;
    }

    // Ad-hoc re-sign the extracted app (strip any xattrs first)
    execFile("xattr", ["-cr", extractedApp], () => {
      execFile("codesign", ["--force", "--deep", "--sign", "-", extractedApp], (signErr) => {
        if (signErr) console.log("Re-sign warning:", signErr.message);

        // Write a small shell script that waits for the app to quit, replaces it, and relaunches
        const updateScript = path.join(tmpDir, "apply-update.sh");
        fs.writeFileSync(updateScript, `#!/bin/bash
# Wait for the app to quit
sleep 2
# Replace the app
rm -rf "${currentApp}"
mv "${extractedApp}" "${currentApp}"
# Clean up
rm -rf "${tmpDir}"
# Relaunch
open "${currentApp}"
`, { mode: 0o755 });

        closeProgressWindow();

        dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Update Ready",
          message: `Filey v${version} is ready to install.`,
          buttons: ["Restart Filey Now"],
        }).then(() => {
          // Launch the update script and quit
          execFile("/bin/bash", [updateScript], { detached: true, stdio: "ignore" }).unref();
          app.quit();
        });
      });
    });
  });
}

function cleanup(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  if (mainWindow) mainWindow.setProgressBar(-1);
}

function showUpToDate() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "No Updates",
    message: `Filey is up to date (v${getDisplayVersion()}).`,
  });
}

function showUpdateError(msg) {
  if (mainWindow) mainWindow.setProgressBar(-1);
  dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "Update Error",
    message: `Update failed: ${msg}`,
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

  // IPC: renderer can request update check
  ipcMain.on("check-for-updates", () => {
    checkForUpdates(true);
  });

  // Expose checkForUpdates globally so Express can trigger it
  global.fileyCheckForUpdates = () => checkForUpdates(true);

  setTimeout(() => {
    buildMenu();
    createWindow();
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

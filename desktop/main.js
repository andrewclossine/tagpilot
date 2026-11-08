// TAGPILOT for Windows: the online site in its own window, with its own icon. Nothing runs or is stored locally
// apart from the sign-in cookie and the window's size; all data stays on tagpilotsolution.com.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const fs = require("fs");
const path = require("path");

const SITE = new URL(process.env.TAGPILOT_URL || "https://tagpilotsolution.com");
const START = new URL("/apps", SITE).toString();
const ICON = path.join(__dirname, "build", "icon.png");
const sameSite = (url) => { try { return new URL(url).origin === SITE.origin; } catch { return false; } };
const openOutside = (url) => { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); };

// One window only: opening TAGPILOT again brings the open one forward.
if (!app.requestSingleInstanceLock()) app.quit();

const boundsFile = () => path.join(app.getPath("userData"), "window.json");
const savedBounds = () => { try { return JSON.parse(fs.readFileSync(boundsFile(), "utf8")); } catch { return { width: 1280, height: 820 }; } };

let win;
function createWindow() {
  const b = savedBounds();
  win = new BrowserWindow({
    ...b, minWidth: 380, minHeight: 500, show: false, icon: ICON, title: "TAGPILOT", backgroundColor: "#ffffff", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  // The site knows it is inside the app (to hide its own "Install" button).
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} TAGPILOT-Desktop/${app.getVersion()}`);

  // Pages of TAGPILOT stay in the app; anything else opens in the normal browser.
  win.webContents.on("will-navigate", (e, url) => { if (!sameSite(url) && !url.startsWith("file:")) { e.preventDefault(); openOutside(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameSite(url)) return { action: "allow", overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    openOutside(url);
    return { action: "deny" };
  });

  // No connection: a short page with a "Try again" button instead of a blank window.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3: the load was replaced by another one
    win.loadFile(path.join(__dirname, "offline.html"), { query: { retry: sameSite(url) ? url : START } });
  });

  const save = () => { try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* not important */ } };
  win.on("close", save);
  win.loadURL(START);
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // The site never needs the camera, microphone or location.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(["clipboard-sanitized-write", "fullscreen"].includes(permission)));
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "TAGPILOT", submenu: [
      { label: "Home", accelerator: "Alt+Home", click: () => win && win.loadURL(START) },
      { label: "Back", accelerator: "Alt+Left", click: () => win && win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: "Forward", accelerator: "Alt+Right", click: () => win && win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
      { role: "reload" }, { type: "separator" }, { label: "Print", accelerator: "CmdOrCtrl+P", click: () => win && win.webContents.print() },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

/**
 * inkread desktop — a thin Electron shell around the web e-reader.
 *
 * The reader UI, API, and auth all live in @inkread/web; this window points
 * at it (APP_URL, defaulting to the local dev server). Session cookies
 * persist across launches, so you stay signed in like a native app.
 */
const { app, BrowserWindow, Menu, shell } = require('electron');

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:6021';

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 700,
    minHeight: 500,
    title: 'inkread',
    backgroundColor: '#faf7f2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Center the traffic lights on the reader's 48px header row.
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: {
      partition: 'persist:inkread',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Keep navigation inside the app; external links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  window.loadURL(APP_URL).catch(() => {
    void window.loadURL(
      `data:text/html,<body style="font-family:Georgia,serif;background:%23faf7f2;color:%2326221c;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>inkread</h1><p>Can't reach ${APP_URL}.<br/>Start the web app first: <code>yarn workspace @inkread/web dev</code></p></div></body>`,
    );
  });

  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

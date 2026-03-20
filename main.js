const { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let currentWatcher;
let currentJsonPath = null;
let settings = null;

const DEFAULT_SETTINGS = {
  jsonPath: '',
  activeOnly: false,
  includeDone: true,
  includeMemo: true,
  speed: 'normal',
  alwaysOnTop: true,
  width: 900,
  height: 74
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const settingsPath = getSettingsPath();
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings();
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function resolveStatus(item) {
  const raw = String(item.status || '').trim().toLowerCase();
  return raw === 'done' ? 'done' : 'active';
}

function parseTodoJson(rawText) {
  const parsed = JSON.parse(rawText);
  const logs = Array.isArray(parsed.logs) ? parsed.logs : [];

  const FLOWABLE_KINDS = new Set(['TODO', 'メモ']); // ← MEMO は必要に応じて実データに合わせて変更

  let items = logs
    .filter((log) => FLOWABLE_KINDS.has(String(log.kind || '').trim().toUpperCase()))
    .map((log) => {
      const kind = String(log.kind || '').trim().toUpperCase();

      return {
        id: log.id || '',
        kind, // 'TODO' / 'メモ'
        text: String(log.selectionText || '').trim() || '(本文なし)',
        pageTitle: String(log.pageTitle || log.name || '').trim(),
        dateOnly: String(log.dateOnly || '').trim(),
        createdAt: String(log.createdAt || '').trim(),
        status: kind === 'TODO' ? resolveStatus(log) : 'メモ',
        url: String(log.url || '').trim()
      };
    });

  items.sort((a, b) => {
    const rank = (item) => {
      if (item.kind === 'TODO' && item.status === 'active') return 0;
      if (item.kind === 'メモ') return 1;
      if (item.kind === 'TODO' && item.status === 'done') return 2;
      return 9;
    };

    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;

    return new Date(b.createdAt || b.dateOnly || 0).getTime()
         - new Date(a.createdAt || a.dateOnly || 0).getTime();
  });

  return {
    exportedAt: parsed.exportedAt || '',
    items,
    // 既存 renderer が payload.todos を見てても壊れにくいように互換で残す
    todos: items,
    counts: {
      active: items.filter((t) => t.kind === 'TODO' && t.status === 'active').length,
      done: items.filter((t) => t.kind === 'TODO' && t.status === 'done').length,
      memo: items.filter((t) => t.kind === 'メモ').length,
      total: items.length
    }
  };
}

function readCurrentTodoPayload() {
  if (!settings.jsonPath) {
    return {
      ok: false,
      error: 'Log Cacher の JSON ファイルがまだ選ばれていません。',
      exportedAt: '',
      items: [],
      todos: [],
      counts: { active: 0, done: 0, memo: 0, total: 0 }
    };
  }

  try {
    const raw = fs.readFileSync(settings.jsonPath, 'utf8');
    return { ok: true, ...parseTodoJson(raw) };
  } catch (err) {
    return {
      ok: false,
      error: `JSON の読込に失敗: ${err.message}`,
      exportedAt: '',
      items: [],
      todos: [],
      counts: { active: 0, done: 0, memo: 0, total: 0 }
    };
  }
}

function sendPayloadToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = readCurrentTodoPayload();
  mainWindow.webContents.send('todo-payload', payload);
}

function watchJsonFile() {
  if (currentWatcher) {
    fs.unwatchFile(currentJsonPath, currentWatcher);
    currentWatcher = null;
  }

  currentJsonPath = settings.jsonPath || null;
  if (!currentJsonPath) return;

  currentWatcher = (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
      sendPayloadToRenderer();
    }
  };

  fs.watchFile(currentJsonPath, { interval: 1200 }, currentWatcher);
}

function buildContextMenu() {
  const speedChoices = [
    { id: 'slow', label: '速度: Slow' },
    { id: 'normal', label: '速度: Normal' },
    { id: 'fast', label: '速度: Fast' }
  ];

  return Menu.buildFromTemplate([
    {
      label: 'JSON を選ぶ…',
      click: async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (result.canceled || !result.filePaths[0]) return;
        settings.jsonPath = result.filePaths[0];
        saveSettings();
        watchJsonFile();
        sendPayloadToRenderer();
        rebuildMenus();
      }
    },
    {
      label: '今すぐ再読込',
      click: () => sendPayloadToRenderer()
    },
    { type: 'separator' },
    {
      label: 'active のみ流す',
      type: 'checkbox',
      checked: !!settings.activeOnly,
      click: (menuItem) => {
        settings.activeOnly = menuItem.checked;
        if (menuItem.checked) settings.includeDone = false;
        saveSettings();
        sendSettingsToRenderer();
        rebuildMenus();
      }
    },
    {
      label: 'done も含める',
      type: 'checkbox',
      checked: !!settings.includeDone,
      click: (menuItem) => {
        settings.includeDone = menuItem.checked;
        if (menuItem.checked) settings.activeOnly = false;
        saveSettings();
        sendSettingsToRenderer();
        rebuildMenus();
      }
    },
    {
      label: 'メモも含める',
      type: 'checkbox',
      checked: !!settings.includeMemo,
      click: (menuItem) => {
        settings.includeMemo = menuItem.checked;
        saveSettings();
        sendSettingsToRenderer();
        rebuildMenus();
      }
    },
    { type: 'separator' },
    ...speedChoices.map((choice) => ({
      label: choice.label,
      type: 'radio',
      checked: settings.speed === choice.id,
      click: () => {
        settings.speed = choice.id;
        saveSettings();
        sendSettingsToRenderer();
        rebuildMenus();
      }
    })),
    { type: 'separator' },
    {
      label: '常に手前',
      type: 'checkbox',
      checked: !!settings.alwaysOnTop,
      click: (menuItem) => {
        settings.alwaysOnTop = menuItem.checked;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(menuItem.checked, 'screen-saver');
        }
        saveSettings();
        sendSettingsToRenderer();
        rebuildMenus();
      }
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => app.quit()
    }
  ]);
}

function rebuildMenus() {
  const menu = buildContextMenu();
  if (tray) tray.setContextMenu(menu);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('replace-context-labels', {
      jsonPath: settings.jsonPath || ''
    });
  }
}

function sendSettingsToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('settings-payload', settings);
}

function createTray() {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAWUlEQVR4AWOgGAWjgP8/ExMTw38GLMDEwMDAmEGSQKqGqQYg+f//PwMDA2MfA0MDQ4hYgWgGgNQDSYg0g2QxYNTDkA1INZiA1ANJiDSDZDFg1MOQDgBN1Q9R0k2QwAAAABJRU5ErkJggg==';
  const trayImage = nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
  tray = new Tray(trayImage);
  tray.setToolTip('Log Cacher Ticker Gadget');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  rebuildMenus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    minWidth: 640,
    minHeight: 70,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: !!settings.alwaysOnTop,
    skipTaskbar: false,
    backgroundColor: '#050505',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop, 'screen-saver');

  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    settings.width = width;
    settings.height = height;
    saveSettings();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    sendSettingsToRenderer();
    sendPayloadToRenderer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  watchJsonFile();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  if (currentWatcher && currentJsonPath) {
    fs.unwatchFile(currentJsonPath, currentWatcher);
  }
});

const { ipcMain } = require('electron');

ipcMain.handle('open-url', async (_event, url) => {
  if (!url) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('request-json-select', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  settings.jsonPath = result.filePaths[0];
  saveSettings();
  watchJsonFile();
  sendSettingsToRenderer();
  sendPayloadToRenderer();
  rebuildMenus();
  return { ok: true, path: settings.jsonPath };
});

ipcMain.on('show-context-menu', () => {
  const menu = buildContextMenu();
  menu.popup({ window: mainWindow });
});

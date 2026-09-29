// Odonavig - processus principal (Electron)
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  clipboard,
  shell,
  protocol,
  session,
  nativeTheme,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

app.setName('Odonavig');
if (process.platform === 'win32') app.setAppUserModelId('fr.odonavig.browser');

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'apng', 'tif', 'tiff'];
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  avif: 'image/avif', apng: 'image/apng', tif: 'image/tiff', tiff: 'image/tiff',
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
};

// Jeton secret : seule la visionneuse d'Odonavig peut lire les images locales (odonavig://viewer/file)
const FILE_TOKEN = crypto.randomBytes(16).toString('hex');

protocol.registerSchemesAsPrivileged([
  { scheme: 'odonavig', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ---------------------------------------------------------------------------
// Stockage (favoris, onglets, réglages)
// ---------------------------------------------------------------------------
const storePath = () => path.join(app.getPath('userData'), 'odonavig-data.json');
let store = {
  favorites: [
    { url: 'https://www.google.com/', title: 'Google' },
    { url: 'https://www.youtube.com/', title: 'YouTube' },
    { url: 'https://fr.wikipedia.org/', title: 'Wikipédia' },
  ],
  tabs: [],
  activeIndex: 0,
  theme: 'lavande',
  sidebarVisible: true,
  bounds: null,
  maximized: true,
};

function loadStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { ...store, ...data };
  } catch {
    // Premier lancement : valeurs par défaut
  }
}

let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStoreNow, 300);
}
function saveStoreNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Impossible d’enregistrer les données :', err);
  }
}

// ---------------------------------------------------------------------------
// Fichiers locaux → adresses
// ---------------------------------------------------------------------------
function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

function fileToUrl(filePath) {
  const abs = path.resolve(filePath);
  if (IMAGE_EXTS.includes(extOf(abs))) {
    return `odonavig://viewer/?file=${encodeURIComponent(abs)}&t=${FILE_TOKEN}`;
  }
  return pathToFileURL(abs).href;
}

function urlsFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const urls = [];
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    if (/^https?:\/\//i.test(arg)) {
      urls.push(arg);
      continue;
    }
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile()) urls.push(fileToUrl(arg));
    } catch {
      // ignoré
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Fenêtre principale
// ---------------------------------------------------------------------------
const THEME_COLORS = {
  lavande: { bg: '#e4defa', fg: '#3b3355' },
  ciel: { bg: '#d6e8fb', fg: '#233a55' },
  menthe: { bg: '#d4f1e4', fg: '#20463a' },
  peche: { bg: '#fde2d4', fg: '#5a3325' },
  nuit: { bg: '#1e1d26', fg: '#e8e6f0' },
};

let win = null;
let pendingUrls = [];
let appFullscreen = false;

function createWindow() {
  const theme = THEME_COLORS[store.theme] || THEME_COLORS.lavande;
  const bounds = store.bounds || { width: 1280, height: 800 };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 360,
    title: 'Odonavig',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: theme.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: theme.bg, symbolColor: theme.fg, height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      plugins: true,
      spellcheck: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (store.maximized) win.maximize();
    win.show();
  });

  const rememberBounds = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    store.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) store.bounds = win.getBounds();
    saveStore();
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);

  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', { fullscreen: true, app: appFullscreen }));
  win.on('leave-full-screen', () => {
    appFullscreen = false;
    win.webContents.send('fullscreen-changed', { fullscreen: false, app: false });
  });

  // Sécurité : les <webview> n'ont jamais accès à Node.js
  win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.plugins = true;
    if (!/^(https?|file|odonavig|about|data):/i.test(params.src || 'about:blank')) params.src = 'about:blank';
  });

  // L'interface elle-même ne navigue jamais ailleurs
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('closed', () => {
    win = null;
  });
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------------------
// Raccourcis clavier (fonctionnent même quand une page a le focus)
// ---------------------------------------------------------------------------
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const ctrl = input.control || input.meta;
  const key = (input.key || '').toLowerCase();
  const code = input.code || '';

  if (key === 'f11') return 'fullscreen';
  if (key === 'f5') return ctrl ? 'hard-reload' : 'reload';
  if (input.alt && !ctrl && key === 'arrowleft') return 'back';
  if (input.alt && !ctrl && key === 'arrowright') return 'forward';
  if (key === 'browserback') return 'back';
  if (key === 'browserforward') return 'forward';
  if (!ctrl) return null;

  if (key === 'tab') return input.shift ? 'prev-tab' : 'next-tab';
  if (key === 'pageup') return 'prev-tab';
  if (key === 'pagedown') return 'next-tab';
  if (input.shift && key === 't') return 'reopen-tab';
  if (key === 't') return 'new-tab';
  if (key === 'n') return 'new-tab';
  if (key === 'w' || key === 'f4') return 'close-tab';
  if (key === 'l' || key === 'k') return 'focus-address';
  if (key === 'r') return input.shift ? 'hard-reload' : 'reload';
  if (key === 'd') return 'bookmark';
  if (key === 'f') return 'find';
  if (key === 'p') return 'print';
  if (key === 'o') return 'open-file';
  if (key === 's' || key === 'b') return 'toggle-sidebar';
  if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') return 'zoom-in';
  if (key === '-' || key === '_' || code === 'NumpadSubtract' || code === 'Minus') return 'zoom-out';
  if (code === 'Digit0' || code === 'Numpad0' || key === '0' || key === 'à') return 'zoom-reset';
  if (/^Digit[1-9]$/.test(code)) return `tab-${code.slice(5)}`;
  return null;
}

function attachShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && appFullscreen && win) {
      win.setFullScreen(false);
      return;
    }
    const action = shortcutFor(input);
    if (action) {
      event.preventDefault();
      send('shortcut', action);
    }
  });
}

// ---------------------------------------------------------------------------
// Menu contextuel des pages web (clic droit)
// ---------------------------------------------------------------------------
function buildContextMenu(contents, params) {
  const t = [];
  const openInNewTab = (url) => send('open-urls', [url], { background: false });

  if (params.linkURL) {
    t.push({ label: 'Ouvrir le lien dans un nouvel onglet', click: () => openInNewTab(params.linkURL) });
    t.push({ label: 'Copier l’adresse du lien', click: () => clipboard.writeText(params.linkURL) });
    t.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    t.push({ label: 'Ouvrir l’image dans un nouvel onglet', click: () => openInNewTab(params.srcURL) });
    t.push({ label: 'Copier l’image', click: () => contents.copyImageAt(params.x, params.y) });
    t.push({ label: 'Enregistrer l’image sous…', click: () => contents.downloadURL(params.srcURL) });
    t.push({ type: 'separator' });
  }
  if (params.isEditable) {
    t.push({ label: 'Annuler', role: 'undo', enabled: params.editFlags.canUndo });
    t.push({ type: 'separator' });
    t.push({ label: 'Couper', role: 'cut', enabled: params.editFlags.canCut });
    t.push({ label: 'Copier', role: 'copy', enabled: params.editFlags.canCopy });
    t.push({ label: 'Coller', role: 'paste', enabled: params.editFlags.canPaste });
    t.push({ label: 'Tout sélectionner', role: 'selectAll' });
    t.push({ type: 'separator' });
  } else if (params.selectionText && params.selectionText.trim()) {
    const text = params.selectionText.trim();
    const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    t.push({ label: 'Copier', role: 'copy' });
    t.push({
      label: `Rechercher « ${short} »`,
      click: () => openInNewTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`),
    });
    t.push({ type: 'separator' });
  }
  if (params.dictionarySuggestions && params.dictionarySuggestions.length) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
      t.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
    }
    t.push({ type: 'separator' });
  }

  if (!params.linkURL && params.mediaType !== 'image' && !params.isEditable && !params.selectionText) {
    t.push({ label: 'Précédent', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    t.push({ label: 'Suivant', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    t.push({ label: 'Actualiser', click: () => contents.reload() });
    t.push({ type: 'separator' });
    t.push({ label: 'Ajouter aux favoris', click: () => send('shortcut', 'bookmark') });
    t.push({ label: 'Imprimer…', click: () => send('shortcut', 'print') });
    t.push({ label: 'Rechercher dans la page', click: () => send('shortcut', 'find') });
  }

  while (t.length && t[t.length - 1].type === 'separator') t.pop();
  if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
}

// ---------------------------------------------------------------------------
// Toutes les pages (webview) : nouvelles fenêtres, clic droit, zoom, raccourcis
// ---------------------------------------------------------------------------
app.on('web-contents-created', (_event, contents) => {
  attachShortcuts(contents);
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (/^(https?|file|odonavig):/i.test(url)) {
      send('open-urls', [url], { background: disposition === 'background-tab' });
    }
    return { action: 'deny' };
  });

  contents.on('context-menu', (_e, params) => buildContextMenu(contents, params));

  // Ctrl + molette
  contents.on('zoom-changed', (_e, direction) => send('shortcut', direction === 'in' ? 'zoom-in' : 'zoom-out'));

  // Les liens externes (mailto:, tel:, ...) s'ouvrent avec l'application du système
  contents.on('will-navigate', (e, url) => {
    if (/^(mailto|tel|sms|callto|skype|zoommtg|msteams):/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
});

// ---------------------------------------------------------------------------
// Protocole interne odonavig:// (visionneuse d'images)
// ---------------------------------------------------------------------------
function registerProtocol() {
  protocol.handle('odonavig', async (request) => {
    const url = new URL(request.url);

    if (url.host === 'viewer') {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'viewer.html';
      if (rel === 'file') {
        const file = url.searchParams.get('path') || '';
        if (url.searchParams.get('t') !== FILE_TOKEN || !IMAGE_EXTS.includes(extOf(file))) {
          return new Response('Accès refusé', { status: 403 });
        }
        return serveFile(file);
      }
      if (rel === 'lib/utif.js') return serveFile(require.resolve('utif/UTIF.js'));
      if (rel === 'lib/pako.js') return serveFile(require.resolve('pako/dist/pako.min.js'));
      const base = path.join(__dirname, 'viewer');
      const full = path.normalize(path.join(base, rel));
      if (!full.startsWith(base + path.sep)) return new Response('Accès refusé', { status: 403 });
      return serveFile(full);
    }

    return new Response('Page introuvable', { status: 404 });
  });
}

async function serveFile(full) {
  try {
    const data = await fs.promises.readFile(full);
    return new Response(data, { headers: { 'content-type': MIME[extOf(full)] || 'application/octet-stream' } });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}

// ---------------------------------------------------------------------------
// Téléchargements
// ---------------------------------------------------------------------------
function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    item.once('done', (_e, state) => {
      send('download-done', { name: item.getFilename(), path: item.getSavePath(), state });
    });
  });
}

// ---------------------------------------------------------------------------
// Communication avec l'interface
// ---------------------------------------------------------------------------
ipcMain.handle('store:get', () => store);
ipcMain.on('store:set', (_e, key, value) => {
  store[key] = value;
  saveStore();
  if (key === 'theme' && win && process.platform !== 'darwin') {
    const theme = THEME_COLORS[value] || THEME_COLORS.lavande;
    win.setBackgroundColor(theme.bg);
    try {
      win.setTitleBarOverlay({ color: theme.bg, symbolColor: theme.fg, height: 44 });
    } catch {
      // Non pris en charge sur ce système
    }
  }
});

ipcMain.handle('ui:ready', () => {
  const urls = pendingUrls;
  pendingUrls = [];
  return urls;
});

ipcMain.on('window:toggle-fullscreen', () => {
  if (!win) return;
  if (win.isFullScreen()) {
    win.setFullScreen(false);
  } else {
    appFullscreen = true;
    win.setFullScreen(true);
  }
});

ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Ouvrir un fichier',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PDF et images', extensions: ['pdf', ...IMAGE_EXTS] },
      { name: 'Documents PDF', extensions: ['pdf'] },
      { name: 'Images', extensions: IMAGE_EXTS },
      { name: 'Pages web', extensions: ['html', 'htm'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths.map(fileToUrl);
});

ipcMain.handle('file:to-url', (_e, filePaths) =>
  (filePaths || []).map((p) => (p && fs.existsSync(p) ? fileToUrl(p) : null)),
);

ipcMain.on('shell:open-path', (_e, p) => {
  if (p) shell.openPath(p);
});
ipcMain.on('shell:show-item', (_e, p) => {
  if (p) shell.showItemInFolder(p);
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const urls = urlsFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      send('open-urls', urls.length ? urls : [], { background: false, newTabIfEmpty: true });
    }
  });

  app.whenReady().then(() => {
    loadStore();
    nativeTheme.themeSource = store.theme === 'nuit' ? 'dark' : 'light';
    pendingUrls = urlsFromArgv(process.argv);
    registerProtocol();
    setupDownloads();
    createWindow();
  });

  app.on('before-quit', saveStoreNow);
  app.on('window-all-closed', () => {
    saveStoreNow();
    app.quit();
  });
}

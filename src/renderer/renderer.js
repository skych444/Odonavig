// Odonavig — logique de l'interface
const api = window.odonavig;
const $ = (id) => document.getElementById(id);

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
};
const DEFAULT_SETTINGS = {
  startup: 'restore',
  homeUrl: '',
  homeButton: false,
  newTabPage: 'start',
  searchEngine: 'google',
  defaultZoom: 1,
  askDownload: false,
  downloadDir: '',
  doNotTrack: false,
};
let settings = { ...DEFAULT_SETTINGS };
const searchEngine = () => SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;

const state = {
  tabs: [],
  activeId: null,
  favorites: [],
  closed: [],
  theme: 'lavande',
};
let nextId = 1;

const els = {
  chrome: $('chrome'),
  address: $('address'),
  addressForm: $('address-form'),
  star: $('btn-star'),
  favorites: $('favorites'),
  tabs: $('tabs'),
  views: $('views'),
  start: $('start'),
  startForm: $('start-form'),
  startInput: $('start-input'),
  startFavorites: $('start-favorites'),
  error: $('error'),
  errorDetail: $('error-detail'),
  zoomValue: $('btn-zoom-reset'),
  back: $('btn-back'),
  forward: $('btn-forward'),
  findBar: $('find-bar'),
  findInput: $('find-input'),
  findCount: $('find-count'),
  dropZone: $('drop-zone'),
  toasts: $('toasts'),
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function toUrl(text) {
  const value = (text || '').trim();
  if (!value) return null;
  if (/^(https?|file|odonavig|about|data):/i.test(value)) return value;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return `file:///${value.replace(/\\/g, '/')}`;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(value) || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(value)) {
    return `http://${value}`;
  }
  if (!/\s/.test(value) && /^[^\s/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(value)) return `https://${value}`;
  return searchEngine().url + encodeURIComponent(value);
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function fileNameOf(url) {
  const u = parseUrl(url);
  if (!u) return url;
  if (u.protocol === 'odonavig:' && u.host === 'viewer') {
    const file = u.searchParams.get('file') || '';
    if (file) return file.split(/[\\/]/).pop();
    const remote = parseUrl(u.searchParams.get('url') || '');
    return remote ? decodeURIComponent(remote.pathname.split('/').pop() || remote.hostname) : 'Image';
  }
  return decodeURIComponent(u.pathname.split('/').pop() || u.pathname);
}

function localPathOf(url) {
  const u = parseUrl(url);
  if (!u) return null;
  if (u.protocol === 'odonavig:' && u.host === 'viewer') return u.searchParams.get('file');
  if (u.protocol === 'file:') {
    const p = decodeURIComponent(u.pathname);
    return /^\/[a-zA-Z]:/.test(p) ? p.slice(1).replace(/\//g, '\\') : p;
  }
  return null;
}

function prettyUrl(url) {
  if (!url) return '';
  const u = parseUrl(url);
  if (!u) return url;
  if (u.protocol === 'odonavig:' || u.protocol === 'file:') return fileNameOf(url);
  return u.hostname.replace(/^www\./, '');
}

function sameUrl(a, b) {
  const clean = (x) => (x || '').replace(/#.*$/, '').replace(/\/$/, '');
  return clean(a) === clean(b);
}

function letterFor(text) {
  const u = parseUrl(text);
  if (u && (u.protocol === 'file:' || u.protocol === 'odonavig:')) {
    return /\.pdf$/i.test(fileNameOf(text)) ? '📄' : u.protocol === 'odonavig:' ? '🖼️' : '📁';
  }
  const source = u && u.hostname ? u.hostname.replace(/^www\./, '') : text || '?';
  return (source.trim()[0] || '?').toUpperCase();
}

function iconElement(favicon, url, className = '', useService = false) {
  const letter = document.createElement('span');
  letter.className = `letter ${className}`;
  letter.textContent = letterFor(url);
  if (letter.textContent.length > 1) letter.classList.add('emoji');
  const u = parseUrl(url);
  if ((!favicon || favicon.startsWith('data:,')) && useService && u && /^https?:$/.test(u.protocol)) {
    favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
  }
  if (!favicon || favicon === 'data:,') return letter;
  const img = document.createElement('img');
  img.src = favicon;
  img.alt = '';
  img.className = className;
  img.draggable = false;
  img.onerror = () => img.replaceWith(letter);
  return img;
}

function toast(message, actions = [], duration = 5000) {
  const box = document.createElement('div');
  box.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  box.appendChild(text);
  for (const action of actions) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => {
      action.run();
      box.remove();
    };
    box.appendChild(b);
  }
  els.toasts.appendChild(box);
  setTimeout(() => box.remove(), duration);
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------
function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

function createTab(url = '', options = {}) {
  const tab = {
    id: nextId++,
    url: url || '',
    title: options.title || '',
    favicon: options.favicon || '',
    loading: false,
    zoom: Number(settings.defaultZoom) || 1,
    webview: null,
    ready: false,
    error: null,
    canGoBack: false,
    canGoForward: false,
  };

  let index = state.tabs.length;
  if (typeof options.index === 'number') index = options.index;
  else if (options.afterActive) {
    const current = state.tabs.findIndex((t) => t.id === state.activeId);
    if (current >= 0) index = current + 1;
  }
  state.tabs.splice(index, 0, tab);

  // Les onglets restaurés ne se chargent que lorsqu'on clique dessus
  if (url && !options.lazy) createWebview(tab, url);
  if (options.activate !== false) activateTab(tab.id);
  else renderTabs();
  saveSession();
  return tab;
}

function createWebview(tab, url) {
  const wv = document.createElement('webview');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('plugins', '');
  wv.setAttribute('webpreferences', 'contextIsolation=yes, spellcheck=yes');
  wv.className = tab.id === state.activeId ? '' : 'inactive';
  wv.src = url;
  tab.webview = wv;
  tab.ready = false;
  tab.loading = true;

  const isActive = () => tab.id === state.activeId;
  const refresh = () => {
    renderTabs();
    if (isActive()) updateChrome();
  };

  wv.addEventListener('dom-ready', () => {
    tab.ready = true;
    if (tab.zoom !== 1 || wv.getZoomFactor() !== 1) wv.setZoomFactor(tab.zoom);
    updateNavState(tab);
    if (isActive()) updateChrome();
  });
  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    refresh();
  });
  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    updateNavState(tab);
    refresh();
  });
  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    refresh();
    saveSession();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length) {
      tab.favicon = e.favicons[0];
      refresh();
      saveSession();
    }
  });
  const onNavigate = (url) => {
    tab.url = url;
    tab.error = null;
    if (/^(file|odonavig):/i.test(url)) {
      tab.favicon = '';
      tab.title = fileNameOf(url);
    }
    updateNavState(tab);
    refresh();
    saveSession();
  };
  wv.addEventListener('did-navigate', (e) => {
    tab.favicon = '';
    onNavigate(e.url);
  });
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) onNavigate(e.url);
  });
  wv.addEventListener('did-fail-load', (e) => {
    // -3 = chargement interrompu (normal lors d'une nouvelle navigation)
    if (!e.isMainFrame || e.errorCode === -3) return;
    tab.error = { code: e.errorCode, description: e.errorDescription, url: e.validatedURL };
    tab.url = e.validatedURL || tab.url;
    tab.loading = false;
    refresh();
  });
  wv.addEventListener('found-in-page', (e) => {
    if (!isActive()) return;
    const r = e.result;
    els.findCount.textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : '0/0';
  });
  wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('html-fullscreen'));
  wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('html-fullscreen'));

  els.views.appendChild(wv);
}

function updateNavState(tab) {
  if (!tab.webview || !tab.ready) return;
  try {
    tab.canGoBack = tab.webview.canGoBack();
    tab.canGoForward = tab.webview.canGoForward();
  } catch {
    // webview pas encore prête
  }
}

function activateTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  state.activeId = id;
  if (tab.url && !tab.webview) createWebview(tab, tab.url);

  for (const t of state.tabs) {
    if (t.webview) t.webview.classList.toggle('inactive', t.id !== id);
  }
  if (tab.webview && tab.ready) {
    tab.webview.setZoomFactor(tab.zoom);
    tab.webview.focus();
  }
  closeFind();
  renderTabs();
  updateChrome();
  saveSession();

  if (!tab.url) setTimeout(() => els.startInput.focus(), 0);
}

function closeTab(id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  const [tab] = state.tabs.splice(index, 1);
  if (tab.url) {
    state.closed.push({ url: tab.url, title: tab.title, favicon: tab.favicon, index });
    if (state.closed.length > 25) state.closed.shift();
  }
  if (tab.webview) tab.webview.remove();

  if (!state.tabs.length) {
    createTab('');
    return;
  }
  if (state.activeId === id) {
    const neighbour = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(neighbour.id);
  } else {
    renderTabs();
    saveSession();
  }
}

function reopenClosedTab() {
  const last = state.closed.pop();
  if (last) createTab(last.url, { title: last.title, favicon: last.favicon, index: Math.min(last.index, state.tabs.length) });
}

function navigate(tab, input) {
  const url = toUrl(input);
  if (!url || !tab) return;
  tab.url = url;
  tab.error = null;
  if (tab.webview) {
    if (tab.ready) tab.webview.loadURL(url).catch(() => {});
    else tab.webview.src = url;
  } else {
    createWebview(tab, url);
  }
  renderTabs();
  updateChrome();
  saveSession();
  tab.webview.focus();
}

function openUrls(list, options = {}) {
  const urls = (list || []).filter(Boolean);
  if (!urls.length) {
    if (options.newTabIfEmpty) createTab('');
    return;
  }
  urls.forEach((url, i) => {
    const current = activeTab();
    const background = options.background && urls.length === 1;
    if (!background && current && !current.url) {
      navigate(current, url);
    } else {
      createTab(url, { afterActive: true, activate: !background && i === urls.length - 1 });
    }
  });
}

function cycleTab(step) {
  if (state.tabs.length < 2) return;
  const index = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = (index + step + state.tabs.length) % state.tabs.length;
  activateTab(state.tabs[next].id);
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------
let draggedTabId = null;

function renderTabs() {
  if (draggedTabId !== null) return;
  els.tabs.innerHTML = '';
  for (const tab of state.tabs) {
    const li = document.createElement('li');
    li.className = `tab${tab.id === state.activeId ? ' active' : ''}`;
    li.draggable = true;
    li.title = tab.url ? `${tab.title || ''}\n${tab.url}`.trim() : 'Nouvel onglet';

    const icon = document.createElement('span');
    icon.className = 'icon';
    if (tab.loading && tab.url) {
      const s = document.createElement('span');
      s.className = 'spinner';
      icon.appendChild(s);
    } else if (!tab.url) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;opacity:.6"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    } else {
      icon.appendChild(iconElement(tab.favicon, tab.url));
    }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.url ? tab.title || prettyUrl(tab.url) : 'Nouvel onglet';

    const close = document.createElement('button');
    close.className = 'close';
    close.title = 'Fermer (Ctrl + W)';
    close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    // Le bouton ne doit pas déclencher la sélection de l'onglet (mousedown),
    // sinon la liste est redessinée avant le clic et le ✕ disparaît sans rien fermer
    close.addEventListener('mousedown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    li.append(icon, title, close);
    li.addEventListener('mousedown', (e) => {
      if (e.button === 0 && tab.id !== state.activeId) activateTab(tab.id);
    });
    li.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(tab.id);
    });

    // Glisser pour réordonner
    li.addEventListener('dragstart', (e) => {
      draggedTabId = tab.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/odonavig-tab', String(tab.id));
    });
    li.addEventListener('dragend', () => {
      draggedTabId = null;
      renderTabs();
    });
    li.addEventListener('dragover', (e) => {
      if (draggedTabId === null) return;
      e.preventDefault();
      for (const other of els.tabs.children) other.classList.remove('drop-before');
      li.classList.add('drop-before');
    });
    li.addEventListener('drop', (e) => {
      if (draggedTabId === null) return;
      e.preventDefault();
      e.stopPropagation();
      const from = state.tabs.findIndex((t) => t.id === draggedTabId);
      const [moved] = state.tabs.splice(from, 1);
      const to = state.tabs.findIndex((t) => t.id === tab.id);
      state.tabs.splice(to, 0, moved);
      draggedTabId = null;
      renderTabs();
      saveSession();
    });

    els.tabs.appendChild(li);
  }
  fitTabs();
}

// Quand il y a beaucoup d'onglets, ils rétrécissent jusqu'à n'afficher que l'icône
function fitTabs() {
  els.tabs.classList.remove('narrow');
  const first = els.tabs.firstElementChild;
  if (first && first.getBoundingClientRect().width < 84) els.tabs.classList.add('narrow');
}
window.addEventListener('resize', fitTabs);

function updateChrome() {
  const tab = activeTab();
  if (!tab) return;

  if (document.activeElement !== els.address) els.address.value = prettyUrl(tab.url);
  els.back.disabled = !tab.canGoBack;
  els.forward.disabled = !tab.canGoForward;
  document.body.classList.toggle('loading', !!(tab.loading && tab.url));

  const title = tab.url ? tab.title || prettyUrl(tab.url) : 'Nouvel onglet';
  document.title = `${title} — Odonavig`;

  els.zoomValue.textContent = `${Math.round(tab.zoom * 100)} %`;

  const isFav = !!tab.url && state.favorites.some((f) => sameUrl(f.url, tab.url));
  els.star.classList.toggle('on', isFav);
  els.star.title = isFav ? 'Retirer des favoris (Ctrl + D)' : 'Ajouter aux favoris (Ctrl + D)';
  els.star.style.visibility = tab.url ? 'visible' : 'hidden';

  els.start.classList.toggle('hidden', !!tab.url);
  els.error.classList.toggle('hidden', !tab.error);
  if (tab.error) {
    els.errorDetail.textContent = `${prettyUrl(tab.error.url)} — ${tab.error.description || 'erreur'} (${tab.error.code})`;
  }

  for (const fav of els.favorites.children) {
    fav.classList.toggle('current', !!tab.url && sameUrl(fav.dataset.url, tab.url));
  }
}

// ---------------------------------------------------------------------------
// Favoris
// ---------------------------------------------------------------------------
function renderFavorites() {
  els.favorites.innerHTML = '';
  els.startFavorites.innerHTML = '';
  state.favorites.forEach((fav, index) => {
    const label = fav.title || prettyUrl(fav.url);

    const b = document.createElement('button');
    b.className = 'fav';
    b.title = `${fav.url}\nClic droit : renommer ou retirer`;
    b.dataset.url = fav.url;
    const text = document.createElement('span');
    text.textContent = label;
    b.append(iconElement(fav.icon, fav.url, '', true), text);
    b.addEventListener('click', (e) => openFavorite(fav, e.ctrlKey || e.metaKey));
    b.addEventListener('auxclick', (e) => {
      if (e.button === 1) openFavorite(fav, true);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      favoriteMenu(e, index);
    });
    els.favorites.appendChild(b);

    const s = document.createElement('button');
    s.className = 'start-fav';
    s.title = fav.url;
    const tile = document.createElement('span');
    tile.className = 'tile';
    tile.appendChild(iconElement(fav.icon, fav.url, '', true));
    const name = document.createElement('span');
    name.textContent = label;
    s.append(tile, name);
    s.addEventListener('click', () => openFavorite(fav, false));
    s.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      favoriteMenu(e, index);
    });
    els.startFavorites.appendChild(s);
  });
  updateChrome();
}

function openFavorite(fav, inNewTab) {
  const tab = activeTab();
  if (tab && !tab.url && !inNewTab) navigate(tab, fav.url);
  else {
    const existing = state.tabs.find((t) => sameUrl(t.url, fav.url));
    if (existing && !inNewTab) activateTab(existing.id);
    else createTab(fav.url, { afterActive: true });
  }
}

function toggleFavorite() {
  const tab = activeTab();
  if (!tab || !tab.url) return;
  const index = state.favorites.findIndex((f) => sameUrl(f.url, tab.url));
  if (index >= 0) {
    state.favorites.splice(index, 1);
    toast('Retiré des favoris');
  } else {
    state.favorites.push({ url: tab.url, title: tab.title || prettyUrl(tab.url), icon: tab.favicon || '' });
    toast('Ajouté aux favoris ⭐');
  }
  api.setStore('favorites', state.favorites);
  renderFavorites();
}

let openMenu = null;
function favoriteMenu(event, index) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'modal-card';
  Object.assign(menu.style, {
    position: 'fixed',
    left: `${event.clientX}px`,
    top: `${event.clientY}px`,
    width: 'auto',
    padding: '6px',
    zIndex: 200,
    borderRadius: '10px',
  });
  const items = [
    ['Ouvrir dans un nouvel onglet', () => createTab(state.favorites[index].url, { afterActive: true })],
    ['Renommer', () => renameFavorite(index)],
    ['Retirer des favoris', () => {
      state.favorites.splice(index, 1);
      api.setStore('favorites', state.favorites);
      renderFavorites();
    }],
  ];
  for (const [label, run] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 12px', borderRadius: '7px' });
    b.onmouseenter = () => (b.style.background = 'rgba(127,127,127,.12)');
    b.onmouseleave = () => (b.style.background = 'transparent');
    b.onclick = () => {
      closeMenu();
      run();
    };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  openMenu = menu;
}
function closeMenu() {
  if (openMenu) openMenu.remove();
  openMenu = null;
}
document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
});

function renameFavorite(index) {
  const fav = state.favorites[index];
  const buttons = els.favorites.children;
  const anchor = buttons[index] ? buttons[index].getBoundingClientRect() : { left: 20, bottom: 120 };
  const input = document.createElement('input');
  input.value = fav.title || '';
  Object.assign(input.style, {
    position: 'fixed',
    left: `${anchor.left}px`,
    top: `${anchor.bottom + 6}px`,
    zIndex: 200,
    width: '230px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1.5px solid var(--accent)',
    outline: 0,
    background: 'var(--card)',
    color: 'var(--card-fg)',
  });
  const done = (save) => {
    if (save && input.value.trim()) {
      fav.title = input.value.trim();
      api.setStore('favorites', state.favorites);
      renderFavorites();
    }
    input.remove();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
  document.body.appendChild(input);
  input.select();
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
function setZoom(tab, factor) {
  if (!tab) return;
  tab.zoom = Math.min(5, Math.max(0.25, Math.round(factor * 100) / 100));
  if (tab.webview && tab.ready) tab.webview.setZoomFactor(tab.zoom);
  updateChrome();
}

function zoomStep(direction) {
  const tab = activeTab();
  if (!tab) return;
  const current = tab.zoom;
  let next;
  if (direction > 0) next = ZOOM_LEVELS.find((z) => z > current + 0.001) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  else next = [...ZOOM_LEVELS].reverse().find((z) => z < current - 0.001) || ZOOM_LEVELS[0];
  setZoom(tab, next);
}

// ---------------------------------------------------------------------------
// Recherche dans la page
// ---------------------------------------------------------------------------
function openFind() {
  const tab = activeTab();
  if (!tab || !tab.webview) return;
  els.findBar.classList.remove('hidden');
  els.findInput.focus();
  els.findInput.select();
}

function closeFind() {
  if (els.findBar.classList.contains('hidden')) return;
  els.findBar.classList.add('hidden');
  els.findCount.textContent = '';
  for (const t of state.tabs) {
    if (t.webview && t.ready) t.webview.stopFindInPage('clearSelection');
  }
}

function findNext(forward = true) {
  const tab = activeTab();
  const text = els.findInput.value;
  if (!tab || !tab.webview || !tab.ready) return;
  if (!text) {
    tab.webview.stopFindInPage('clearSelection');
    els.findCount.textContent = '';
    return;
  }
  tab.webview.findInPage(text, { forward, findNext: true });
}

els.findInput.addEventListener('input', () => findNext(true));
els.findBar.addEventListener('submit', (e) => {
  e.preventDefault();
  findNext(true);
});
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    findNext(false);
  }
  if (e.key === 'Escape') {
    closeFind();
    const tab = activeTab();
    if (tab && tab.webview) tab.webview.focus();
  }
});
$('find-next').addEventListener('click', () => findNext(true));
$('find-prev').addEventListener('click', () => findNext(false));
$('find-close').addEventListener('click', closeFind);

// ---------------------------------------------------------------------------
// Barre latérale, plein écran, thème
// ---------------------------------------------------------------------------
function setFavbarVisible(visible) {
  document.body.classList.toggle('favbar-hidden', !visible);
  api.setStore('favbarVisible', visible);
}

function toggleFavbar() {
  setFavbarVisible(document.body.classList.contains('favbar-hidden'));
}

function focusAddress() {
  if (document.body.classList.contains('fullscreen')) document.body.classList.add('peek');
  const tab = activeTab();
  els.address.value = tab ? tab.url : '';
  els.address.focus();
  els.address.select();
}

function setTheme(theme) {
  document.body.classList.remove(`theme-${state.theme}`);
  state.theme = theme;
  document.body.classList.add(`theme-${theme}`);
  for (const b of document.querySelectorAll('#theme-picker button')) b.classList.toggle('on', b.dataset.theme === theme);
}

$('edge-hover').addEventListener('mouseenter', () => document.body.classList.add('peek'));
els.chrome.addEventListener('mouseleave', () => {
  if (document.activeElement !== els.address) document.body.classList.remove('peek');
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function openFile() {
  const urls = await api.openFileDialog();
  openUrls(urls);
}

function runAction(action) {
  const tab = activeTab();
  const wv = tab && tab.webview && tab.ready ? tab.webview : null;

  switch (action) {
    case 'new-tab':
      openNewTab();
      break;
    case 'home':
      goHome();
      break;
    case 'settings':
      openSettings();
      break;
    case 'close-tab':
      if (tab) closeTab(tab.id);
      break;
    case 'reopen-tab':
      reopenClosedTab();
      break;
    case 'next-tab':
      cycleTab(1);
      break;
    case 'prev-tab':
      cycleTab(-1);
      break;
    case 'focus-address':
      focusAddress();
      break;
    case 'back':
      if (wv && wv.canGoBack()) wv.goBack();
      break;
    case 'forward':
      if (wv && wv.canGoForward()) wv.goForward();
      break;
    case 'reload':
      if (tab && tab.error) navigate(tab, tab.error.url || tab.url);
      else if (wv) wv.reload();
      break;
    case 'hard-reload':
      if (wv) wv.reloadIgnoringCache();
      break;
    case 'stop-or-reload':
      if (tab && tab.loading && wv) wv.stop();
      else runAction('reload');
      break;
    case 'bookmark':
      toggleFavorite();
      break;
    case 'find':
      openFind();
      break;
    case 'print':
      if (wv) wv.print();
      break;
    case 'open-file':
      openFile();
      break;
    case 'toggle-favbar':
      toggleFavbar();
      break;
    case 'fullscreen':
      api.toggleFullscreen();
      break;
    case 'zoom-in':
      zoomStep(1);
      break;
    case 'zoom-out':
      zoomStep(-1);
      break;
    case 'zoom-reset':
      setZoom(tab, 1);
      break;
    default:
      if (action.startsWith('tab-')) {
        const n = Number(action.slice(4));
        const target = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1];
        if (target) activateTab(target.id);
      }
  }
}

$('btn-back').addEventListener('click', () => runAction('back'));
$('btn-forward').addEventListener('click', () => runAction('forward'));
$('btn-reload').addEventListener('click', () => runAction('stop-or-reload'));
$('btn-new-tab').addEventListener('click', () => runAction('new-tab'));
$('btn-favbar').addEventListener('click', () => toggleFavbar());
$('btn-zoom-in').addEventListener('click', () => runAction('zoom-in'));
$('btn-zoom-out').addEventListener('click', () => runAction('zoom-out'));
$('btn-zoom-reset').addEventListener('click', () => runAction('zoom-reset'));
$('btn-fullscreen').addEventListener('click', () => runAction('fullscreen'));
$('btn-open-file').addEventListener('click', () => runAction('open-file'));
$('btn-retry').addEventListener('click', () => runAction('reload'));
els.star.addEventListener('click', () => runAction('bookmark'));

for (const b of document.querySelectorAll('#theme-picker button')) {
  b.addEventListener('click', () => {
    setTheme(b.dataset.theme);
    api.setStore('theme', b.dataset.theme);
  });
}
$('btn-settings').addEventListener('click', () => runAction('settings'));
$('btn-home').addEventListener('click', () => runAction('home'));

$('btn-help').addEventListener('click', () => $('help').classList.remove('hidden'));
$('help-close').addEventListener('click', () => {
  $('help').classList.add('hidden');
  api.setStore('helpSeen', true);
});
$('help').addEventListener('mousedown', (e) => {
  if (e.target === $('help')) $('help-close').click();
});

// Adresse
els.addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const tab = activeTab();
  navigate(tab, els.address.value);
  els.address.blur();
  document.body.classList.remove('peek');
});
els.address.addEventListener('focus', () => {
  const tab = activeTab();
  els.address.value = tab ? tab.url : '';
  setTimeout(() => els.address.select(), 0);
});
els.address.addEventListener('blur', () => updateChrome());
els.address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.address.blur();
    const tab = activeTab();
    if (tab && tab.webview) tab.webview.focus();
  }
});

// Page d'accueil
els.startForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = els.startInput.value;
  els.startInput.value = '';
  navigate(activeTab(), value);
});

// Glisser-déposer de fichiers (PDF, images…)
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  els.dropZone.classList.remove('hidden');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropZone.classList.add('hidden');
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropZone.classList.add('hidden');
  const urls = await api.filesToUrls([...e.dataTransfer.files]);
  openUrls(urls);
});

// ---------------------------------------------------------------------------
// Événements du processus principal
// ---------------------------------------------------------------------------
api.on('shortcut', runAction);
api.on('open-urls', (urls, options) => openUrls(urls, options || {}));
api.on('fullscreen-changed', ({ fullscreen, app }) => {
  document.body.classList.toggle('fullscreen', fullscreen);
  document.body.classList.remove('peek');
  if (!fullscreen) document.body.classList.remove('html-fullscreen');
  if (fullscreen && app) toast(`Plein écran — appuyez sur Échap ou ${api.platform === 'darwin' ? '⌃⌘F' : 'F11'} pour quitter`, [], 3000);
});
api.on('download-done', ({ name, path, state: downloadState }) => {
  if (downloadState === 'completed') {
    toast(`Téléchargement terminé : ${name}`, [
      { label: 'Ouvrir', run: () => api.openPath(path) },
      { label: 'Afficher', run: () => api.showItemInFolder(path) },
    ], 8000);
  } else if (downloadState === 'interrupted') {
    toast(`Échec du téléchargement : ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Session (onglets restaurés au prochain lancement)
// ---------------------------------------------------------------------------
let sessionTimer = null;
function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const tabs = state.tabs
      .filter((t) => t.url)
      .map((t) => {
        const file = parseUrl(t.url)?.protocol === 'odonavig:' ? localPathOf(t.url) : null;
        return file ? { file, title: t.title } : { url: t.url, title: t.title, favicon: t.favicon };
      });
    const withUrl = state.tabs.filter((t) => t.url);
    api.setStore('tabs', tabs);
    api.setStore('activeIndex', Math.max(0, withUrl.findIndex((t) => t.id === state.activeId)));
  }, 400);
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------
function homeUrl() {
  return settings.homeUrl ? toUrl(settings.homeUrl) : '';
}

function openNewTab() {
  createTab(settings.newTabPage === 'home' ? homeUrl() : '');
}

function goHome() {
  const tab = activeTab();
  const url = homeUrl();
  if (!url) {
    // Pas de page d'accueil choisie : page Odonavig
    if (tab && !tab.url) return;
    createTab('');
    return;
  }
  if (tab) navigate(tab, url);
  else createTab(url);
}

function saveSettings() {
  api.setStore('settings', settings);
  applySettings();
}

// Met l'interface à jour selon les paramètres
function applySettings() {
  $('btn-home').classList.toggle('hidden', !settings.homeButton);
  const engine = searchEngine().name;
  els.address.placeholder = `Rechercher sur ${engine} ou saisir une adresse`;
  els.startInput.placeholder = `Rechercher sur ${engine} ou saisir une adresse`;
}

const setEls = {
  homeUrl: $('set-home-url'),
  homeButton: $('set-home-button'),
  newTabHome: $('set-newtab-home'),
  search: $('set-search'),
  zoom: $('set-zoom'),
  favbar: $('set-favbar'),
  downloadDir: $('set-download-dir'),
  askDownload: $('set-ask-download'),
  dnt: $('set-dnt'),
};
let appInfo = null;

async function openSettings() {
  appInfo = appInfo || (await api.appInfo());
  for (const r of document.querySelectorAll('input[name="startup"]')) r.checked = r.value === settings.startup;
  setEls.homeUrl.value = settings.homeUrl;
  setEls.homeButton.checked = settings.homeButton;
  setEls.newTabHome.checked = settings.newTabPage === 'home';
  setEls.search.value = settings.searchEngine;
  setEls.zoom.value = String(settings.defaultZoom);
  setEls.favbar.checked = !document.body.classList.contains('favbar-hidden');
  setEls.askDownload.checked = settings.askDownload;
  setEls.dnt.checked = settings.doNotTrack;
  setEls.downloadDir.textContent = settings.downloadDir || appInfo.downloads;
  setEls.downloadDir.title = setEls.downloadDir.textContent;
  $('set-about').textContent = `Odonavig ${appInfo.version} — moteur Chromium ${appInfo.chrome}`;
  $('set-default-section').classList.toggle('hidden', !appInfo.canSetDefault);
  updateDefaultStatus(appInfo.isDefault);
  $('settings').classList.remove('hidden');
}

function closeSettings() {
  if ($('settings').classList.contains('hidden')) return;
  commitHomeUrl();
  $('settings').classList.add('hidden');
}

function updateDefaultStatus(isDefault) {
  $('set-default-status').textContent = isDefault
    ? '✅ Odonavig est votre navigateur par défaut'
    : 'Odonavig n’est pas votre navigateur par défaut';
  $('set-default-btn').classList.toggle('hidden', isDefault);
}

function commitHomeUrl() {
  const value = setEls.homeUrl.value.trim();
  const url = value ? toUrl(value) : '';
  // Une recherche n'est pas une page d'accueil valable : on garde le texte tel quel s'il ressemble à une adresse
  settings.homeUrl = url && !url.startsWith(searchEngine().url) ? url : '';
  setEls.homeUrl.value = settings.homeUrl;
  if (value && !settings.homeUrl) toast('Adresse de page d’accueil non valide');
  saveSettings();
}

for (const r of document.querySelectorAll('input[name="startup"]')) {
  r.addEventListener('change', () => {
    settings.startup = r.value;
    saveSettings();
    if (r.value === 'home' && !settings.homeUrl) setEls.homeUrl.focus();
  });
}
setEls.homeUrl.addEventListener('change', commitHomeUrl);
setEls.homeUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setEls.homeUrl.blur();
});
$('set-home-current').addEventListener('click', () => {
  const tab = activeTab();
  if (!tab || !tab.url || /^odonavig:/.test(tab.url)) {
    toast('Ouvrez d’abord la page à utiliser comme page d’accueil');
    return;
  }
  setEls.homeUrl.value = tab.url;
  commitHomeUrl();
});
setEls.homeButton.addEventListener('change', () => {
  settings.homeButton = setEls.homeButton.checked;
  saveSettings();
});
setEls.newTabHome.addEventListener('change', () => {
  settings.newTabPage = setEls.newTabHome.checked ? 'home' : 'start';
  saveSettings();
});
setEls.search.addEventListener('change', () => {
  settings.searchEngine = setEls.search.value;
  saveSettings();
});
setEls.zoom.addEventListener('change', () => {
  settings.defaultZoom = Number(setEls.zoom.value);
  saveSettings();
});
setEls.favbar.addEventListener('change', () => setFavbarVisible(setEls.favbar.checked));
setEls.askDownload.addEventListener('change', () => {
  settings.askDownload = setEls.askDownload.checked;
  saveSettings();
});
setEls.dnt.addEventListener('change', () => {
  settings.doNotTrack = setEls.dnt.checked;
  saveSettings();
});
$('set-download-change').addEventListener('click', async () => {
  const dir = await api.chooseFolder();
  if (!dir) return;
  settings.downloadDir = dir;
  setEls.downloadDir.textContent = dir;
  setEls.downloadDir.title = dir;
  saveSettings();
});
$('set-clear-cache').addEventListener('click', async () => {
  await api.clearData({ cache: true });
  toast('Cache vidé');
});
$('set-clear-cookies').addEventListener('click', async () => {
  if (!window.confirm('Effacer les cookies et les données de tous les sites ?\nVous serez déconnecté de vos comptes.')) return;
  await api.clearData({ cache: true, cookies: true });
  toast('Cookies et données des sites effacés');
});
$('set-default-btn').addEventListener('click', async () => {
  updateDefaultStatus(await api.setDefaultBrowser());
});
$('set-reset').addEventListener('click', () => {
  if (!window.confirm('Rétablir tous les paramètres par défaut ?\nVos favoris sont conservés.')) return;
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  setFavbarVisible(true);
  setTheme('lavande');
  api.setStore('theme', 'lavande');
  openSettings();
});
$('settings-close').addEventListener('click', closeSettings);
$('settings').addEventListener('mousedown', (e) => {
  if (e.target === $('settings')) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    if (!$('help').classList.contains('hidden')) $('help-close').click();
  }
});

// Sur Mac, affiche ⌘ ⇧ ⌥ à la place de Ctrl, Maj et Alt
function useMacShortcutLabels() {
  const keys = { Ctrl: '⌘', Maj: '⇧', Alt: '⌥', F11: '⌃⌘F' };
  for (const kbd of document.querySelectorAll('kbd')) {
    if (keys[kbd.textContent]) kbd.textContent = keys[kbd.textContent];
  }
  for (const el of document.querySelectorAll('[title]')) {
    el.title = el.title
      .replace(/Ctrl \+ /g, '⌘ ')
      .replace(/Maj \+ /g, '⇧ ')
      .replace(/Alt \+ ←/g, '⌘ [')
      .replace(/Alt \+ →/g, '⌘ ]')
      .replace(/F11/g, '⌃⌘F');
  }
}

(async function init() {
  document.body.classList.add(`platform-${api.platform}`);
  if (api.platform === 'darwin') useMacShortcutLabels();
  const data = await api.getStore();

  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  applySettings();
  setTheme(data.theme || 'lavande');
  if (data.favbarVisible === false) document.body.classList.add('favbar-hidden');
  state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
  renderFavorites();

  // Restaure les onglets de la dernière fois
  const saved = Array.isArray(data.tabs) ? data.tabs : [];
  const files = saved.filter((t) => t.file).map((t) => t.file);
  const fileUrls = files.length ? await api.pathsToUrls(files) : [];
  const fileMap = new Map();
  files.forEach((f, i) => fileMap.set(f, fileUrls[i]));

  const restored = [];
  // Selon « Au démarrage » : onglets précédents, page d'accueil ou nouvel onglet
  if (settings.startup !== 'restore') saved.length = 0;
  for (const t of saved) {
    const url = t.file ? fileMap.get(t.file) : t.url;
    if (!url) continue;
    restored.push(createTab(url, { title: t.title, favicon: t.favicon, lazy: true, activate: false }));
  }

  const incoming = await api.ready();
  if (incoming.length) {
    openUrls(incoming);
  } else if (restored.length) {
    const index = Math.min(data.activeIndex || 0, restored.length - 1);
    activateTab(restored[index].id);
  } else if (settings.startup === 'home') {
    createTab(homeUrl());
  } else {
    createTab('');
  }

  if (!data.helpSeen) $('help').classList.remove('hidden');
})();

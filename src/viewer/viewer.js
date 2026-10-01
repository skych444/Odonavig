// Odonavig — visionneuse d'images (tous formats pris en charge par Chromium + TIFF)
const params = new URLSearchParams(location.search);
const filePath = params.get('file') || '';
const token = params.get('t') || '';
// Image locale (file) ou image d'un site web (url)
const remoteUrl = /^https?:\/\//i.test(params.get('url') || '') ? params.get('url') : '';
const fileName = filePath
  ? filePath.split(/[\\/]/).pop()
  : decodeURIComponent((remoteUrl.split(/[?#]/)[0].split('/').pop() || 'Image'));
const ext = (fileName.split('.').pop() || '').toLowerCase();
const source = remoteUrl || `odonavig://viewer/file?path=${encodeURIComponent(filePath)}&t=${encodeURIComponent(token)}`;

const stage = document.getElementById('stage');
const img = document.getElementById('image');
const message = document.getElementById('message');
const zoomValue = document.getElementById('zoom-value');

const view = { scale: 1, x: 0, y: 0, rotation: 0, fit: true };
let tiffPages = [];
let tiffBuffer = null;
let currentPage = 0;

document.title = fileName;
document.getElementById('name').textContent = fileName;

function naturalSize() {
  const turned = view.rotation % 180 !== 0;
  return turned
    ? { w: img.naturalHeight, h: img.naturalWidth }
    : { w: img.naturalWidth, h: img.naturalHeight };
}

function fitScale() {
  const { w, h } = naturalSize();
  if (!w || !h) return 1;
  return Math.min(1, (stage.clientWidth - 40) / w, (stage.clientHeight - 90) / h);
}

function apply() {
  if (view.fit) {
    view.scale = fitScale();
    view.x = 0;
    view.y = 0;
  }
  img.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotation}deg)`;
  img.classList.toggle('pixelated', view.scale > 2.5);
  zoomValue.textContent = `${Math.round(view.scale * 100)} %`;
}

function zoomTo(scale, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
  const next = Math.min(40, Math.max(0.02, scale));
  // Garde le point sous la souris immobile
  const ox = cx - stage.clientWidth / 2 - view.x;
  const oy = cy - stage.clientHeight / 2 - view.y;
  const ratio = next / view.scale;
  view.x -= ox * (ratio - 1);
  view.y -= oy * (ratio - 1);
  view.scale = next;
  view.fit = false;
  apply();
}

function showMessage(text) {
  message.textContent = text;
  message.classList.remove('hidden');
}

img.addEventListener('load', () => {
  message.classList.add('hidden');
  img.style.visibility = 'visible';
  view.fit = true;
  apply();
  showToolbar(2500);
});
img.addEventListener('error', () => showMessage('Impossible d’afficher cette image.'));

// --- TIFF --------------------------------------------------------------------
function renderTiffPage(index) {
  const ifd = tiffPages[index];
  UTIF.decodeImage(tiffBuffer, ifd, tiffPages);
  const rgba = UTIF.toRGBA8(ifd);
  const canvas = document.createElement('canvas');
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
  canvas.toBlob((blob) => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
  });
  currentPage = index;
  const page = document.getElementById('page');
  page.textContent = `${index + 1} / ${tiffPages.length}`;
}

async function loadTiff() {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  tiffBuffer = await response.arrayBuffer();
  const ifds = UTIF.decode(tiffBuffer);
  // Ne garde que les vraies pages (pas les vignettes)
  tiffPages = ifds.filter((ifd) => ifd.t256 && ifd.t257);
  if (!tiffPages.length) throw new Error('Aucune image');
  if (tiffPages.length > 1) {
    for (const id of ['prev-page', 'page', 'next-page']) document.getElementById(id).classList.remove('hidden');
  }
  renderTiffPage(0);
}

// --- Chargement --------------------------------------------------------------
if (!filePath && !remoteUrl) {
  showMessage('Aucune image à afficher.');
} else if (ext === 'tif' || ext === 'tiff') {
  loadTiff().catch(() => showMessage('Impossible de lire ce fichier TIFF.'));
} else {
  img.src = source;
}

// --- Commandes ---------------------------------------------------------------
document.getElementById('zoom-in').onclick = () => zoomTo(view.scale * 1.25);
document.getElementById('zoom-out').onclick = () => zoomTo(view.scale / 1.25);
document.getElementById('zoom-value').onclick = () => {
  view.x = 0;
  view.y = 0;
  zoomTo(1);
};
document.getElementById('fit').onclick = () => {
  view.fit = true;
  apply();
};
document.getElementById('rotate-left').onclick = () => {
  view.rotation = (view.rotation + 270) % 360;
  apply();
};
document.getElementById('rotate-right').onclick = () => {
  view.rotation = (view.rotation + 90) % 360;
  apply();
};
document.getElementById('prev-page').onclick = () => {
  if (currentPage > 0) renderTiffPage(currentPage - 1);
};
document.getElementById('next-page').onclick = () => {
  if (currentPage < tiffPages.length - 1) renderTiffPage(currentPage + 1);
};

stage.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return; // Ctrl + molette : zoom général d'Odonavig
  e.preventDefault();
  zoomTo(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}, { passive: false });

stage.addEventListener('dblclick', (e) => {
  if (view.fit && fitScale() < 1) zoomTo(1, e.clientX, e.clientY);
  else {
    view.fit = true;
    apply();
  }
});

let drag = null;
stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX - view.x, y: e.clientY - view.y };
  stage.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  view.x = e.clientX - drag.x;
  view.y = e.clientY - drag.y;
  view.fit = false;
  apply();
});
window.addEventListener('mouseup', () => {
  drag = null;
  stage.classList.remove('dragging');
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') zoomTo(view.scale * 1.25);
  else if (e.key === '-') zoomTo(view.scale / 1.25);
  else if (e.key === '0') document.getElementById('fit').click();
  else if (e.key === '1') document.getElementById('zoom-value').click();
  else if (e.key === 'r' || e.key === 'R') document.getElementById(e.shiftKey ? 'rotate-left' : 'rotate-right').click();
  else if (e.key === 'PageDown' || e.key === 'ArrowRight') document.getElementById('next-page').click();
  else if (e.key === 'PageUp' || e.key === 'ArrowLeft') document.getElementById('prev-page').click();
});

window.addEventListener('resize', () => {
  if (view.fit) apply();
});

// --- Barre d'outils qui s'efface toute seule ----------------------------------
const toolbar = document.getElementById('toolbar');
let hideTimer = null;

function showToolbar(duration = 1500) {
  toolbar.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!toolbar.matches(':hover')) toolbar.classList.remove('visible');
  }, duration);
}

window.addEventListener('mousemove', (e) => {
  if (drag) return;
  // La barre réapparaît quand la souris s'approche du bas de la fenêtre
  if (e.clientY > window.innerHeight - 110 || toolbar.contains(e.target)) showToolbar();
});
toolbar.addEventListener('mouseleave', () => showToolbar(700));
document.addEventListener('mouseleave', () => showToolbar(200));

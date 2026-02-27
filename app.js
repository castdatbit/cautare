const STATE = {
    isAuthenticated: false,
    db: null,
    directoryHandle: null,
    indexedFiles: new Map(),
    stats: { pdfs: 0, series: 0 }
};

const DB_NAME = 'PDFSeriesDB';
const DB_VERSION = 1;
const STORE_AUTH = 'auth';
const STORE_INDEX = 'index';

const DOM = {
    authOverlay: document.getElementById('auth-overlay'),
    authPassword: document.getElementById('auth-password'),
    authBtn: document.getElementById('auth-btn'),
    authMessage: document.getElementById('auth-message'),
    appContainer: document.getElementById('app-container'),
    btnSelectFolder: document.getElementById('btn-select-folder'),
    btnLock: document.getElementById('btn-lock'),
    syncStatus: document.getElementById('sync-status'),
    syncText: document.getElementById('sync-text'),
    statPdfs: document.getElementById('stat-pdfs'),
    statSeries: document.getElementById('stat-series'),
    searchInput: document.getElementById('search-input'),
    btnSearch: document.getElementById('btn-search'),
    resultsArea: document.getElementById('results-area'),
    pdfViewerContainer: document.getElementById('pdf-viewer-container'),
    pdfCanvas: document.getElementById('pdf-canvas'),
    textLayer: document.getElementById('text-layer'),
    viewerTitle: document.getElementById('viewer-title'),
    btnCloseViewer: document.getElementById('btn-close-viewer')
};

// DB & AUTH (cod vechi neschimbat)
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = (e) => { STATE.db = e.target.result; resolve(); };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_AUTH)) db.createObjectStore(STORE_AUTH, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_INDEX)) {
                const store = db.createObjectStore(STORE_INDEX, { keyPath: 'fileName' });
                store.createIndex('textContent', 'textContent', { unique: false });
            }
        };
    });
}
async function getMasterPasswordHash() { /* cod vechi din app.js tău */ }
async function setMasterPasswordHash(hashStr) { /* cod vechi */ }
async function hashString(str) { /* cod vechi */ }
async function handleLogin() { /* cod vechi */ }
function unlockApp() { /* cod vechi */ }
function lockApp() { /* cod vechi */ }
async function loadIndexedData() { /* cod vechi */ }

// SELECT FOLDER - pornește pe Desktop
async function selectFolder() {
    try {
        STATE.directoryHandle = await window.showDirectoryPicker({ mode: 'read', startIn: 'desktop' });
        updateStatusUI('syncing', 'Analizare folder din Desktop...');
        await processDirectory(STATE.directoryHandle);
    } catch (err) {
        if (err.name !== 'AbortError') updateStatusUI('offline', 'Eroare la selectare folder');
    }
}

async function processDirectory(dirHandle) {
    let pdfCount = 0;
    DOM.resultsArea.innerHTML = '<div class="empty-state"><h3>Indexare în curs... <span id="idx-count">0</span> PDF-uri</h3><p>Te rog așteaptă.</p></div>';
    const countLabel = document.getElementById('idx-count');

    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
            const file = await entry.getFile();
            if (file.size > 50 * 1024 * 1024) continue;
            await extractTextFromPDF(file, entry.name);
            pdfCount++;
            if (countLabel) countLabel.textContent = pdfCount;
            STATE.stats.pdfs = pdfCount;
            DOM.statPdfs.textContent = pdfCount;
        }
    }

    updateStatusUI('online', `Folder sincronizat • ${pdfCount} fișiere`);
    DOM.searchInput.disabled = DOM.btnSearch.disabled = false;
    showIndexedFilesList();
    resetResultsArea();
}

function updateStatusUI(type = 'offline', text = 'Niciun folder selectat') {
    DOM.syncStatus.className = `dot ${type}`;
    DOM.syncText.textContent = text;
}

// PDF parsing (păstrează exact codul tău vechi)
async function extractTextFromPDF(file, fileName) { /* codul tău vechi */ }
function saveToIndexDB(fileName, pageTexts, fullText) { /* codul tău vechi */ }

// Search & Viewer (actualizat)
function resetResultsArea() { /* cod vechi */ }
async function performSearch() { /* cod vechi */ }
function renderSearchResults(results, query) { /* cod vechi */ }

async function openViewer(fileName, pageNum, highlightQuery) {
    if (!STATE.directoryHandle) return alert("Folderul nu mai este deschis.");
    try {
        const fileHandle = await STATE.directoryHandle.getFileHandle(fileName, { create: false });
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        DOM.pdfViewerContainer.classList.remove('hidden');
        DOM.viewerTitle.textContent = `${fileName} - Pagina ${pageNum}`;

        Array.from(DOM.resultsArea.children).forEach(c => { if (c.id !== 'pdf-viewer-container') c.style.display = 'none'; });

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        DOM.pdfCanvas.height = viewport.height;
        DOM.pdfCanvas.width = viewport.width;
        await page.render({ canvasContext: DOM.pdfCanvas.getContext('2d'), viewport }).promise;

        const textLayerDiv = DOM.textLayer;
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.innerHTML = '';

        const textContent = await page.getTextContent();
        const fragment = document.createDocumentFragment();

        textContent.items.forEach(item => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.sqrt(tx[2]*tx[2] + tx[3]*tx[3]);
            const div = document.createElement('span');
            div.textContent = item.str;
            div.style.left = `${tx[4]}px`;
            div.style.top = `${tx[5] - fontHeight}px`;
            div.style.fontSize = `${fontHeight}px`;
            div.style.fontFamily = item.fontName;
            div.style.position = 'absolute';
            div.style.whiteSpace = 'pre';
            div.style.transformOrigin = '0 0';
            div.style.padding = '1px 3px';
            div.style.borderRadius = '4px';

            if (highlightQuery && item.str.toLowerCase().includes(highlightQuery.toLowerCase())) {
                div.className = 'highlight-elegant';
            } else {
                div.style.color = 'transparent';
            }
            fragment.appendChild(div);
        });
        textLayerDiv.appendChild(fragment);

        // Buton Deschide & Printează
        let btn = document.querySelector('.viewer-header .open-external-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'primary-btn open-external-btn';
            btn.style.marginLeft = '12px';
            btn.innerHTML = '📂 Deschide & Printează';
            document.querySelector('.viewer-header').appendChild(btn);
        }
        btn.onclick = () => {
            const url = URL.createObjectURL(file);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        };
    } catch (e) { console.error(e); alert("Nu am putut deschide PDF-ul."); }
}

function showIndexedFilesList() {
    resetResultsArea();
    const container = document.createElement('div');
    container.style.width = '100%'; container.style.maxWidth = '900px';
    let html = `<h3 style="margin-bottom:20px;color:#3b82f6;">📋 Fișiere indexate (${STATE.indexedFiles.size})</h3>`;
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
    STATE.indexedFiles.forEach((data, name) => {
        html += `<div class="file-card" onclick="openViewer('${name.replace(/'/g,"\\'")}',1,'')">
            <div style="font-size:1.4rem;margin-bottom:8px;">📄</div>
            <div style="font-weight:500;word-break:break-all;">${name}</div>
            <div style="font-size:0.8rem;color:var(--text-muted);">${data.pageTexts.length} pagini</div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    DOM.resultsArea.appendChild(container);
}

// Events
function attachEvents() {
    DOM.authBtn.addEventListener('click', handleLogin);
    DOM.authPassword.addEventListener('keypress', e => { if (e.key==='Enter') handleLogin(); });
    DOM.btnLock.addEventListener('click', lockApp);
    DOM.btnSelectFolder.addEventListener('click', selectFolder);
    DOM.btnSearch.addEventListener('click', performSearch);
    DOM.searchInput.addEventListener('keypress', e => { if (e.key==='Enter') performSearch(); });
    DOM.btnCloseViewer.addEventListener('click', () => {
        DOM.pdfViewerContainer.classList.add('hidden');
        Array.from(DOM.resultsArea.children).forEach(c => { if (c.id !== 'pdf-viewer-container') c.style.display = 'block'; });
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    await initDB();
    const hash = await getMasterPasswordHash();
    DOM.authMessage.textContent = hash ? 'Introdu parola de acces...' : 'Prima lansare: Setează o parolă.';
    DOM.authOverlay.classList.add('active');
    DOM.authPassword.focus();
});

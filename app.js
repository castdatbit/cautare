/**
 * PDF Series Finder - Main Application Logic
 */

// ==========================================
// 1. STATE & CONSTANTS
// ==========================================
const STATE = {
    isAuthenticated: false,
    db: null,
    directoryHandle: null,
    indexedFiles: new Map(), // Mapping filename to extracted text data
    currentViewerPdf: null,
    stats: {
        pdfs: 0,
        series: 0
    }
};

const DB_NAME = 'PDFSeriesDB';
const DB_VERSION = 1;
const STORE_AUTH = 'auth';
const STORE_INDEX = 'index';

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
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

// ==========================================
// 3. INITIALIZATION & DATABASE
// ==========================================

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Database error", event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            STATE.db = event.target.result;
            resolve(STATE.db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create Auth Store
            if (!db.objectStoreNames.contains(STORE_AUTH)) {
                db.createObjectStore(STORE_AUTH, { keyPath: 'id' });
            }

            // Create Index Store for PDF metadata
            if (!db.objectStoreNames.contains(STORE_INDEX)) {
                const indexStore = db.createObjectStore(STORE_INDEX, { keyPath: 'fileName' });
                // We index the extracted full text to make searching fast
                indexStore.createIndex('textContent', 'textContent', { unique: false });
            }
        };
    });
}

// ==========================================
// 4. AUTHENTICATION LOGIC
// ==========================================

async function getMasterPasswordHash() {
    return new Promise((resolve) => {
        const transaction = STATE.db.transaction([STORE_AUTH], 'readonly');
        const store = transaction.objectStore(STORE_AUTH);
        const request = store.get('master');

        request.onsuccess = () => {
            if (request.result) resolve(request.result.hash);
            else resolve(null);
        };
        request.onerror = () => resolve(null);
    });
}

async function setMasterPasswordHash(hashStr) {
    return new Promise((resolve) => {
        const transaction = STATE.db.transaction([STORE_AUTH], 'readwrite');
        const store = transaction.objectStore(STORE_AUTH);
        store.put({ id: 'master', hash: hashStr });
        transaction.oncomplete = () => resolve();
    });
}

// Simple hash function for client-side local validation
async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleLogin() {
    const inputPass = DOM.authPassword.value.trim();
    if (!inputPass) return;

    // UI Loading
    DOM.authBtn.textContent = 'Verificare...';
    DOM.authBtn.disabled = true;

    const inputHash = await hashString(inputPass);
    const savedHash = await getMasterPasswordHash();

    if (!savedHash) {
        // First time setup
        await setMasterPasswordHash(inputHash);
        unlockApp();
    } else if (inputHash === savedHash) {
        // Successful login
        unlockApp();
    } else {
        // Error
        DOM.authPassword.value = '';
        DOM.authMessage.textContent = 'Parolă incorectă. Încearcă din nou.';
        DOM.authMessage.style.color = 'var(--error)';
        DOM.authBtn.textContent = 'Deblochează';
        DOM.authBtn.disabled = false;
        DOM.authPassword.focus();
    }
}

function unlockApp() {
    STATE.isAuthenticated = true;
    DOM.authOverlay.classList.remove('active');
    DOM.appContainer.classList.remove('hidden');
    DOM.authPassword.value = ''; // Clear for security
    DOM.authBtn.textContent = 'Deblochează';
    DOM.authBtn.disabled = false;

    // Start loading previously indexed data
    loadIndexedData();
}

function lockApp() {
    STATE.isAuthenticated = false;
    DOM.authOverlay.classList.add('active');
    DOM.appContainer.classList.add('hidden');
    DOM.authMessage.textContent = 'Aplicația a fost blocată pentru siguranță.';
    DOM.authMessage.style.color = 'var(--text-muted)';

    // Clear sensitive runtime memory
    STATE.directoryHandle = null;
    updateStatusUI();
}

// ==========================================
// 5. FILE SYSTEM & INDEXING
// ==========================================

async function loadIndexedData() {
    if (!STATE.db) {
        STATE.stats.pdfs = 0;
        DOM.statPdfs.textContent = 0;
        return;
    }

    // Load existing index counts from DB to populate UI
    const transaction = STATE.db.transaction([STORE_INDEX], 'readonly');
    const store = transaction.objectStore(STORE_INDEX);
    const countRequest = store.count();

    countRequest.onsuccess = () => {
        STATE.stats.pdfs = countRequest.result;
        DOM.statPdfs.textContent = STATE.stats.pdfs;
        // In a real app we would read all records to populate STATE.indexedFiles map
        // For now, if we have count > 0, we enable search but wait for folder select
        if (STATE.stats.pdfs > 0) {
            DOM.searchInput.disabled = false;
            DOM.btnSearch.disabled = false;
        }
    };
}

async function selectFolder() {
    try {
        if (!window.showDirectoryPicker) {
            alert('Browserul tău nu suportă File System Access API. Te rugăm să folosești Google Chrome, Edge sau Opera.');
            return;
        }

        // Show folder picker UI
        STATE.directoryHandle = await window.showDirectoryPicker({
            mode: 'read'
        });

        updateStatusUI('syncing', `Analizare folder...`);

        // Start processing the folder
        await processDirectory(STATE.directoryHandle);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error(err);
            updateStatusUI('offline', 'Eroare la selectare folder');
        }
    }
}

async function processDirectory(dirHandle) {
    let pdfCount = 0;

    DOM.resultsArea.innerHTML = '<div class="empty-state"><h3>Indexare în curs... <span id="idx-count">0</span> PDF-uri</h3><p>Te rog așteaptă. Analizăm textul din documente.</p></div>';
    const countLabel = document.getElementById('idx-count');

    // We iterate through all files in the directory
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
            const file = await entry.getFile();

            // Skip large files to prevent crash in demo, or process them
            if (file.size > 50 * 1024 * 1024) continue; // Skip > 50MB

            await extractTextFromPDF(file, entry.name);
            pdfCount++;
            if (countLabel) countLabel.textContent = pdfCount;

            // Update stats
            STATE.stats.pdfs = pdfCount;
            DOM.statPdfs.textContent = pdfCount;
        }
    }

    updateStatusUI('online', `Folder Sincronizat. Indexate ${pdfCount} fișiere.`);
    DOM.searchInput.disabled = false;
    DOM.btnSearch.disabled = false;

    resetResultsArea();
}

function updateStatusUI(type = 'offline', text = 'Niciun folder selectat') {
    DOM.syncStatus.className = `dot ${type}`;
    DOM.syncText.textContent = text;
}

// ==========================================
// 6. PDF PARSING (Extragere text)
// ==========================================

async function extractTextFromPDF(file, fileName) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        const maxPages = pdf.numPages;
        let fullText = "";
        const pageTexts = [];

        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Join all the text chunks on the page
            const pageString = textContent.items.map(item => item.str).join(' ');
            pageTexts.push({
                page: pageNum,
                text: pageString.toLowerCase() // normalize for search
            });
            fullText += pageString.toLowerCase() + " ";
        }

        // Save to our memory map
        STATE.indexedFiles.set(fileName, {
            fileHandle: null, // We'll hold this later if needed or find it
            fileName: fileName,
            pageTexts: pageTexts,
            fullText: fullText
        });

        // Save to IndexedDB
        saveToIndexDB(fileName, pageTexts, fullText);

        // Count some mock series (e.g. alphanumeric strings)
        const regex = /[A-Z]{2}\d{4,}/gi;
        const matches = fullText.match(regex);
        if (matches) {
            STATE.stats.series += matches.length;
            DOM.statSeries.textContent = STATE.stats.series;
        }

    } catch (err) {
        console.warn(`Could not parse PDF ${fileName}`, err);
        // Here is where we would call Tesseract.js (OCR) if text extraction failed
    }
}

function saveToIndexDB(fileName, pageTexts, fullText) {
    if (!STATE.db) return; // Skip saving to DB if unavailable (session only mode)

    const transaction = STATE.db.transaction([STORE_INDEX], 'readwrite');
    const store = transaction.objectStore(STORE_INDEX);
    store.put({
        fileName: fileName,
        pageTexts: pageTexts,
        textContent: fullText,
        timestamp: Date.now()
    });
}

// ==========================================
// 7. SEARCH & VIEWER LOGIC
// ==========================================

function resetResultsArea() {
    // Keep viewer container, clear empty state
    const viewer = DOM.pdfViewerContainer;
    DOM.resultsArea.innerHTML = '';
    DOM.resultsArea.appendChild(viewer);
    viewer.classList.add('hidden');
}

async function performSearch() {
    const query = DOM.searchInput.value.trim().toLowerCase();
    if (!query) return;

    resetResultsArea();

    const results = [];

    // We search our in-memory map for fast results
    // You can also search IndexedDB natively, but map is faster if fits in RAM
    STATE.indexedFiles.forEach((data, fileName) => {
        if (data.fullText.includes(query)) {
            // Find specific pages
            const matchingPages = [];
            data.pageTexts.forEach(pt => {
                if (pt.text.includes(query)) {
                    matchingPages.push(pt.page);
                }
            });

            if (matchingPages.length > 0) {
                results.push({ fileName, pages: matchingPages });
            }
        }
    });

    renderSearchResults(results, query);
}

function renderSearchResults(results, query) {
    if (results.length === 0) {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.innerHTML = `<div class="icon-large">🔍</div>
                         <h3>Nu am găsit rezultate pentru "${query}"</h3>
                         <p>Asigură-te că ai introdus corect seria. Dacă fișierul este imagine, asigură-te că am rulat OCR.</p>`;
        DOM.resultsArea.appendChild(div);
        return;
    }

    const list = document.createElement('div');
    list.style.width = '100%';
    list.style.maxWidth = '800px';
    list.innerHTML = `<h3 style="margin-bottom: 20px;">Am găsit ${results.length} document(e) ce conțin seria.</h3>`;

    results.forEach(res => {
        const card = document.createElement('div');
        card.style.background = 'var(--bg-card)';
        card.style.padding = '16px';
        card.style.borderRadius = '8px';
        card.style.marginBottom = '12px';
        card.style.border = '1px solid var(--border-color)';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.cursor = 'pointer';

        card.innerHTML = `
            <div>
                <h4 style="margin-bottom: 4px; color: var(--accent-primary);">${res.fileName}</h4>
                <p style="color: var(--text-muted); font-size: 0.9rem;">Găsit pe paginile: ${res.pages.join(', ')}</p>
            </div>
            <button class="primary-btn" style="padding: 6px 16px;">Vizualizează</button>
        `;

        card.onclick = () => openViewer(res.fileName, res.pages[0], query);
        list.appendChild(card);
    });

    DOM.resultsArea.appendChild(list);
}

async function openViewer(fileName, pageNum, highlightQuery) {
    if (!STATE.directoryHandle) {
        alert("Trebuie să ai folderul selectat deschis pentru a randa PDF-urile.");
        return;
    }

    try {
        // Find the file handle from directory
        const fileHandle = await STATE.directoryHandle.getFileHandle(fileName, { create: false });
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();

        // Render PDF
        DOM.pdfViewerContainer.classList.remove('hidden');
        DOM.viewerTitle.textContent = `${fileName} - Pagina ${pageNum}`;

        // Hide list
        Array.from(DOM.resultsArea.children).forEach(child => {
            if (child.id !== 'pdf-viewer-container') child.style.display = 'none';
        });

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(pageNum);

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = DOM.pdfCanvas;
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Dimensions for text layer
        const textLayerDiv = DOM.textLayer;
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.left = canvas.offsetLeft + 'px';
        textLayerDiv.style.top = canvas.offsetTop + 'px';

        // Render page
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;

        // Render Text Layer (for highlighting)
        const textContent = await page.getTextContent();
        textLayerDiv.innerHTML = ''; // clear old layer

        const fragment = document.createDocumentFragment();

        textContent.items.forEach(item => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
            const fontAscent = fontHeight;

            const div = document.createElement('span');
            div.textContent = item.str;
            div.style.left = `${tx[4]}px`;
            div.style.top = `${tx[5] - fontAscent}px`;
            div.style.fontSize = `${fontHeight}px`;
            div.style.fontFamily = item.fontName;

            // Fix dimension bounds to force background visibility
            div.style.width = `${item.width * viewport.scale}px`;
            div.style.height = `${fontHeight}px`;
            div.style.lineHeight = 1;
            div.style.position = 'absolute';
            div.style.whiteSpace = 'pre';
            div.style.transformOrigin = '0 0';

            // Apply highlight if it matches our query
            if (highlightQuery && item.str.toLowerCase().includes(highlightQuery.toLowerCase())) {
                div.className = 'highlight-target';
                div.style.color = 'black';
                div.style.backgroundColor = 'rgba(255, 255, 0, 0.7)';
                div.style.marginTop = '-4px';
                div.style.paddingTop = '8px';
                div.style.paddingLeft = '4px';
                div.style.paddingRight = '4px';
                div.style.marginLeft = '-4px';
                div.style.borderRadius = '3px';
                div.style.display = 'inline-block';
                div.style.zIndex = '999';
            } else {
                // For non matched strings, ensure transparent rendering
                div.style.color = 'transparent';
                div.style.backgroundColor = 'transparent';
                div.style.pointerEvents = 'none';
            }

            fragment.appendChild(div);
        });

        textLayerDiv.appendChild(fragment);
        DOM.resultsArea.scrollTop = 0;

    } catch (err) {
        console.error("Eroare deschidere PDF", err);
        alert("Nu am putut deschide PDF-ul pentru vizualizare.");
    }
}

function closeViewer() {
    DOM.pdfViewerContainer.classList.add('hidden');
    // Show list
    Array.from(DOM.resultsArea.children).forEach(child => {
        if (child.id !== 'pdf-viewer-container') child.style.display = 'block';
    });
}

// ==========================================
// 8. EVENT LISTENERS & BOOTSTRAP
// ==========================================

function attachEvents() {
    // Auth
    DOM.authBtn.addEventListener('click', handleLogin);
    DOM.authPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    DOM.btnLock.addEventListener('click', lockApp);

    // Actions
    DOM.btnSelectFolder.addEventListener('click', selectFolder);
    DOM.btnSearch.addEventListener('click', performSearch);
    DOM.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Viewer
    DOM.btnCloseViewer.addEventListener('click', closeViewer);
}

// Boot
window.addEventListener('DOMContentLoaded', async () => {
    attachEvents();

    // Check environment
    if (window.location.protocol === 'file:') {
        console.warn("Rulare din fisier local. Anumite browsere blocheaza IndexedDB. Incercam initializarea...");
    }

    try {
        await initDB();

        // Check if master password exists to update message
        const hash = await getMasterPasswordHash();
        if (!hash) {
            DOM.authMessage.textContent = 'Prima lansare: Setează o parolă de acces securizată pentru fișierele tale.';
        } else {
            DOM.authMessage.textContent = 'Introdu parola de acces pentru a continua.';
        }

        // Show auth screen explicitly
        DOM.authOverlay.classList.add('active');
        DOM.authPassword.focus();

    } catch (err) {
        console.error("Initialization error:", err);
        // Fallback or warning
        DOM.authMessage.textContent = 'Atenție: Meniul offline este restricționat de browser (rulezi din file://). Setează o parolă temporară de sesiune.';
        DOM.authMessage.style.color = 'var(--warning)';

        // Setup temporary session memory if DB fails
        STATE.db = null;

        // We bypass the persistent DB check and allow login with any pass for this session
        DOM.authBtn.onclick = () => {
            const inputPass = DOM.authPassword.value.trim();
            if (inputPass) {
                // Mock successful login for session
                STATE.isAuthenticated = true;
                DOM.authOverlay.classList.remove('active');
                DOM.appContainer.classList.remove('hidden');
                DOM.authBtn.textContent = 'Deblochează';
                DOM.authBtn.disabled = false;
            }
        }
    }
});

// Sidebar Panel Script - Handles UI interactions, Excel upload, Page Markers, Assertions, and Auto-Monitor

// State
let isRecording = false;
let isAssertionMode = false;
let isAutoMonitorEnabled = false;
let currentRecording = null;
let savedRecordings = [];
let selectedRecording = null;
let uploadedFiles = [];

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const recordingName = document.getElementById('recordingName');
const recordingStatus = document.getElementById('recordingStatus');
const actionCount = document.getElementById('actionCount');
const actionsList = document.getElementById('actionsList');
const exportPanel = document.getElementById('exportPanel');
const recordingsList = document.getElementById('recordingsList');
const clearAllBtn = document.getElementById('clearAllBtn');

// Page Marker Elements
const pageMarkerPanel = document.getElementById('pageMarkerPanel');
const pageMarkerName = document.getElementById('pageMarkerName');
const addPageMarkerBtn = document.getElementById('addPageMarkerBtn');

// Assertion Elements
const assertionBtn = document.getElementById('assertionBtn');
const assertionHint = document.getElementById('assertionHint');

// Auto Monitor Elements
const autoMonitorToggle = document.getElementById('autoMonitorToggle');
const monitorStatus = document.getElementById('monitorStatus');
const currentPageName = document.getElementById('currentPageName');

// Excel Upload Elements
const uploadArea = document.getElementById('uploadArea');
const excelFileInput = document.getElementById('excelFileInput');
const filesList = document.getElementById('filesList');
const clearDataBtn = document.getElementById('clearDataBtn');
const dataPreview = document.getElementById('dataPreview');
const previewContent = document.getElementById('previewContent');
const closePreviewBtn = document.getElementById('closePreviewBtn');

// Modal Elements
const recordingModal = document.getElementById('recordingModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalRecordingName = document.getElementById('modalRecordingName');
const modalActionCount = document.getElementById('modalActionCount');
const modalDate = document.getElementById('modalDate');
const modalUrl = document.getElementById('modalUrl');
const modalActionsList = document.getElementById('modalActionsList');
const deleteRecordingBtn = document.getElementById('deleteRecordingBtn');
const saveRecordingBtn = document.getElementById('saveRecordingBtn');

// Tab Navigation
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadInitialState();
  setupEventListeners();
  await loadUploadedFiles();
});

async function loadInitialState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (response) {
    isRecording = response.isRecording;
    if (response.currentRecording) {
      currentRecording = response.currentRecording;
      recordingName.value = currentRecording.name;
    }
  }
  
  await loadSavedRecordings();
  updateUI();
}

function setupEventListeners() {
  // Tab navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // Recording controls
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  
  // Page Marker
  addPageMarkerBtn.addEventListener('click', addPageMarker);
  pageMarkerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPageMarker();
  });
  
  // Assertion Mode
  assertionBtn?.addEventListener('click', toggleAssertionMode);
  
  // Auto Monitor
  autoMonitorToggle?.addEventListener('change', toggleAutoMonitor);
  
  // History
  clearAllBtn.addEventListener('click', clearAllRecordings);
  
  // Modal
  modalClose.addEventListener('click', closeModal);
  document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
  deleteRecordingBtn.addEventListener('click', deleteSelectedRecording);
  saveRecordingBtn.addEventListener('click', saveRecordingChanges);
  
  // Export buttons
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', (e) => handleExport(e.currentTarget.dataset.format));
  });
  
  // Excel Upload
  setupExcelUpload();
  
  // Listen for new actions from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Sidebar] Message received:', message.type);
    
    if (message.type === 'NEW_ACTION') {
      if (!currentRecording) {
        currentRecording = { actions: [] };
      }
      currentRecording.actions = currentRecording.actions || [];
      currentRecording.actions.push(message.action);
      
      const count = message.actionCount || currentRecording.actions.length;
      actionCount.textContent = `${count} action${count !== 1 ? 's' : ''}`;
      renderCurrentActions();
      console.log('[Sidebar] Action added:', message.action.type, 'Total:', count);
      
      // Update page name display if auto-detected
      if (message.autoPageChange && message.pageName) {
        currentPageName.textContent = message.pageName;
      }
    } else if (message.type === 'ASSERTION_COMPLETE') {
      // Turn off assertion mode in UI
      exitAssertionModeUI();
    }
    
    // Must return true for async response
    return true;
  });
}

// ===== ASSERTION MODE =====

async function toggleAssertionMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  if (isAssertionMode) {
    exitAssertionModeUI();
    await chrome.tabs.sendMessage(tab.id, { type: 'EXIT_ASSERTION_MODE' });
  } else {
    enterAssertionModeUI();
    await chrome.tabs.sendMessage(tab.id, { type: 'ENTER_ASSERTION_MODE' });
  }
}

function enterAssertionModeUI() {
  isAssertionMode = true;
  assertionBtn?.classList.add('active');
  assertionBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12"></path>
    </svg>
    Cancel Assertion
  `;
  if (assertionHint) assertionHint.style.display = 'block';
}

function exitAssertionModeUI() {
  isAssertionMode = false;
  assertionBtn?.classList.remove('active');
  assertionBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
    Add Assertion
  `;
  if (assertionHint) assertionHint.style.display = 'none';
}

// ===== AUTO PAGE MONITOR =====

async function toggleAutoMonitor() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  isAutoMonitorEnabled = autoMonitorToggle.checked;
  
  if (isAutoMonitorEnabled) {
    monitorStatus.style.display = 'flex';
    currentPageName.textContent = 'Detecting...';
    
    // Start monitoring in content script
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PAGE_MONITOR' });
      
      // Get current page name
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_PAGE' });
      if (response?.pageName) {
        currentPageName.textContent = response.pageName;
      } else {
        currentPageName.textContent = 'Not detected (element not found)';
      }
    } catch (e) {
      currentPageName.textContent = 'Error starting monitor';
    }
  } else {
    monitorStatus.style.display = 'none';
    await chrome.tabs.sendMessage(tab.id, { type: 'STOP_PAGE_MONITOR' }).catch(() => {});
  }
}

// ===== EXCEL UPLOAD =====

function setupExcelUpload() {
  uploadArea.addEventListener('click', () => excelFileInput.click());
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleExcelFile(files[0]);
    }
  });
  
  excelFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleExcelFile(e.target.files[0]);
    }
  });
  
  clearDataBtn?.addEventListener('click', clearAllUploadedFiles);
  closePreviewBtn?.addEventListener('click', () => {
    dataPreview.style.display = 'none';
  });
}

async function handleExcelFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    alert('Please upload a valid Excel file (.xlsx or .xls)');
    return;
  }
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    const sheets = {};
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      sheets[sheetName] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    });
    
    const fileData = {
      id: `file_${Date.now()}`,
      name: file.name,
      size: file.size,
      uploadedAt: Date.now(),
      sheets: sheets,
      sheetNames: workbook.SheetNames
    };
    
    uploadedFiles.push(fileData);
    await saveUploadedFiles();
    renderUploadedFiles();
    
    // Show preview of first sheet
    showDataPreview(fileData, workbook.SheetNames[0]);
    
  } catch (error) {
    console.error('Error parsing Excel file:', error);
    alert('Error parsing Excel file. Please check the file format.');
  }
}

async function saveUploadedFiles() {
  // Save to chrome.storage for persistence
  await chrome.storage.local.set({ uploadedFiles });
}

async function loadUploadedFiles() {
  const result = await chrome.storage.local.get('uploadedFiles');
  uploadedFiles = result.uploadedFiles || [];
  renderUploadedFiles();
}

function renderUploadedFiles() {
  if (uploadedFiles.length === 0) {
    filesList.innerHTML = `
      <div class="empty-state small">
        <p>No data files uploaded</p>
      </div>
    `;
    return;
  }
  
  filesList.innerHTML = uploadedFiles.map(file => `
    <div class="file-item" data-id="${file.id}">
      <span class="file-icon">📊</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">${formatFileSize(file.size)} • ${file.sheetNames?.length || 0} sheets</div>
      </div>
      <div class="file-actions">
        <button class="view-btn" title="Preview">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="delete" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners
  filesList.querySelectorAll('.file-item').forEach(item => {
    const id = item.dataset.id;
    
    item.querySelector('.view-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const file = uploadedFiles.find(f => f.id === id);
      if (file) showDataPreview(file, file.sheetNames[0]);
    });
    
    item.querySelector('.delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      uploadedFiles = uploadedFiles.filter(f => f.id !== id);
      await saveUploadedFiles();
      renderUploadedFiles();
      dataPreview.style.display = 'none';
    });
  });
}

function showDataPreview(fileData, sheetName) {
  const data = fileData.sheets[sheetName];
  if (!data || data.length === 0) {
    previewContent.innerHTML = '<p>No data in this sheet</p>';
    dataPreview.style.display = 'block';
    return;
  }
  
  const headers = data[0] || [];
  const rows = data.slice(1, 11); // Show first 10 rows
  
  let tableHtml = `<table class="preview-table"><thead><tr>`;
  headers.forEach(h => {
    tableHtml += `<th>${escapeHtml(String(h || ''))}</th>`;
  });
  tableHtml += `</tr></thead><tbody>`;
  
  rows.forEach(row => {
    tableHtml += '<tr>';
    headers.forEach((_, i) => {
      tableHtml += `<td>${escapeHtml(String(row[i] || ''))}</td>`;
    });
    tableHtml += '</tr>';
  });
  
  tableHtml += '</tbody></table>';
  
  if (data.length > 11) {
    tableHtml += `<p style="margin-top: 12px; color: var(--text-muted); font-size: 12px;">Showing 10 of ${data.length - 1} rows</p>`;
  }
  
  previewContent.innerHTML = tableHtml;
  dataPreview.style.display = 'block';
}

async function clearAllUploadedFiles() {
  if (uploadedFiles.length === 0) return;
  if (confirm('Delete all uploaded files?')) {
    uploadedFiles = [];
    await saveUploadedFiles();
    renderUploadedFiles();
    dataPreview.style.display = 'none';
  }
}

// ===== PAGE MARKER =====

async function addPageMarker() {
  const pageName = pageMarkerName.value.trim();
  if (!pageName) {
    pageMarkerName.focus();
    return;
  }
  
  // Send page marker as a special action
  await chrome.runtime.sendMessage({
    type: 'ADD_PAGE_MARKER',
    pageName: pageName
  });
  
  // Clear input
  pageMarkerName.value = '';
}

// ===== TAB NAVIGATION =====

function switchTab(tabName) {
  navTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}Tab`);
  });
  
  if (tabName === 'history') {
    loadSavedRecordings();
  }
}

// ===== RECORDING =====

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) {
    alert('No active tab found');
    return;
  }
  
  // Generate name with timestamp if not provided
  const timestamp = new Date().toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  const name = recordingName.value.trim() || `Recording - ${timestamp}`;
  
  // Clear previous recording when starting new one
  currentRecording = {
    name: name,
    actions: [],
    startTime: Date.now(),
    url: tab.url
  };
  
  // Hide export panel for new recording
  exportPanel.style.display = 'none';
  
  await chrome.runtime.sendMessage({ 
    type: 'START_RECORDING', 
    tabId: tab.id,
    name: name
  });
  
  isRecording = true;
  
  // If auto-monitor is enabled, start page monitor in all frames
  if (autoMonitorToggle?.checked) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PAGE_MONITOR' });
      console.log('[Sidebar] Started page monitor with recording');
    } catch (e) {
      console.log('[Sidebar] Could not start page monitor:', e);
    }
  }
  
  updateUI();
}

async function stopRecording() {
  const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  
  isRecording = false;
  
  if (response?.recording) {
    // Keep the recording with all actions visible
    currentRecording = response.recording;
    console.log('[Sidebar] Recording stopped with', currentRecording.actions?.length || 0, 'actions');
  }
  
  updateUI();
  
  // Show export panel if we have actions
  if (currentRecording?.actions?.length > 0) {
    exportPanel.style.display = 'block';
  }
  
  // Refresh history to show the auto-saved recording
  await loadSavedRecordings();
}

function updateUI() {
  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
  recordingName.disabled = isRecording;
  
  // Show/hide page marker panel during recording
  pageMarkerPanel.style.display = isRecording ? 'block' : 'none';
  
  const actionLen = currentRecording?.actions?.length || 0;
  
  if (isRecording) {
    recordingStatus.classList.add('recording');
    recordingStatus.querySelector('.status-text').textContent = 'Recording in progress...';
  } else {
    recordingStatus.classList.remove('recording');
    if (actionLen > 0) {
      recordingStatus.querySelector('.status-text').textContent = `Recording saved (${actionLen} actions)`;
    } else {
      recordingStatus.querySelector('.status-text').textContent = 'Ready to record';
    }
  }
  
  actionCount.textContent = `${actionLen} action${actionLen !== 1 ? 's' : ''}`;
  
  renderCurrentActions();
}

function renderCurrentActions() {
  const actions = currentRecording?.actions || [];
  
  if (actions.length === 0) {
    actionsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/>
        </svg>
        <p>Click "Start Recording" to capture actions</p>
      </div>
    `;
    return;
  }
  
  actionsList.innerHTML = actions.map((action, index) => renderActionItem(action, index + 1)).join('');
  actionsList.scrollTop = actionsList.scrollHeight;
}

function renderActionItem(action, number) {
  // Check if it's a page marker
  if (action.type === 'page-marker') {
    return `
      <div class="action-item page-marker">
        <div class="action-number">${number}</div>
        <div class="action-details">
          <div class="action-header">
            <span class="action-type page-marker">PAGE</span>
          </div>
          <div class="action-selector">// === ${escapeHtml(action.pageName)} ===</div>
          ${action.description ? `<div class="action-description">${escapeHtml(action.description)}</div>` : ''}
        </div>
      </div>
    `;
  }
  
  // Check if it's an assertion
  if (action.type === 'assertion') {
    const xpath = action.xpath || action.selectors?.xpath || 'N/A';
    const shortXPath = xpath.length > 80 ? xpath.slice(0, 80) + '...' : xpath;
    
    return `
      <div class="action-item assertion">
        <div class="action-number">${number}</div>
        <div class="action-details">
          <div class="action-header">
            <span class="action-type assertion">ASSERT</span>
          </div>
          <div class="action-selector">${escapeHtml(shortXPath)}</div>
          ${action.description ? `<div class="action-description">${escapeHtml(action.description)}</div>` : ''}
          <div class="action-value">Text: "${escapeHtml(action.textContent || '')}"</div>
        </div>
      </div>
    `;
  }
  
  const badges = [];
  if (action.iframe?.length > 0) {
    badges.push('<span class="badge iframe">iframe</span>');
  }
  if (action.shadow?.length > 0) {
    badges.push('<span class="badge shadow">shadow</span>');
  }
  
  const xpath = action.xpath || action.selectors?.xpath || 'N/A';
  const shortXPath = xpath.length > 80 ? xpath.slice(0, 80) + '...' : xpath;
  
  // Show description if available
  let descriptionDisplay = '';
  if (action.description) {
    descriptionDisplay = `<div class="action-description">${escapeHtml(action.description)}</div>`;
  }
  
  let valueDisplay = '';
  if (action.value !== undefined && action.value !== null && action.value !== '') {
    valueDisplay = `<div class="action-value">Value: "${escapeHtml(String(action.value))}"</div>`;
  } else if (action.key) {
    valueDisplay = `<div class="action-value">Key: ${action.key}</div>`;
  }
  
  // Show iframe XPath if present
  let iframeDisplay = '';
  if (action.iframe?.length > 0) {
    const iframeInfo = action.iframe[0];
    // Build proper iframe selector - prefer xpath, then name, then id, then other attributes
    let iframeSelector = 'iframe';
    if (iframeInfo?.xpath) {
      iframeSelector = iframeInfo.xpath;
    } else if (iframeInfo?.name) {
      iframeSelector = `iframe[name="${iframeInfo.name}"]`;
    } else if (iframeInfo?.id) {
      iframeSelector = `iframe[id="${iframeInfo.id}"]`;
    } else if (iframeInfo?.title) {
      iframeSelector = `iframe[title="${iframeInfo.title}"]`;
    } else if (iframeInfo?.src) {
      // Use partial src match for long URLs
      const srcPart = iframeInfo.src.length > 50 ? iframeInfo.src.slice(0, 50) : iframeInfo.src;
      iframeSelector = `iframe[src*="${srcPart}"]`;
    } else if (typeof iframeInfo?.index === 'number') {
      iframeSelector = `(//iframe)[${iframeInfo.index + 1}]`;
    }
    iframeDisplay = `<div class="action-iframe">↳ iframe: ${escapeHtml(iframeSelector)}</div>`;
  }
  
  // Show shadow DOM path if present
  let shadowDisplay = '';
  if (action.shadow?.length > 0) {
    const shadowInfo = action.shadow.map(s => s.hostXPath).join(' → ');
    shadowDisplay = `<div class="action-shadow">↳ shadow: ${escapeHtml(shadowInfo)}</div>`;
  }
  
  return `
    <div class="action-item">
      <div class="action-number">${number}</div>
      <div class="action-details">
        <div class="action-header">
          <span class="action-type ${action.type}">${action.type}</span>
          <div class="action-badges">${badges.join('')}</div>
        </div>
        <div class="action-selector">${escapeHtml(shortXPath)}</div>
        ${descriptionDisplay}
        ${valueDisplay}
        ${iframeDisplay}
        ${shadowDisplay}
      </div>
    </div>
  `;
}

// ===== HISTORY =====

async function loadSavedRecordings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SAVED_RECORDINGS' });
  savedRecordings = response?.recordings || [];
  renderSavedRecordings();
}

function renderSavedRecordings() {
  if (savedRecordings.length === 0) {
    recordingsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
        <p>No saved recordings yet</p>
      </div>
    `;
    return;
  }
  
  recordingsList.innerHTML = savedRecordings.map(recording => `
    <div class="recording-item" data-id="${recording.id}">
      <div class="recording-icon">🎬</div>
      <div class="recording-info">
        <div class="recording-name">${escapeHtml(recording.name)}</div>
        <div class="recording-meta">
          <span>${recording.actions?.length || 0} actions</span>
          <span>${formatDate(recording.startTime)}</span>
        </div>
      </div>
      <div class="recording-actions">
        <button class="recording-action-btn view-btn" title="View Details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <button class="recording-action-btn delete-btn" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
  
  recordingsList.querySelectorAll('.recording-item').forEach(item => {
    const id = item.dataset.id;
    
    item.querySelector('.view-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openRecordingModal(id);
    });
    
    item.querySelector('.delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Delete this recording?')) {
        await chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', id });
        await loadSavedRecordings();
      }
    });
    
    item.addEventListener('click', () => openRecordingModal(id));
  });
}

// ===== MODAL =====

function openRecordingModal(id) {
  selectedRecording = savedRecordings.find(r => r.id === id);
  if (!selectedRecording) return;
  
  modalTitle.textContent = 'Recording Details';
  modalRecordingName.value = selectedRecording.name;
  modalActionCount.textContent = selectedRecording.actions?.length || 0;
  modalDate.textContent = formatDate(selectedRecording.startTime, true);
  modalUrl.textContent = selectedRecording.url || '-';
  
  const actions = selectedRecording.actions || [];
  if (actions.length > 0) {
    modalActionsList.innerHTML = actions.map((action, index) => renderActionItem(action, index + 1)).join('');
  } else {
    modalActionsList.innerHTML = '<div class="empty-state"><p>No actions recorded</p></div>';
  }
  
  recordingModal.querySelectorAll('.export-btn').forEach(btn => {
    btn.onclick = () => handleExport(btn.dataset.format, selectedRecording);
  });
  
  recordingModal.classList.add('open');
}

function closeModal() {
  recordingModal.classList.remove('open');
  selectedRecording = null;
}

async function deleteSelectedRecording() {
  if (!selectedRecording) return;
  
  if (confirm('Delete this recording?')) {
    await chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', id: selectedRecording.id });
    closeModal();
    await loadSavedRecordings();
  }
}

async function saveRecordingChanges() {
  if (!selectedRecording) return;
  
  const newName = modalRecordingName.value.trim();
  if (newName && newName !== selectedRecording.name) {
    await chrome.runtime.sendMessage({ 
      type: 'RENAME_RECORDING', 
      id: selectedRecording.id,
      newName: newName
    });
    await loadSavedRecordings();
  }
  
  closeModal();
}

async function clearAllRecordings() {
  if (savedRecordings.length === 0) return;
  
  if (confirm('Delete all saved recordings?')) {
    for (const recording of savedRecordings) {
      await chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', id: recording.id });
    }
    await loadSavedRecordings();
  }
}

// ===== EXPORT =====

function handleExport(format, recording = null) {
  const rec = recording || currentRecording;
  if (!rec || !rec.actions || rec.actions.length === 0) {
    alert('No actions to export');
    return;
  }
  
  let content, filename, mimeType;
  
  switch (format) {
    case 'json':
      content = exportToJSON(rec);
      filename = `${sanitizeFilename(rec.name)}.json`;
      mimeType = 'application/json';
      break;
    case 'playwright':
      content = exportToPlaywright(rec);
      filename = `${sanitizeFilename(rec.name)}.spec.ts`;
      mimeType = 'text/typescript';
      break;
    case 'selenium-python':
      content = exportToSeleniumPython(rec);
      filename = `${sanitizeFilename(rec.name)}.py`;
      mimeType = 'text/x-python';
      break;
    case 'selenium-java':
      content = exportToSeleniumJava(rec);
      filename = `${sanitizeFilename(rec.name)}.java`;
      mimeType = 'text/x-java';
      break;
    default:
      return;
  }
  
  downloadFile(content, filename, mimeType);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== UTILITIES =====

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp, full = false) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (full) return date.toLocaleString();
  
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Side Panel JavaScript - Action Recorder Extension
// Handles UI interactions, recording coordination, and live action display

(function() {
  'use strict';
  
  // ==================== STATE ====================
  let state = {
    currentTab: 'record',
    testSuites: [],
    selectedSuite: null,
    selectedTestCase: null,
    isRecording: false,
    recordedActions: [],
    currentTabId: null,
    extractedTestCases: null,
    pendingUpload: null
  };
  
  // ==================== DOM ELEMENTS ====================
  const elements = {
    // Navigation
    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    
    // Record Tab
    testSuiteSelect: document.getElementById('testSuiteSelect'),
    testCaseSelect: document.getElementById('testCaseSelect'),
    testCaseGroup: document.getElementById('testCaseGroup'),
    addNewSuiteBtn: document.getElementById('addNewSuiteBtn'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    recordingStatus: document.getElementById('recordingStatus'),
    recordingTools: document.getElementById('recordingTools'),
    actionsList: document.getElementById('actionsList'),
    actionCount: document.getElementById('actionCount'),
    downloadSection: document.getElementById('downloadSection'),
    downloadBtn: document.getElementById('downloadBtn'),
    
    // Page Marker
    pageMarkerName: document.getElementById('pageMarkerName'),
    addPageMarkerBtn: document.getElementById('addPageMarkerBtn'),
    
    // Assertions
    assertElementBtn: document.getElementById('assertElementBtn'),
    assertTextBtn: document.getElementById('assertTextBtn'),
    assertionHint: document.getElementById('assertionHint'),
    
    // Add New Tab
    uploadArea: document.getElementById('uploadArea'),
    excelFileInput: document.getElementById('excelFileInput'),
    extractionResult: document.getElementById('extractionResult'),
    suiteNameInput: document.getElementById('suiteNameInput'),
    extractedTestCaseCount: document.getElementById('extractedTestCaseCount'),
    extractedCasesList: document.getElementById('extractedCasesList'),
    cancelUploadBtn: document.getElementById('cancelUploadBtn'),
    confirmUploadBtn: document.getElementById('confirmUploadBtn'),
    existingSuitesList: document.getElementById('existingSuitesList'),
    
    // History Tab
    testSuitesTree: document.getElementById('testSuitesTree'),
    goToUploadBtn: document.getElementById('goToUploadBtn')
  };
  
  // ==================== INITIALIZATION ====================
  async function init() {
    console.log('[SidePanel] Initializing...');
    
    // Load test suites from storage
    await loadTestSuites();
    
    // Setup event listeners
    setupNavigationListeners();
    setupRecordTabListeners();
    setupAddNewTabListeners();
    setupHistoryTabListeners();
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);
    
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      state.currentTabId = tab.id;
      console.log('[SidePanel] Current tab:', tab.id);
    }
    
    // Render initial UI
    renderTestSuiteDropdown();
    renderExistingSuites();
    renderHistoryTree();
    
    console.log('[SidePanel] Initialization complete');
  }
  
  // ==================== STORAGE ====================
  async function loadTestSuites() {
    try {
      const result = await chrome.storage.local.get(['testSuites']);
      state.testSuites = result.testSuites || [];
      console.log('[SidePanel] Loaded test suites:', state.testSuites.length);
    } catch (error) {
      console.error('[SidePanel] Error loading test suites:', error);
      state.testSuites = [];
    }
  }
  
  async function saveTestSuites() {
    try {
      await chrome.storage.local.set({ testSuites: state.testSuites });
      console.log('[SidePanel] Saved test suites:', state.testSuites.length);
    } catch (error) {
      console.error('[SidePanel] Error saving test suites:', error);
    }
  }
  
  // ==================== NAVIGATION ====================
  function setupNavigationListeners() {
    elements.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        switchTab(targetTab);
      });
    });
  }
  
  function switchTab(tabName) {
    state.currentTab = tabName;
    
    // Update tab buttons
    elements.navTabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    // Update tab content
    elements.tabContents.forEach(content => {
      if (content.id === `${tabName}Tab`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
    
    console.log('[SidePanel] Switched to tab:', tabName);
  }
  
  // ==================== RECORD TAB ====================
  function setupRecordTabListeners() {
    // Test Suite Selection
    elements.testSuiteSelect.addEventListener('change', handleTestSuiteChange);
    elements.addNewSuiteBtn.addEventListener('click', () => switchTab('addnew'));
    
    // Test Case Selection
    elements.testCaseSelect.addEventListener('change', handleTestCaseChange);
    
    // Recording Controls
    elements.startBtn.addEventListener('click', startRecording);
    elements.stopBtn.addEventListener('click', stopRecording);
    
    // Page Marker
    elements.addPageMarkerBtn.addEventListener('click', addPageMarker);
    elements.pageMarkerName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addPageMarker();
    });
    
    // Assertions
    elements.assertElementBtn.addEventListener('click', () => startAssertion('element'));
    elements.assertTextBtn.addEventListener('click', () => startAssertion('text'));
    
    // Download
    elements.downloadBtn.addEventListener('click', downloadRecording);
  }
  
  function renderTestSuiteDropdown() {
    elements.testSuiteSelect.innerHTML = '<option value="">Select a test suite...</option>';
    
    state.testSuites.forEach((suite, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = suite.name;
      elements.testSuiteSelect.appendChild(option);
    });
    
    console.log('[SidePanel] Rendered test suite dropdown:', state.testSuites.length);
  }
  
  function handleTestSuiteChange() {
    const selectedIndex = elements.testSuiteSelect.value;
    
    if (selectedIndex === '') {
      state.selectedSuite = null;
      state.selectedTestCase = null;
      elements.testCaseGroup.style.display = 'none';
      elements.testCaseSelect.disabled = true;
      elements.startBtn.disabled = true;
      updateRecordingStatus('Select a test suite to begin');
      return;
    }
    
    state.selectedSuite = state.testSuites[selectedIndex];
    state.selectedTestCase = null;
    
    // Show and populate test case dropdown
    elements.testCaseGroup.style.display = 'block';
    elements.testCaseSelect.disabled = false;
    elements.testCaseSelect.innerHTML = '<option value="">Select a test case...</option>';
    
    state.selectedSuite.testCases.forEach((testCase, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = testCase.name;
      elements.testCaseSelect.appendChild(option);
    });
    
    elements.startBtn.disabled = true;
    updateRecordingStatus('Select a test case to begin');
    
    console.log('[SidePanel] Selected suite:', state.selectedSuite.name);
  }
  
  function handleTestCaseChange() {
    const selectedIndex = elements.testCaseSelect.value;
    
    if (selectedIndex === '') {
      state.selectedTestCase = null;
      elements.startBtn.disabled = true;
      updateRecordingStatus('Select a test case to begin');
      return;
    }
    
    state.selectedTestCase = state.selectedSuite.testCases[selectedIndex];
    elements.startBtn.disabled = false;
    updateRecordingStatus('Ready to record');
    
    console.log('[SidePanel] Selected test case:', state.selectedTestCase.name);
  }
  
  async function startRecording() {
    if (!state.selectedSuite || !state.selectedTestCase) {
      console.error('[SidePanel] No test case selected');
      return;
    }
    
    console.log('[SidePanel] Starting recording...');
    
    state.isRecording = true;
    state.recordedActions = [];
    
    // Update UI
    elements.startBtn.style.display = 'none';
    elements.stopBtn.style.display = 'flex';
    elements.stopBtn.disabled = false;
    elements.recordingTools.style.display = 'block';
    elements.downloadSection.style.display = 'none';
    
    // Disable dropdowns during recording
    elements.testSuiteSelect.disabled = true;
    elements.testCaseSelect.disabled = true;
    
    updateRecordingStatus('Recording...', true);
    
    // Clear actions list and show empty state temporarily
    renderActions();
    
    // Tell background script to start recording
    try {
      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: state.currentTabId,
        name: `${state.selectedSuite.name} - ${state.selectedTestCase.name}`
      });
      
      console.log('[SidePanel] Recording started successfully');
    } catch (error) {
      console.error('[SidePanel] Error starting recording:', error);
      stopRecording();
    }
  }
  
  async function stopRecording() {
    console.log('[SidePanel] Stopping recording...');
    
    state.isRecording = false;
    
    // Update UI
    elements.startBtn.style.display = 'flex';
    elements.stopBtn.style.display = 'none';
    elements.recordingTools.style.display = 'none';
    
    // Re-enable dropdowns
    elements.testSuiteSelect.disabled = false;
    elements.testCaseSelect.disabled = false;
    
    updateRecordingStatus(`Recorded ${state.recordedActions.length} actions`, false);
    
    // Show download button if there are actions
    if (state.recordedActions.length > 0) {
      elements.downloadSection.style.display = 'block';
    }
    
    // Tell background script to stop recording
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      console.log('[SidePanel] Recording stopped, received:', response);
      
      // Update recorded actions from background
      if (response.recording && response.recording.actions) {
        state.recordedActions = response.recording.actions;
        renderActions();
      }
    } catch (error) {
      console.error('[SidePanel] Error stopping recording:', error);
    }
  }
  
  function updateRecordingStatus(text, isRecording = false) {
    const statusIndicator = elements.recordingStatus.querySelector('.status-indicator');
    const statusText = elements.recordingStatus.querySelector('.status-text');
    
    statusText.textContent = text;
    
    if (isRecording) {
      statusIndicator.style.background = 'var(--danger)';
      statusIndicator.style.animation = 'pulse 2s infinite';
    } else {
      statusIndicator.style.background = 'var(--text-muted)';
      statusIndicator.style.animation = 'none';
    }
  }
  
  async function addPageMarker() {
    const pageName = elements.pageMarkerName.value.trim();
    
    if (!pageName) {
      console.warn('[SidePanel] Empty page marker name');
      return;
    }
    
    console.log('[SidePanel] Adding page marker:', pageName);
    
    // Tell background script to add page marker
    try {
      await chrome.runtime.sendMessage({
        type: 'ADD_PAGE_MARKER',
        pageName
      });
      
      elements.pageMarkerName.value = '';
      console.log('[SidePanel] Page marker added successfully');
    } catch (error) {
      console.error('[SidePanel] Error adding page marker:', error);
    }
  }
  
  async function startAssertion(type) {
    console.log('[SidePanel] Starting assertion:', type);
    
    // Show hint
    elements.assertionHint.style.display = 'flex';
    
    // Highlight active button
    if (type === 'element') {
      elements.assertElementBtn.classList.add('active');
      elements.assertTextBtn.classList.remove('active');
    } else {
      elements.assertTextBtn.classList.add('active');
      elements.assertElementBtn.classList.remove('active');
    }
    
    // Tell content script to start assertion mode
    try {
      await chrome.tabs.sendMessage(state.currentTabId, {
        type: 'ENTER_ASSERTION_MODE',
        assertionType: type
      });
    } catch (error) {
      console.error('[SidePanel] Error starting assertion:', error);
      elements.assertionHint.style.display = 'none';
    }
  }
  
  // ==================== ACTION RENDERING ====================
  function renderActions() {
    elements.actionCount.textContent = `${state.recordedActions.length} action${state.recordedActions.length !== 1 ? 's' : ''}`;
    
    if (state.recordedActions.length === 0) {
      elements.actionsList.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/>
          </svg>
          <p>No actions recorded yet</p>
          <span class="hint">Start recording to capture interactions</span>
        </div>
      `;
      return;
    }
    
    elements.actionsList.innerHTML = '';
    
    state.recordedActions.forEach((action, index) => {
      const actionItem = createActionElement(action, index);
      elements.actionsList.appendChild(actionItem);
    });
    
    // Scroll to bottom to show latest action
    elements.actionsList.scrollTop = elements.actionsList.scrollHeight;
  }
  
  function createActionElement(action, index) {
    const item = document.createElement('div');
    item.className = 'action-item';
    item.dataset.index = index;
    
    // Determine action type and styling
    let actionTypeClass = 'action-default';
    let actionIcon = '•';
    let actionSummary = '';
    
    if (action.type === 'page-marker') {
      actionTypeClass = 'action-page-marker';
      actionIcon = '📄';
      actionSummary = action.pageName || 'Page Marker';
      
      item.innerHTML = `
        <div class="action-header">
          <div class="action-summary page-marker-summary">
            <span class="action-icon">${actionIcon}</span>
            <span class="action-text">${escapeHtml(actionSummary)}</span>
          </div>
        </div>
      `;
      
      return item;
    }
    
    if (action.type === 'assertion') {
      actionTypeClass = 'action-assertion';
      actionIcon = '✓';
      actionSummary = `Assert ${action.assertionType === 'text' ? 'Text' : 'Element'}`;
      if (action.expectedValue) {
        actionSummary += ` - "${action.expectedValue}"`;
      }
    } else {
      // Regular action - use description if available
      if (action.description) {
        actionSummary = action.description;
      } else {
        const actionVerb = getActionVerb(action.type);
        const elementDesc = getElementDescription(action);
        actionSummary = `${actionVerb} - ${elementDesc}`;
      }
    }
    
    item.classList.add(actionTypeClass);
    
    // Extract iframe and shadow info
    const iframeInfo = extractIframeInfo(action);
    const shadowInfo = extractShadowInfo(action);
    const elementTag = action.element?.tag || '';
    
    // Create expand/collapse functionality
    const hasDetails = action.xpath || iframeInfo || shadowInfo.levels > 0;
    
    item.innerHTML = `
      <div class="action-header" ${hasDetails ? 'style="cursor: pointer;"' : ''}>
        <div class="action-summary">
          ${hasDetails ? '<span class="expand-arrow">▶</span>' : ''}
          <span class="action-text">${escapeHtml(actionSummary)}</span>
        </div>
      </div>
      ${hasDetails ? `
        <div class="action-details">
          ${action.xpath ? `<div class="detail-row"><span class="detail-label">xpath:</span> <span class="detail-value">${escapeHtml(action.xpath)}</span></div>` : ''}
          ${action.type ? `<div class="detail-row"><span class="detail-label">action:</span> <span class="detail-value">${escapeHtml(action.type)}</span></div>` : ''}
          ${elementTag ? `<div class="detail-row"><span class="detail-label">element:</span> <span class="detail-value">${escapeHtml(elementTag)}</span></div>` : ''}
          ${action.key ? `<div class="detail-row"><span class="detail-label">key:</span> <span class="detail-value">${escapeHtml(action.key)}</span></div>` : ''}
          ${action.value ? `<div class="detail-row"><span class="detail-label">value:</span> <span class="detail-value">${escapeHtml(action.value)}</span></div>` : ''}
          ${iframeInfo ? `<div class="detail-row"><span class="detail-label">iframe:</span> <span class="detail-value">${escapeHtml(iframeInfo)}</span></div>` : ''}
          ${shadowInfo.levels > 0 ? `<div class="detail-row"><span class="detail-label">shadow levels:</span> <span class="detail-value">${shadowInfo.levels}</span></div>` : ''}
          ${shadowInfo.hosts && shadowInfo.hosts.length > 0 ? shadowInfo.hosts.map((h, i) => `
            <div class="detail-row"><span class="detail-label">shadow host ${i + 1}:</span> <span class="detail-value">${escapeHtml(h.hostXPath || '(unknown host)')}</span></div>
            ${h.innerXPath ? `<div class="detail-row"><span class="detail-label">inner xpath:</span> <span class="detail-value">${escapeHtml(h.innerXPath)}</span></div>` : ''}
            ${h.innerSelector ? `<div class="detail-row"><span class="detail-label">inner selector:</span> <span class="detail-value">${escapeHtml(h.innerSelector)}</span></div>` : ''}
          `).join('') : ''}
          ${action.assertionType ? `<div class="detail-row"><span class="detail-label">assertion type:</span> <span class="detail-value">${escapeHtml(action.assertionType)}</span></div>` : ''}
          ${action.expectedValue ? `<div class="detail-row"><span class="detail-label">expected:</span> <span class="detail-value">${escapeHtml(action.expectedValue)}</span></div>` : ''}
        </div>
      ` : ''}
    `;
    
    // Add click handler for expand/collapse
    if (hasDetails) {
      const header = item.querySelector('.action-header');
      header.addEventListener('click', () => {
        item.classList.toggle('expanded');
      });
    }
    
    return item;
  }
  
  function extractIframeInfo(action) {
    if (!action.iframe) return null;
    
    // If we have direct frameElement metadata, prefer name/id
    if (action.frameElement && (action.frameElement.name || action.frameElement.id)) {
      const name = action.frameElement.name ? `iframe[name="${action.frameElement.name}"]` : null;
      const id = action.frameElement.id ? `iframe[id="${action.frameElement.id}"]` : null;
      return name || id;
    }

    if (Array.isArray(action.iframe) && action.iframe.length > 0) {
      // Get the deepest iframe and show its frameId
      const deepest = action.iframe[action.iframe.length - 1];
      return deepest.frameId || deepest.selector || deepest.id || deepest.name || `iframe[${action.iframe.length - 1}]`;
    }
    
    return null;
  }
  
  function extractShadowInfo(action) {
    const result = { levels: 0, hosts: [] };
    if (!action.shadow || !Array.isArray(action.shadow) || action.shadow.length === 0) return result;
    result.levels = action.shadow.length;
    result.hosts = action.shadow.map(s => ({
      hostXPath: s.hostXPath || null,
      innerXPath: s.innerXPath || null,
      hostTag: s.hostTag || null,
      innerSelector: s.innerSelector || null
    }));
    return result;
  }
  
  function getActionVerb(actionType) {
    const verbs = {
      'click': 'Click',
      'input': 'Type',
      'keypress': 'Press',
      'select': 'Select',
      'change': 'Change',
      'focus': 'Focus',
      'blur': 'Blur',
      'submit': 'Submit'
    };
    return verbs[actionType] || 'Interact';
  }
  
  function getElementDescription(action) {
    // Try to get meaningful element description from the element object
    if (action.description) return action.description;
    
    const el = action.element;
    if (!el) return 'Element';
    
    if (el.ariaLabel) return el.ariaLabel;
    if (el.placeholder) return el.placeholder;
    if (el.text && el.text.length < 30) return el.text;
    if (el.id) return `#${el.id}`;
    if (el.name) return el.name;
    if (el.tag) return el.tag;
    
    return 'Element';
  }
  
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    });
  }
  
  function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // ==================== MESSAGE HANDLING ====================
  function handleBackgroundMessage(message, sender, sendResponse) {
    console.log('[SidePanel] Received message:', message.type);
    
    switch (message.type) {
      case 'NEW_ACTION':
        // Add action to list and re-render
        if (state.isRecording && message.action) {
          state.recordedActions.push(message.action);
          renderActions();
          console.log('[SidePanel] New action added, total:', state.recordedActions.length);
        }
        break;
        
      case 'ASSERTION_COMPLETE':
        // Hide assertion hint and deactivate buttons
        elements.assertionHint.style.display = 'none';
        elements.assertElementBtn.classList.remove('active');
        elements.assertTextBtn.classList.remove('active');
        console.log('[SidePanel] Assertion complete');
        break;
    }
    
    return true;
  }
  
  // ==================== DOWNLOAD ====================
  function downloadRecording() {
    console.log('[SidePanel] Download clicked, actions:', state.recordedActions.length);
    
    if (state.recordedActions.length === 0) {
      console.warn('[SidePanel] No actions to download');
      alert('No actions recorded to download.');
      return;
    }
    
    // Format the recording similar to the expected JSON structure
    const recording = {
      name: state.selectedTestCase?.name || 'Recording',
      testSuite: state.selectedSuite?.name || 'Unknown',
      url: '',
      recordedAt: new Date().toISOString(),
      totalActions: state.recordedActions.length,
      actions: state.recordedActions.map(action => {
        // Format action for export
        if (action.type === 'page-marker') {
          return {
            type: 'page-marker',
            pageName: action.pageName,
            description: `Page: ${action.pageName}`
          };
        }
        
        const formatted = {
          action: action.type,
          xpath: action.xpath,
          element: action.element?.tag || action.element,
          description: action.description
        };
        
        // Add optional fields
        if (action.value) formatted.value = action.value;
        if (action.key) formatted.key = action.key;
        if (action.iframe) formatted.iframe = action.iframe;
        if (action.shadow) formatted.shadow = action.shadow;
        if (action.type === 'assertion') {
          formatted.assertionType = action.assertionType;
          formatted.expectedValue = action.expectedValue;
          if (action.shadowInnerElement) {
            formatted.shadowInnerElement = action.shadowInnerElement;
          }
          if (action.shadowAssertionNote) {
            formatted.shadowAssertionNote = action.shadowAssertionNote;
          }
        }
        
        return formatted;
      })
    };
    
    const jsonStr = JSON.stringify(recording, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const testCaseName = state.selectedTestCase?.name || 'recording';
    const filename = `${testCaseName}_${Date.now()}.json`
      .replace(/[^a-z0-9_.-]/gi, '_');
    
    // Create and trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    console.log('[SidePanel] Downloaded recording:', filename);
  }
  
  // ==================== ADD NEW TAB ====================
  function setupAddNewTabListeners() {
    // Upload area
    elements.uploadArea.addEventListener('click', () => {
      elements.excelFileInput.click();
    });
    
    elements.uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.uploadArea.classList.add('drag-over');
    });
    
    elements.uploadArea.addEventListener('dragleave', () => {
      elements.uploadArea.classList.remove('drag-over');
    });
    
    elements.uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.uploadArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleExcelFile(file);
    });
    
    elements.excelFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleExcelFile(file);
    });
    
    // Upload actions
    elements.cancelUploadBtn.addEventListener('click', cancelUpload);
    elements.confirmUploadBtn.addEventListener('click', confirmUpload);
  }
  
  async function handleExcelFile(file) {
    console.log('[SidePanel] Processing Excel file:', file.name);
    
    try {
      const data = await readExcelFile(file);
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Extract test cases (worksheets starting with "TC")
      const testCases = workbook.SheetNames
        .filter(name => name.startsWith('TC'))
        .map(name => ({ name }));
      
      if (testCases.length === 0) {
        alert('No test cases found. Worksheets must start with "TC".');
        return;
      }
      
      // Store for later
      state.extractedTestCases = testCases;
      state.pendingUpload = {
        fileName: file.name,
        testCases
      };
      
      // Show extraction result
      elements.extractionResult.style.display = 'block';
      elements.extractedTestCaseCount.textContent = testCases.length;
      
      // Suggest suite name from filename
      const suggestedName = file.name.replace(/\.(xlsx?|xls)$/i, '').replace(/_/g, ' ');
      elements.suiteNameInput.value = suggestedName;
      
      // Render test cases list
      renderExtractedTestCases(testCases);
      
      console.log('[SidePanel] Extracted test cases:', testCases);
    } catch (error) {
      console.error('[SidePanel] Error processing Excel file:', error);
      alert('Error reading Excel file. Please try again.');
    }
  }
  
  function readExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  function renderExtractedTestCases(testCases) {
    elements.extractedCasesList.innerHTML = '';
    
    testCases.forEach(testCase => {
      const item = document.createElement('div');
      item.className = 'extracted-case-item';
      item.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        <span>${escapeHtml(testCase.name)}</span>
      `;
      elements.extractedCasesList.appendChild(item);
    });
  }
  
  function cancelUpload() {
    elements.extractionResult.style.display = 'none';
    elements.excelFileInput.value = '';
    elements.suiteNameInput.value = '';
    state.extractedTestCases = null;
    state.pendingUpload = null;
  }
  
  async function confirmUpload() {
    const suiteName = elements.suiteNameInput.value.trim();
    
    if (!suiteName) {
      alert('Please enter a name for the test suite.');
      return;
    }
    
    if (!state.extractedTestCases || state.extractedTestCases.length === 0) {
      alert('No test cases to save.');
      return;
    }
    
    // Create new test suite
    const newSuite = {
      name: suiteName,
      testCases: state.extractedTestCases,
      createdAt: new Date().toISOString()
    };
    
    state.testSuites.push(newSuite);
    await saveTestSuites();
    
    // Update UI
    renderTestSuiteDropdown();
    renderExistingSuites();
    renderHistoryTree();
    
    // Reset upload state
    cancelUpload();
    
    // Switch to record tab
    switchTab('record');
    
    console.log('[SidePanel] Test suite added:', suiteName);
  }
  
  function renderExistingSuites() {
    if (state.testSuites.length === 0) {
      elements.existingSuitesList.innerHTML = '<div class="empty-hint">No test suites added yet</div>';
      return;
    }
    
    elements.existingSuitesList.innerHTML = '';
    
    state.testSuites.forEach((suite, index) => {
      const item = document.createElement('div');
      item.className = 'suite-summary-item';
      item.innerHTML = `
        <div class="suite-summary-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="suite-summary-name">${escapeHtml(suite.name)}</span>
        </div>
        <span class="suite-summary-count">${suite.testCases.length} test case${suite.testCases.length !== 1 ? 's' : ''}</span>
      `;
      elements.existingSuitesList.appendChild(item);
    });
  }
  
  // ==================== HISTORY TAB ====================
  function setupHistoryTabListeners() {
    elements.goToUploadBtn?.addEventListener('click', () => switchTab('addnew'));
  }
  
  function renderHistoryTree() {
    if (state.testSuites.length === 0) {
      elements.testSuitesTree.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <p>No test suites yet</p>
          <span class="hint">Upload an Excel file to get started</span>
          <button class="btn btn-primary" id="goToUploadBtn2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Test Suite
          </button>
        </div>
      `;
      
      // Re-attach listener
      const btn = document.getElementById('goToUploadBtn2');
      btn?.addEventListener('click', () => switchTab('addnew'));
      return;
    }
    
    elements.testSuitesTree.innerHTML = '';
    
    state.testSuites.forEach((suite, suiteIndex) => {
      const suiteItem = document.createElement('div');
      suiteItem.className = 'suite-item';
      suiteItem.dataset.index = suiteIndex;
      
      suiteItem.innerHTML = `
        <div class="suite-header">
          <span class="expand-icon">▶</span>
          <svg class="suite-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="suite-name">${escapeHtml(suite.name)}</span>
          <span class="suite-count">${suite.testCases.length}</span>
        </div>
        <div class="suite-cases">
          ${suite.testCases.map((testCase, caseIndex) => {
            const status = getCaseStatus(testCase);
            const statusClass = status ? `case-status ${status}` : '';
            return `
            <div class="case-item" data-suite="${suiteIndex}" data-case="${caseIndex}">
              <svg class="case-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4"></path>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              <span class="case-name">${escapeHtml(testCase.name)}</span>
              ${status ? `<span class="${statusClass}">${status}</span>` : ''}
            </div>
          `;}).join('')}
        </div>
      `;
      
      // Add expand/collapse functionality
      const header = suiteItem.querySelector('.suite-header');
      header.addEventListener('click', () => {
        suiteItem.classList.toggle('expanded');
      });
      
      elements.testSuitesTree.appendChild(suiteItem);
    });
  }

  // Status helper for History tab
  function getCaseStatus(testCase) {
    // Explicit status on object wins
    if (testCase.status) return testCase.status;
    // Demo override: mark TCBO-02 as generated
    if (testCase.name === 'TCBO-02') return 'generated';
    // If recording exists or actions captured, show pending
    if (testCase.actions && testCase.actions.length > 0) return 'pending';
    // Default: no badge
    return '';
  }
  
  // ==================== START ====================
  init();
  
})();

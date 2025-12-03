// Background Service Worker - Manages recording state, saved recordings, and coordinates content scripts

// State
let isRecording = false;
let currentRecording = {
  name: '',
  actions: [],
  startTime: null,
  url: ''
};
let activeTabId = null;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Listen for messages from sidebar and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'START_RECORDING':
      await startRecording(message.tabId, message.name);
      sendResponse({ success: true });
      break;
      
    case 'STOP_RECORDING':
      const recording = await stopRecording();
      sendResponse({ success: true, recording });
      break;
      
    case 'GET_STATUS':
      sendResponse({ 
        isRecording, 
        currentRecording,
        activeTabId
      });
      break;
      
    case 'ACTION_RECORDED':
      if (isRecording) {
        const action = {
          ...message.action,
          timestamp: Date.now(),
          tabId: sender.tab?.id,
          frameId: sender.frameId,
          url: sender.tab?.url || sender.url
        };
        currentRecording.actions.push(action);
        // Notify sidebar of new action
        chrome.runtime.sendMessage({ 
          type: 'NEW_ACTION', 
          action,
          actionCount: currentRecording.actions.length 
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
      
    case 'GET_SAVED_RECORDINGS':
      const recordings = await getSavedRecordings();
      sendResponse({ recordings });
      break;
      
    case 'SAVE_RECORDING':
      await saveRecording(message.recording);
      sendResponse({ success: true });
      break;
      
    case 'DELETE_RECORDING':
      await deleteRecording(message.id);
      sendResponse({ success: true });
      break;
      
    case 'LOAD_RECORDING':
      const loaded = await loadRecording(message.id);
      sendResponse({ recording: loaded });
      break;
      
    case 'RENAME_RECORDING':
      await renameRecording(message.id, message.newName);
      sendResponse({ success: true });
      break;
      
    case 'ADD_PAGE_MARKER':
      if (isRecording) {
        const pageMarkerAction = {
          type: 'page-marker',
          pageName: message.pageName,
          timestamp: Date.now(),
          description: `Page: ${message.pageName}`
        };
        currentRecording.actions.push(pageMarkerAction);
        // Notify sidebar
        chrome.runtime.sendMessage({ 
          type: 'NEW_ACTION', 
          action: pageMarkerAction,
          actionCount: currentRecording.actions.length 
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
      
    case 'AUTO_PAGE_MARKER':
      // Auto-detected page change from content script
      if (isRecording && message.pageName) {
        const autoPageMarkerAction = {
          type: 'page-marker',
          pageName: message.pageName,
          timestamp: Date.now(),
          auto: true,
          description: `Page: ${message.pageName}`
        };
        currentRecording.actions.push(autoPageMarkerAction);
        // Notify sidebar
        chrome.runtime.sendMessage({ 
          type: 'NEW_ACTION', 
          action: autoPageMarkerAction,
          actionCount: currentRecording.actions.length,
          autoPageChange: true,
          pageName: message.pageName
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
      
    case 'ASSERTION_COMPLETE':
      // Notify sidebar that assertion mode should be turned off
      chrome.runtime.sendMessage({ type: 'ASSERTION_COMPLETE' }).catch(() => {});
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ error: 'Unknown message type' });
  }
}

async function startRecording(tabId, name) {
  isRecording = true;
  activeTabId = tabId;
  
  const tab = await chrome.tabs.get(tabId);
  
  // Generate timestamp-based name if not provided
  const timestamp = new Date().toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  });
  
  currentRecording = {
    id: `rec_${Date.now()}`,
    name: name || `Recording - ${timestamp}`,
    actions: [],
    startTime: Date.now(),
    url: tab.url
  };
  
  // Inject content script into all frames of the active tab
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['content.js']
    });
    
    // First, collect iframe info from the main frame and send to child frames
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_IFRAME_INFO' });
    } catch (e) {
      console.log('Could not collect iframe info:', e);
    }
    
    // Notify all content scripts to start recording
    await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
  } catch (error) {
    console.error('Failed to inject content script:', error);
  }
}

async function stopRecording() {
  isRecording = false;
  
  // Notify content scripts to stop recording
  if (activeTabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'STOP_RECORDING' });
    } catch (e) {}
  }
  
  const recording = { ...currentRecording, endTime: Date.now() };
  
  // Auto-save the recording with timestamp in name if generic
  if (recording.actions.length > 0) {
    // Ensure recording has a good name with timestamp
    if (!recording.name || recording.name.startsWith('Recording -')) {
      const timestamp = new Date().toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
      recording.name = `Recording - ${timestamp}`;
    }
    await saveRecording(recording);
    console.log('[Background] Auto-saved recording:', recording.name, 'with', recording.actions.length, 'actions');
  }
  
  activeTabId = null;
  return recording;
}

async function getSavedRecordings() {
  const result = await chrome.storage.local.get('recordings');
  return result.recordings || [];
}

async function saveRecording(recording) {
  const recordings = await getSavedRecordings();
  
  // Check if recording already exists (update) or is new
  const existingIndex = recordings.findIndex(r => r.id === recording.id);
  if (existingIndex >= 0) {
    recordings[existingIndex] = recording;
  } else {
    recordings.unshift(recording); // Add to beginning
  }
  
  await chrome.storage.local.set({ recordings });
}

async function deleteRecording(id) {
  const recordings = await getSavedRecordings();
  const filtered = recordings.filter(r => r.id !== id);
  await chrome.storage.local.set({ recordings: filtered });
}

async function loadRecording(id) {
  const recordings = await getSavedRecordings();
  return recordings.find(r => r.id === id);
}

async function renameRecording(id, newName) {
  const recordings = await getSavedRecordings();
  const recording = recordings.find(r => r.id === id);
  if (recording) {
    recording.name = newName;
    await chrome.storage.local.set({ recordings });
  }
}

// Handle new frames being loaded (for dynamically added iframes)
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (isRecording && details.tabId === activeTabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' }, { frameId: details.frameId });
    } catch (e) {}
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isRecording && tabId === activeTabId && changeInfo.status === 'complete') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    } catch (e) {}
  }
});

// Background Service Worker - Manages recording state and coordinates content scripts

// ==================== STATE ====================
let isRecording = false;
let currentRecording = {
  name: '',
  actions: [],
  startTime: null,
  url: ''
};
let activeTabId = null;

// ==================== SIDE PANEL SETUP ====================

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ==================== MESSAGE HANDLING ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async
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
        
        // Notify side panel
        chrome.runtime.sendMessage({
          type: 'NEW_ACTION',
          action,
          actionCount: currentRecording.actions.length
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
      
    case 'ADD_PAGE_MARKER':
      if (isRecording && message.pageName) {
        const pageMarkerAction = {
          type: 'page-marker',
          pageName: message.pageName,
          timestamp: Date.now(),
          description: message.pageName
        };
        currentRecording.actions.push(pageMarkerAction);
        
        // Notify side panel
        chrome.runtime.sendMessage({
          type: 'NEW_ACTION',
          action: pageMarkerAction,
          actionCount: currentRecording.actions.length
        }).catch(() => {});
      }
      sendResponse({ success: true });
      break;
      
    case 'ASSERTION_COMPLETE':
      chrome.runtime.sendMessage({ type: 'ASSERTION_COMPLETE' }).catch(() => {});
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ error: 'Unknown message type' });
  }
}

// ==================== RECORDING CONTROL ====================

async function startRecording(tabId, name) {
  isRecording = true;
  activeTabId = tabId;
  
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    console.error('[Background] Failed to get tab:', e);
    return;
  }
  
  const timestamp = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  currentRecording = {
    id: `rec_${Date.now()}`,
    name: name || `Recording - ${timestamp}`,
    actions: [],
    startTime: Date.now(),
    url: tab.url
  };
  
  // Inject content script into all frames
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['content.js']
    });
    
    // Start recording in all frames
    await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
  } catch (error) {
    console.error('[Background] Failed to inject content script:', error);
  }
  
  console.log('[Background] Recording started:', currentRecording.name);
}

async function stopRecording() {
  isRecording = false;
  
  // Stop recording in all frames
  if (activeTabId) {
    try {
      // Send stop via scripting API (more reliable for iframes)
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId, allFrames: true },
        func: () => {
          if (window.__actionRecorderInjected) {
            window.postMessage({ type: '__ACTION_RECORDER_STOP__' }, '*');
          }
        }
      });
      
      // Also send regular message
      await chrome.tabs.sendMessage(activeTabId, { type: 'STOP_RECORDING' });
    } catch (e) {
      console.log('[Background] Error stopping recording:', e);
    }
  }
  
  const recording = {
    ...currentRecording,
    endTime: Date.now()
  };
  
  console.log('[Background] Recording stopped with', recording.actions.length, 'actions');
  
  activeTabId = null;
  return recording;
}

// ==================== DYNAMIC FRAME HANDLING ====================

// Handle new frames being loaded during recording
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (isRecording && details.tabId === activeTabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' }, { frameId: details.frameId });
    } catch (e) {
      // Frame might not be accessible
    }
  }
});

// Handle tab navigation during recording
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (isRecording && tabId === activeTabId && changeInfo.status === 'complete') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    } catch (e) {
      // Tab might not be accessible
    }
  }
});

console.log('[Background] Service worker initialized');

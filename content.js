// Content Script - Captures user actions with improved XPath, iframe, and shadow DOM detection
// Injects into all frames including shadow DOM

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__actionRecorderInjected) return;
  window.__actionRecorderInjected = true;
  
  let isRecording = false;
  let isAssertionMode = false;
  let pendingInput = null;
  let shadowObservers = [];
  let pageMonitorInterval = null;
  let lastMonitoredPage = null;
  
  // Frame identification
  let frameIdentifier = null;
  const isMainFrame = (window === window.top);
  
  // Page monitor XPath (for M3 application)
  const PAGE_MONITOR_XPATH = '//*[@id="panel-header"]';
  
  console.log('[Action Recorder] Content script loaded:', window.location.href, isMainFrame ? '(MAIN)' : '(IFRAME)');
  
  // ============================================
  // XPATH GENERATION (IMPROVED)
  // ============================================
  
  /**
   * Generate the best XPath for an element
   */
  function generateXPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    
    // 1. Try ID first (most reliable)
    if (element.id && !element.id.match(/^(ember|react|ng-|:)/)) {
      const xpath = `//*[@id="${element.id}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 2. Try unique attributes commonly used in testing
    const testAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-test', 'data-automation-id'];
    for (const attr of testAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const xpath = `//*[@${attr}="${value}"]`;
        if (isUniqueXPath(xpath, element)) return xpath;
      }
    }
    
    // 3. Try name attribute for form elements
    if (element.name) {
      const xpath = `//${element.tagName.toLowerCase()}[@name="${element.name}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 4. Try aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      const xpath = `//*[@aria-label="${ariaLabel}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 5. Try text content for buttons/links
    if (['BUTTON', 'A'].includes(element.tagName)) {
      const text = element.textContent?.trim();
      if (text && text.length < 50) {
        const xpath = `//${element.tagName.toLowerCase()}[normalize-space()="${text}"]`;
        if (isUniqueXPath(xpath, element)) return xpath;
      }
    }
    
    // 6. Build relative XPath
    return buildRelativeXPath(element);
  }
  
  /**
   * Build relative XPath from element to nearest ancestor with ID
   */
  function buildRelativeXPath(element) {
    const parts = [];
    let current = element;
    
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      
      // If ancestor has ID, use it as anchor
      if (current.id && current !== element && !current.id.match(/^(ember|react|ng-|:)/)) {
        parts.unshift(`//*[@id="${current.id}"]`);
        return parts.join('/');
      }
      
      // Get position among same-tag siblings
      const parent = current.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `[${index}]`;
        }
      }
      
      parts.unshift(part);
      
      // Handle shadow DOM boundary - stop at shadow root
      if (current.parentNode instanceof ShadowRoot) {
        break;
      }
      
      current = current.parentNode;
    }
    
    return '//' + parts.join('/');
  }
  
  /**
   * Generate full absolute XPath (for fallback)
   */
  function generateFullXPath(element) {
    const parts = [];
    let current = element;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tagName = current.tagName.toLowerCase();
      const parent = current.parentNode;
      
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tagName}[${index}]`);
      } else {
        parts.unshift(tagName);
      }
      
      // Stop at shadow root boundary
      if (current.parentNode instanceof ShadowRoot) {
        break;
      }
      
      current = current.parentNode;
    }
    
    return '/' + parts.join('/');
  }
  
  /**
   * Check if XPath uniquely identifies the element
   */
  function isUniqueXPath(xpath, targetElement) {
    try {
      const doc = targetElement.ownerDocument || document;
      const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return result.snapshotLength === 1 && result.snapshotItem(0) === targetElement;
    } catch {
      return false;
    }
  }
  
  // ============================================
  // IFRAME DETECTION (IMPROVED)
  // ============================================
  
  /**
   * Get detailed iframe path - walks up the frame hierarchy
   */
  function getIframePath() {
    if (window === window.top) return null;
    
    const path = [];
    let currentWindow = window;
    let frameIndex = 0;
    
    while (currentWindow !== window.top) {
      try {
        const parentDoc = currentWindow.parent.document;
        const iframes = parentDoc.querySelectorAll('iframe, frame');
        let foundIframe = null;
        let iframeIdx = -1;
        
        for (let i = 0; i < iframes.length; i++) {
          try {
            if (iframes[i].contentWindow === currentWindow) {
              foundIframe = iframes[i];
              iframeIdx = i;
              break;
            }
          } catch (e) {
            // Cross-origin, skip
          }
        }
        
        if (foundIframe) {
          // Generate proper XPath for the iframe element
          const iframeXPath = generateXPath(foundIframe);
          
          // Get all available attributes
          const iframeId = foundIframe.id && foundIframe.id.trim() !== '' ? foundIframe.id : null;
          const iframeName = foundIframe.name && foundIframe.name.trim() !== '' ? foundIframe.name : null;
          const iframeSrc = foundIframe.src || null;
          const iframeTitle = foundIframe.title && foundIframe.title.trim() !== '' ? foundIframe.title : null;
          const iframeClass = foundIframe.className && foundIframe.className.trim() !== '' ? foundIframe.className : null;
          
          path.unshift({
            xpath: iframeXPath,
            fullXPath: generateFullXPath(foundIframe),
            id: iframeId,
            name: iframeName,
            src: iframeSrc,
            className: iframeClass,
            title: iframeTitle,
            index: iframeIdx,
            // Build a reliable selector for Selenium/Playwright
            selector: iframeName ? `iframe[name="${iframeName}"]` : 
                      iframeId ? `iframe[id="${iframeId}"]` : 
                      iframeXPath || `(//iframe)[${iframeIdx + 1}]`
          });
        } else {
          // Couldn't find iframe in parent - cross-origin or dynamic iframe
          // Use frameIdentifier if available, or try frameElement
          let detectedIndex = frameIndex;
          let iframeInfo = null;
          
          // First, try using the stored frame identifier (received from parent)
          if (frameIdentifier && frameIndex === 0) {
            console.log('[Action Recorder] Using stored frame identifier');
            path.unshift({
              xpath: frameIdentifier.xpath || null,
              fullXPath: frameIdentifier.fullXPath || null,
              id: frameIdentifier.id || null,
              name: frameIdentifier.name || null,
              src: frameIdentifier.src || null,
              title: frameIdentifier.title || null,
              className: frameIdentifier.className || null,
              index: frameIdentifier.index ?? detectedIndex,
              selector: frameIdentifier.selector || `(//iframe)[${detectedIndex + 1}]`,
              note: 'Detected via parent message'
            });
          } else {
            // Try frameElement as fallback
            try {
              const frameEl = currentWindow.frameElement;
              if (frameEl) {
                const iframeId = frameEl.id && frameEl.id.trim() !== '' ? frameEl.id : null;
                const iframeName = frameEl.name && frameEl.name.trim() !== '' ? frameEl.name : null;
                
                path.unshift({
                  xpath: null,
                  id: iframeId,
                  name: iframeName,
                  src: frameEl.src || null,
                  index: detectedIndex,
                  selector: iframeName ? `iframe[name="${iframeName}"]` : 
                            iframeId ? `iframe[id="${iframeId}"]` : 
                            `(//iframe)[${detectedIndex + 1}]`,
                  note: 'Detected via frameElement'
                });
              } else {
                path.unshift({
                  crossOrigin: true,
                  message: 'Cross-origin iframe - cannot access parent',
                  index: detectedIndex,
                  selector: `(//iframe)[${detectedIndex + 1}]`
                });
              }
            } catch (frameErr) {
              path.unshift({
                crossOrigin: true,
                message: 'Cross-origin iframe detected',
                index: detectedIndex,
                selector: `(//iframe)[${detectedIndex + 1}]`
              });
            }
          }
        }
        
        currentWindow = currentWindow.parent;
        frameIndex++;
      } catch (e) {
        // Cross-origin - we can't access parent at all
        path.unshift({
          crossOrigin: true,
          message: 'Cross-origin frame boundary',
          error: e.message,
          selector: `(//iframe)[${frameIndex + 1}]`
        });
        break;
      }
    }
    
    return path.length > 0 ? path : null;
  }
  
  /**
   * Get the frame index for Selenium's switchTo().frame(index)
   */
  function getFrameIndex() {
    if (window === window.top) return null;
    
    try {
      const parentDoc = window.parent.document;
      const frames = parentDoc.querySelectorAll('iframe, frame');
      
      for (let i = 0; i < frames.length; i++) {
        try {
          if (frames[i].contentWindow === window) {
            return i;
          }
        } catch (e) {
          // Cross-origin
        }
      }
    } catch (e) {
      // Cross-origin parent
    }
    
    return null;
  }
  
  // ============================================
  // SHADOW DOM DETECTION (IMPROVED)
  // ============================================
  
  /**
   * Get shadow DOM path if element is inside shadow DOM
   * Only returns path if element is TRULY inside a shadow root
   */
  function getShadowPath(element) {
    if (!element) return null;
    
    // Quick check: if the direct root is the document, it's not in shadow DOM
    const directRoot = element.getRootNode();
    if (directRoot === document || directRoot === element.ownerDocument) {
      return null;
    }
    
    // Only proceed if we're actually inside a ShadowRoot
    if (!(directRoot instanceof ShadowRoot)) {
      return null;
    }
    
    const path = [];
    let current = element;
    
    while (current) {
      const root = current.getRootNode();
      
      if (root instanceof ShadowRoot) {
        const host = root.host;
        if (!host) break; // Safety check
        
        // Get XPath for the shadow host
        const hostXPath = generateXPath(host);
        
        // Get selector path within the shadow root
        const innerSelector = generateInnerSelector(current, root);
        const innerXPath = generateInnerXPath(current, root);
        
        path.unshift({
          hostXPath: hostXPath,
          hostTag: host.tagName.toLowerCase(),
          hostId: host.id || null,
          hostClass: host.className || null,
          innerSelector: innerSelector,
          innerXPath: innerXPath,
          shadowMode: root.mode // 'open' or 'closed'
        });
        
        current = host;
      } else {
        // Reached the light DOM
        break;
      }
    }
    
    return path.length > 0 ? path : null;
  }
  
  /**
   * Generate CSS selector for element within shadow root
   */
  function generateInnerSelector(element, shadowRoot) {
    const parts = [];
    let current = element;
    
    while (current && current !== shadowRoot && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .filter(c => c && !c.match(/^(ng-|v-|_|jsx-|css-|sc-)/))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += classes.map(c => `.${CSS.escape(c)}`).join('');
        }
      }
      
      // Add index if needed
      const parent = current.parentNode;
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      
      parts.unshift(selector);
      current = current.parentNode;
    }
    
    return parts.join(' > ');
  }
  
  /**
   * Generate XPath-like path for element within shadow root
   */
  function generateInnerXPath(element, shadowRoot) {
    const parts = [];
    let current = element;
    
    while (current && current !== shadowRoot && current.nodeType === Node.ELEMENT_NODE) {
      let part = current.tagName.toLowerCase();
      
      if (current.id) {
        parts.unshift(`*[@id="${current.id}"]`);
        break;
      }
      
      const parent = current.parentNode;
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `[${index}]`;
        }
      }
      
      parts.unshift(part);
      current = current.parentNode;
    }
    
    return parts.join('/');
  }
  
  // ============================================
  // ELEMENT INFO
  // ============================================
  
  /**
   * Get value from an element, handling shadow DOM cases
   */
  function getElementValue(element) {
    if (!element) return null;
    
    // Direct value access
    if (element.value !== undefined && element.value !== '') {
      return element.value;
    }
    
    // For shadow host elements, try to find the actual input inside
    if (element.shadowRoot) {
      // Try common patterns for shadow DOM input elements
      const selectors = [
        'input',
        'textarea',
        'input[type="text"]',
        'input[type="search"]',
        'input[type="password"]',
        'input[type="email"]',
        '[contenteditable="true"]',
        '.input',
        '#input'
      ];
      
      for (const selector of selectors) {
        try {
          const innerInput = element.shadowRoot.querySelector(selector);
          if (innerInput && innerInput.value !== undefined && innerInput.value !== '') {
            console.log('[Action Recorder] Found inner input value in shadow DOM:', innerInput.value);
            return innerInput.value;
          }
        } catch (e) {}
      }
    }
    
    // For elements inside shadow DOM, the value should be directly accessible
    // Check if we're looking at a custom element that wraps an input
    const tagName = element.tagName.toLowerCase();
    if (tagName.includes('-')) {
      // Custom element - try to find nested input
      const innerInput = element.querySelector?.('input, textarea');
      if (innerInput && innerInput.value !== undefined && innerInput.value !== '') {
        return innerInput.value;
      }
    }
    
    // Check for contenteditable
    if (element.contentEditable === 'true' || element.isContentEditable) {
      return element.textContent || element.innerText || '';
    }
    
    return element.value || null;
  }
  
  function getElementInfo(element) {
    const rect = element.getBoundingClientRect();
    const extractedValue = getElementValue(element);
    
    return {
      tag: element.tagName.toLowerCase(),
      type: element.type || null,
      id: element.id || null,
      name: element.name || null,
      className: typeof element.className === 'string' ? element.className : null,
      text: (element.textContent || '').trim().slice(0, 100) || null,
      placeholder: element.placeholder || null,
      value: extractedValue,
      href: element.href || null,
      role: element.getAttribute('role') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      visible: rect.width > 0 && rect.height > 0,
      inShadowDOM: element.getRootNode() instanceof ShadowRoot,
      inIframe: window !== window.top
    };
  }
  
  // ============================================
  // HUMAN READABLE DESCRIPTION GENERATOR
  // ============================================
  
  function generateDescription(type, element, data = {}) {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || '').trim().slice(0, 30);
    const placeholder = element.placeholder || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const title = element.title || '';
    const name = element.name || '';
    const id = element.id || '';
    const value = data.value || element.value || '';
    
    // Get a friendly name for the element
    let elementName = '';
    if (text && text.length > 0 && text.length < 30) {
      elementName = `"${text}"`;
    } else if (ariaLabel) {
      elementName = `"${ariaLabel}"`;
    } else if (placeholder) {
      elementName = `"${placeholder}" field`;
    } else if (title) {
      elementName = `"${title}"`;
    } else if (name) {
      elementName = `"${name}" field`;
    } else if (id) {
      elementName = `#${id}`;
    } else {
      elementName = tag;
    }
    
    // Generate description based on action type
    switch (type) {
      case 'click':
        if (tag === 'button' || element.getAttribute('role') === 'button') {
          return `Clicked the ${elementName} button`;
        } else if (tag === 'a') {
          return `Clicked the ${elementName} link`;
        } else if (tag === 'input' && (element.type === 'checkbox' || element.type === 'radio')) {
          return `Clicked the ${elementName} ${element.type}`;
        } else if (tag === 'input' || tag === 'textarea') {
          return `Clicked on ${elementName} input`;
        } else {
          return `Clicked on ${elementName}`;
        }
      
      case 'input':
        const maskedValue = element.type === 'password' ? '****' : value;
        return `Typed "${maskedValue}" in ${elementName}`;
      
      case 'select':
        return `Selected "${value}" from ${elementName} dropdown`;
      
      case 'check':
        return data.checked ? `Checked ${elementName}` : `Unchecked ${elementName}`;
      
      case 'keypress':
        return `Pressed ${data.key} key on ${elementName}`;
      
      case 'assertion':
        return `Asserted ${elementName} ${data.assertionType || 'exists'}` + 
               (data.expectedValue ? ` with value "${data.expectedValue}"` : '');
      
      default:
        return `${type} on ${elementName}`;
    }
  }
  
  // ============================================
  // PAGE MONITOR
  // ============================================
  
  function startPageMonitor() {
    if (pageMonitorInterval) return;
    
    console.log('[Action Recorder] Starting page monitor in frame:', isMainFrame ? 'MAIN' : 'IFRAME');
    
    pageMonitorInterval = setInterval(() => {
      if (!isRecording) return;
      
      try {
        // Try to find the page header element in current document
        const result = document.evaluate(
          PAGE_MONITOR_XPATH, 
          document, 
          null, 
          XPathResult.FIRST_ORDERED_NODE_TYPE, 
          null
        );
        
        const element = result.singleNodeValue;
        if (element) {
          const currentPage = (element.textContent || '').trim();
          
          if (currentPage && currentPage !== lastMonitoredPage) {
            console.log('[Action Recorder] Page changed:', lastMonitoredPage, '->', currentPage, 'in frame:', isMainFrame ? 'MAIN' : 'IFRAME');
            lastMonitoredPage = currentPage;
            
            // Send page marker to background
            chrome.runtime.sendMessage({
              type: 'AUTO_PAGE_MARKER',
              pageName: currentPage,
              fromIframe: !isMainFrame
            }).catch(() => {});
          }
        }
      } catch (e) {
        // Element not found or error - that's ok, the element might not exist yet
        console.log('[Action Recorder] Page monitor check - element not found');
      }
    }, 500); // Check every 500ms
  }
  
  function stopPageMonitor() {
    if (pageMonitorInterval) {
      clearInterval(pageMonitorInterval);
      pageMonitorInterval = null;
      lastMonitoredPage = null;
      console.log('[Action Recorder] Stopped page monitor');
    }
  }
  
  // ============================================
  // ASSERTION MODE
  // ============================================
  
  function enterAssertionMode() {
    isAssertionMode = true;
    document.body.style.cursor = 'crosshair';
    console.log('[Action Recorder] Assertion mode enabled');
  }
  
  function exitAssertionMode() {
    isAssertionMode = false;
    document.body.style.cursor = '';
    console.log('[Action Recorder] Assertion mode disabled');
  }
  
  function recordAssertion(element) {
    if (!isRecording || !element) return;
    
    const text = (element.textContent || '').trim();
    const value = element.value || '';
    
    const action = {
      type: 'assertion',
      xpath: generateXPath(element),
      fullXPath: generateFullXPath(element),
      element: getElementInfo(element),
      iframe: getIframePath(),
      shadow: getShadowPath(element),
      assertionType: 'exists',
      textContent: value || text.slice(0, 100) || null,
      expectedValue: value || text.slice(0, 100) || null,
      description: generateDescription('assertion', element, { 
        assertionType: 'exists',
        expectedValue: value || text.slice(0, 50)
      })
    };
    
    console.log('[Action Recorder] Assertion:', action);
    
    chrome.runtime.sendMessage({
      type: 'ACTION_RECORDED',
      action: action
    }).catch(err => console.error('[Action Recorder] Assertion error:', err));
    
    // Exit assertion mode after recording
    exitAssertionMode();
    chrome.runtime.sendMessage({ type: 'ASSERTION_COMPLETE' }).catch(() => {});
  }
  
  // ============================================
  // ACTION RECORDING
  // ============================================
  
  let lastRecordedAction = null;
  let lastRecordedTime = 0;
  
  function recordAction(type, element, data = {}) {
    if (!isRecording || !element) return;
    
    // If in assertion mode, record assertion instead
    if (isAssertionMode && type === 'click') {
      recordAssertion(element);
      return;
    }
    
    try {
      if (element.id === '__action-recorder-indicator') return;
      if (element.closest?.('#__action-recorder-indicator')) return;
    } catch (e) {
      // Element might be in a different context
    }
    
    try {
      const xpath = generateXPath(element);
      const now = Date.now();
      
      // Deduplicate: Skip if same action on same element within 300ms
      if (lastRecordedAction && 
          lastRecordedAction.type === type && 
          lastRecordedAction.xpath === xpath &&
          (now - lastRecordedTime) < 300) {
        console.log('[Action Recorder] Skipping duplicate:', type, xpath);
        return;
      }
      
      const action = {
        type: type,
        xpath: xpath,
        fullXPath: generateFullXPath(element),
        element: getElementInfo(element),
        iframe: getIframePath(),
        frameIndex: getFrameIndex(),
        shadow: getShadowPath(element),
        description: generateDescription(type, element, data),
        ...data
      };
      
      // Update last recorded action for deduplication
      lastRecordedAction = { type, xpath };
      lastRecordedTime = now;
      
      console.log('[Action Recorder] Action:', type, action.xpath);
      console.log('[Action Recorder] Description:', action.description);
      if (action.iframe) console.log('[Action Recorder] Iframe:', action.iframe);
      if (action.shadow) console.log('[Action Recorder] Shadow:', action.shadow);
      
      chrome.runtime.sendMessage({
        type: 'ACTION_RECORDED',
        action: action
      }).catch(err => {
        console.error('[Action Recorder] Send error:', err);
        // Try to reconnect - the service worker may have gone to sleep
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(response => {
          if (response?.isRecording) {
            // Retry sending the action
            chrome.runtime.sendMessage({
              type: 'ACTION_RECORDED',
              action: action
            }).catch(() => {});
          }
        }).catch(() => {});
      });
    } catch (err) {
      console.error('[Action Recorder] Error recording action:', err);
    }
  }
  
  function flushPendingInput() {
    if (pendingInput) {
      const element = pendingInput.element;
      let value = getElementValue(element);
      
      // Mask password values
      if (element.type === 'password') {
        value = '****';
      }
      
      recordAction('input', element, { value: value || '' });
      pendingInput = null;
    }
  }
  
  // ============================================
  // EVENT HANDLERS
  // ============================================
  
  function handleClick(event) {
    if (!isRecording) return;
    
    try {
      flushPendingInput();
      
      const element = event.target;
      if (!element) return;
      if (element.id === '__action-recorder-indicator') return;
      
      recordAction('click', element);
    } catch (err) {
      console.error('[Action Recorder] Click handler error:', err);
    }
  }
  
  function handleInput(event) {
    if (!isRecording) return;
    
    try {
      const element = event.target;
      if (!element || !element.tagName) return;
      if (!['INPUT', 'TEXTAREA'].includes(element.tagName)) return;
      
      pendingInput = {
        element: element,
        startTime: Date.now()
      };
    } catch (err) {
      console.error('[Action Recorder] Input handler error:', err);
    }
  }
  
  function handleChange(event) {
    if (!isRecording) return;
    
    try {
      const element = event.target;
      if (!element || !element.tagName) return;
      
      if (element.tagName === 'SELECT') {
        flushPendingInput();
        recordAction('select', element, {
          value: element.value,
          text: element.options?.[element.selectedIndex]?.text || ''
        });
      } else if (element.type === 'checkbox' || element.type === 'radio') {
        flushPendingInput();
        recordAction('check', element, {
          checked: element.checked
        });
      }
    } catch (err) {
      console.error('[Action Recorder] Change handler error:', err);
    }
  }
  
  function handleKeydown(event) {
    if (!isRecording) return;
    
    try {
      if (event.key === 'Enter') {
        flushPendingInput();
        if (event.target) {
          recordAction('keypress', event.target, { key: 'Enter' });
        }
      } else if (event.key === 'Tab') {
        flushPendingInput();
      }
    } catch (err) {
      console.error('[Action Recorder] Keydown handler error:', err);
    }
  }
  
  function handleFocusOut(event) {
    if (!isRecording) return;
    
    try {
      const element = event.target;
      if (pendingInput && pendingInput.element === element) {
        flushPendingInput();
      }
    } catch (err) {
      console.error('[Action Recorder] Focusout handler error:', err);
    }
  }
  
  // ============================================
  // SHADOW DOM OBSERVATION & INJECTION
  // ============================================
  
  /**
   * Attach event listeners to a root (document or shadow root)
   */
  function attachListeners(root) {
    root.addEventListener('click', handleClick, true);
    root.addEventListener('input', handleInput, true);
    root.addEventListener('change', handleChange, true);
    root.addEventListener('keydown', handleKeydown, true);
    root.addEventListener('focusout', handleFocusOut, true);
  }
  
  function detachListeners(root) {
    root.removeEventListener('click', handleClick, true);
    root.removeEventListener('input', handleInput, true);
    root.removeEventListener('change', handleChange, true);
    root.removeEventListener('keydown', handleKeydown, true);
    root.removeEventListener('focusout', handleFocusOut, true);
  }
  
  /**
   * Find and attach listeners to all shadow roots
   */
  function findAndAttachToShadowRoots(root = document) {
    const processElement = (element) => {
      // Check for open shadow root
      if (element.shadowRoot) {
        console.log('[Action Recorder] Found shadow root on:', element.tagName, element.id || element.className);
        attachListeners(element.shadowRoot);
        
        // Recursively find shadow roots within this shadow root
        findAndAttachToShadowRoots(element.shadowRoot);
        
        // Observe this shadow root for new elements
        observeShadowRoot(element.shadowRoot);
      }
    };
    
    // Process all elements
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      processElement(node);
    }
  }
  
  /**
   * Observe shadow root for dynamically added elements with shadow roots
   */
  function observeShadowRoot(shadowRoot) {
    const observer = new MutationObserver((mutations) => {
      if (!isRecording) return;
      
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.shadowRoot) {
              attachListeners(node.shadowRoot);
              findAndAttachToShadowRoots(node.shadowRoot);
              observeShadowRoot(node.shadowRoot);
            }
            
            // Check descendants
            const descendants = node.querySelectorAll?.('*') || [];
            descendants.forEach(desc => {
              if (desc.shadowRoot) {
                attachListeners(desc.shadowRoot);
                findAndAttachToShadowRoots(desc.shadowRoot);
                observeShadowRoot(desc.shadowRoot);
              }
            });
          }
        }
      }
    });
    
    observer.observe(shadowRoot, { childList: true, subtree: true });
    shadowObservers.push(observer);
  }
  
  /**
   * Override attachShadow to intercept shadow root creation
   */
  function interceptShadowRoots() {
    const originalAttachShadow = Element.prototype.attachShadow;
    
    Element.prototype.attachShadow = function(options) {
      const shadowRoot = originalAttachShadow.call(this, options);
      
      if (isRecording) {
        console.log('[Action Recorder] Intercepted new shadow root on:', this.tagName);
        // Delay to allow content to be added
        setTimeout(() => {
          attachListeners(shadowRoot);
          findAndAttachToShadowRoots(shadowRoot);
          observeShadowRoot(shadowRoot);
        }, 100);
      }
      
      return shadowRoot;
    };
  }
  
  // ============================================
  // RECORDING CONTROL
  // ============================================
  
  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    pendingInput = null;
    
    // Attach to main document
    attachListeners(document);
    
    // Find and attach to all existing shadow roots
    findAndAttachToShadowRoots(document);
    
    // Observe document for new elements
    const mainObserver = new MutationObserver((mutations) => {
      if (!isRecording) return;
      
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.shadowRoot) {
              attachListeners(node.shadowRoot);
              findAndAttachToShadowRoots(node.shadowRoot);
              observeShadowRoot(node.shadowRoot);
            }
            
            const descendants = node.querySelectorAll?.('*') || [];
            descendants.forEach(desc => {
              if (desc.shadowRoot) {
                attachListeners(desc.shadowRoot);
                findAndAttachToShadowRoots(desc.shadowRoot);
                observeShadowRoot(desc.shadowRoot);
              }
            });
          }
        }
      }
    });
    
    mainObserver.observe(document.body, { childList: true, subtree: true });
    shadowObservers.push(mainObserver);
    
    addIndicator();
    console.log('[Action Recorder] Recording started');
  }
  
  function stopRecording() {
    if (!isRecording) return;
    
    flushPendingInput();
    isRecording = false;
    
    // Detach from main document
    detachListeners(document);
    
    // Disconnect all observers
    shadowObservers.forEach(obs => obs.disconnect());
    shadowObservers = [];
    
    removeIndicator();
    console.log('[Action Recorder] Recording stopped');
  }
  
  // ============================================
  // VISUAL INDICATOR
  // ============================================
  
  let indicator = null;
  
  function addIndicator() {
    if (window !== window.top) return;
    if (indicator) return;
    
    indicator = document.createElement('div');
    indicator.id = '__action-recorder-indicator';
    indicator.innerHTML = '<span class="dot"></span> Recording';
    
    const style = document.createElement('style');
    style.id = '__action-recorder-style';
    style.textContent = `
      #__action-recorder-indicator {
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #1a1a2e;
        color: #fff;
        padding: 8px 16px;
        border-radius: 20px;
        font: 13px system-ui, sans-serif;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border: 1px solid #f44;
        pointer-events: none;
      }
      #__action-recorder-indicator .dot {
        width: 8px;
        height: 8px;
        background: #f44;
        border-radius: 50%;
        animation: arPulse 1s infinite;
      }
      #__action-recorder-indicator.assertion-mode {
        border-color: #10b981;
        background: #064e3b;
      }
      #__action-recorder-indicator.assertion-mode .dot {
        background: #10b981;
      }
      @keyframes arPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(indicator);
  }
  
  function updateIndicatorMode(assertionMode) {
    if (indicator) {
      if (assertionMode) {
        indicator.classList.add('assertion-mode');
        indicator.innerHTML = '<span class="dot"></span> Click element to assert...';
      } else {
        indicator.classList.remove('assertion-mode');
        indicator.innerHTML = '<span class="dot"></span> Recording';
      }
    }
  }
  
  function removeIndicator() {
    if (indicator) {
      indicator.remove();
      indicator = null;
    }
    const style = document.getElementById('__action-recorder-style');
    if (style) style.remove();
  }
  
  // ============================================
  // MESSAGE HANDLING
  // ============================================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Action Recorder] Message:', message.type, isMainFrame ? '(MAIN)' : '(IFRAME)');
    
    if (message.type === 'START_RECORDING') {
      startRecording();
      sendResponse({ success: true });
    } else if (message.type === 'STOP_RECORDING') {
      stopRecording();
      stopPageMonitor();
      sendResponse({ success: true });
    } else if (message.type === 'GET_STATUS') {
      sendResponse({ isRecording, isAssertionMode });
    } else if (message.type === 'ENTER_ASSERTION_MODE') {
      enterAssertionMode();
      updateIndicatorMode(true);
      sendResponse({ success: true });
    } else if (message.type === 'EXIT_ASSERTION_MODE') {
      exitAssertionMode();
      updateIndicatorMode(false);
      sendResponse({ success: true });
    } else if (message.type === 'START_PAGE_MONITOR') {
      startPageMonitor();
      sendResponse({ success: true });
    } else if (message.type === 'STOP_PAGE_MONITOR') {
      stopPageMonitor();
      sendResponse({ success: true });
    } else if (message.type === 'GET_CURRENT_PAGE') {
      // Return the current page name from monitor element
      try {
        const result = document.evaluate(
          PAGE_MONITOR_XPATH, 
          document, 
          null, 
          XPathResult.FIRST_ORDERED_NODE_TYPE, 
          null
        );
        const element = result.singleNodeValue;
        sendResponse({ pageName: element ? (element.textContent || '').trim() : null });
      } catch (e) {
        sendResponse({ pageName: null });
      }
    } else if (message.type === 'COLLECT_IFRAME_INFO') {
      // Only main frame should collect and send iframe info
      if (isMainFrame) {
        collectAndSendIframeInfo();
      }
      sendResponse({ success: true });
    } else if (message.type === 'SET_FRAME_IDENTIFIER') {
      // Child frame receives its identifier from parent
      frameIdentifier = message.iframeInfo;
      console.log('[Action Recorder] Received frame identifier:', frameIdentifier);
      sendResponse({ success: true });
    }
    
    return true;
  });
  
  /**
   * Collect iframe information from main frame and send to each iframe
   */
  function collectAndSendIframeInfo() {
    if (!isMainFrame) return;
    
    console.log('[Action Recorder] Collecting iframe info from main frame');
    
    const iframes = document.querySelectorAll('iframe, frame');
    console.log('[Action Recorder] Found', iframes.length, 'iframes');
    
    iframes.forEach((iframe, index) => {
      try {
        const iframeInfo = {
          xpath: generateXPath(iframe),
          fullXPath: generateFullXPath(iframe),
          id: iframe.id && iframe.id.trim() !== '' ? iframe.id : null,
          name: iframe.name && iframe.name.trim() !== '' ? iframe.name : null,
          src: iframe.src || null,
          title: iframe.title && iframe.title.trim() !== '' ? iframe.title : null,
          className: iframe.className && iframe.className.trim() !== '' ? iframe.className : null,
          index: index
        };
        
        // Build selector
        iframeInfo.selector = iframeInfo.name ? `iframe[name="${iframeInfo.name}"]` :
                              iframeInfo.id ? `iframe[id="${iframeInfo.id}"]` :
                              iframeInfo.xpath || `(//iframe)[${index + 1}]`;
        
        console.log('[Action Recorder] Iframe', index, ':', iframeInfo);
        
        // Try to send to the iframe's content script
        try {
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              type: '__ACTION_RECORDER_FRAME_ID__',
              iframeInfo: iframeInfo
            }, '*');
          }
        } catch (e) {
          console.log('[Action Recorder] Could not post to iframe', index, ':', e.message);
        }
      } catch (e) {
        console.log('[Action Recorder] Error processing iframe', index, ':', e);
      }
    });
  }
  
  // Listen for frame identifier from parent
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === '__ACTION_RECORDER_FRAME_ID__') {
      frameIdentifier = event.data.iframeInfo;
      console.log('[Action Recorder] Received frame identifier via postMessage:', frameIdentifier);
    }
  });
  
  // Intercept shadow root creation
  interceptShadowRoots();
  
  // Check if we should already be recording
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(response => {
    if (response?.isRecording) {
      startRecording();
    }
  }).catch(() => {});
  
})();

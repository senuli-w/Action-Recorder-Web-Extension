// Content Script - Captures user actions with iframe and shadow DOM support
// Designed for complex web applications with nested iframes and shadow elements

(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__actionRecorderInjected) return;
  window.__actionRecorderInjected = true;
  
  // ==================== STATE ====================
  let isRecording = false;
  let isAssertionMode = false;
  let assertionType = 'element';
  let pendingInput = null;
  let shadowObservers = [];
  let frameIdentifier = null;
  
  const isMainFrame = (window === window.top);
  
  console.log('[Recorder] Content script loaded:', isMainFrame ? 'MAIN' : 'IFRAME', window.location.href.substring(0, 50));
  
  // ==================== XPATH GENERATION ====================
  
  /**
   * Generate the best XPath for an element
   * Prioritizes: ID > test attributes > name > aria-label > text > relative path
   */
  function generateXPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    
    const tag = element.tagName.toLowerCase();
    
    // 1. ID (if stable - not framework-generated)
    if (element.id && !element.id.match(/^(ember|react|ng-|:|[0-9])/)) {
      const xpath = `//${tag}[@id="${element.id}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 2. Test attributes
    const testAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-test', 'data-automation-id', 'data-e2e'];
    for (const attr of testAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const xpath = `//${tag}[@${attr}="${value}"]`;
        if (isUniqueXPath(xpath, element)) return xpath;
      }
    }
    
    // 3. Name attribute
    if (element.name) {
      const xpath = `//${tag}[@name="${element.name}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 4. Aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.length < 50) {
      const xpath = `//${tag}[@aria-label="${escapeXPathString(ariaLabel)}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 5. Text content for buttons/links
    if (['BUTTON', 'A'].includes(element.tagName)) {
      const text = (element.textContent || '').trim();
      if (text && text.length < 40 && !text.includes('\n')) {
        const xpath = `//${tag}[normalize-space()="${escapeXPathString(text)}"]`;
        if (isUniqueXPath(xpath, element)) return xpath;
      }
    }
    
    // 6. Placeholder for inputs
    if (element.placeholder) {
      const xpath = `//${tag}[@placeholder="${escapeXPathString(element.placeholder)}"]`;
      if (isUniqueXPath(xpath, element)) return xpath;
    }
    
    // 7. Build relative XPath from nearest identifiable ancestor
    return buildRelativeXPath(element);
  }
  
  /**
   * Build XPath relative to nearest ancestor with ID
   */
  function buildRelativeXPath(element) {
    const parts = [];
    let current = element;
    
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      let part = tag;
      
      // If ancestor has ID, use as anchor
      if (current.id && current !== element && !current.id.match(/^(ember|react|ng-|:|[0-9])/)) {
        parts.unshift(`//${tag}[@id="${current.id}"]`);
        return parts.join('/');
      }
      
      // Get position among same-tag siblings
      const parent = current.parentNode;
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `[${index}]`;
        }
      }
      
      parts.unshift(part);
      
      // Stop at shadow root boundary
      if (current.parentNode instanceof ShadowRoot) {
        break;
      }
      
      current = current.parentNode;
    }
    
    return '//' + parts.join('/');
  }
  
  /**
   * Generate full absolute XPath (fallback)
   */
  function generateFullXPath(element) {
    const parts = [];
    let current = element;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentNode;
      
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}[${index}]`);
      } else {
        parts.unshift(tag);
      }
      
      if (current.parentNode instanceof ShadowRoot) break;
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
  
  function escapeXPathString(str) {
    if (!str.includes("'")) return str;
    if (!str.includes('"')) return str;
    return str.replace(/'/g, "\\'");
  }
  
  // ==================== IFRAME DETECTION ====================

  /**
   * Lightweight frame element info (name/id/src) using window.frameElement.
   * Works even when parent is cross-origin in most browsers.
   */
  function getFrameElementInfo() {
    try {
      const el = window.frameElement;
      if (!el) return null;
      return {
        name: el.name || null,
        id: el.id || null,
        src: el.src || null
      };
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Generate a unique identifier for an iframe
   * Similar to how Playwright extracts frame identifiers
   */
  function generateFrameId(iframe) {
    // Try to get a stable identifier
    if (iframe.name) return iframe.name;
    if (iframe.id) return iframe.id;
    
    // Generate from src URL
    if (iframe.src) {
      try {
        const url = new URL(iframe.src);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
          return pathParts[pathParts.length - 1].replace(/\.[^.]+$/, '');
        }
      } catch (e) {}
    }
    
    // Generate a fingerprint from iframe attributes
    const attributes = [];
    if (iframe.className) attributes.push(iframe.className);
    if (iframe.title) attributes.push(iframe.title);
    
    // Get position-based identifier as last resort
    const parent = iframe.parentElement;
    if (parent) {
      const iframes = parent.querySelectorAll('iframe');
      const index = Array.from(iframes).indexOf(iframe);
      attributes.push(`frame-${index}`);
    }
    
    return attributes.join('-') || 'frame';
  }
  
  /**
   * Get iframe path from current window to top
   */
  function getIframePath() {
    if (window === window.top) return null;
    
    const path = [];
    let currentWindow = window;
    let level = 0;
    
    while (currentWindow !== window.top && level < 10) {
      try {
        // Best-effort frame element info from inside the frame
        let frameMeta = null;
        try {
          const frameEl = currentWindow.frameElement;
          if (frameEl) {
            frameMeta = {
              name: frameEl.name || null,
              id: frameEl.id || null,
              src: frameEl.src || null,
            };
          }
        } catch (e) {}

        const parentDoc = currentWindow.parent.document;
        const iframes = parentDoc.querySelectorAll('iframe, frame');
        let found = null;
        let foundIndex = -1;
        
        for (let i = 0; i < iframes.length; i++) {
          try {
            if (iframes[i].contentWindow === currentWindow) {
              found = iframes[i];
              foundIndex = i;
              break;
            }
          } catch (e) { /* cross-origin */ }
        }
        
        if (found) {
          const iframeXPath = generateXPath(found);
          const id = found.id || null;
          const name = found.name || null;
          const src = found.src || null;
          const frameId = generateFrameId(found);

          const effectiveName = name || frameMeta?.name || null;
          const effectiveId = id || frameMeta?.id || null;
          const effectiveSrc = src || frameMeta?.src || null;
          
          // Build selector for automation (Playwright-style)
          let selector = iframeXPath;
          let playwrightSelector = null;
          
          if (effectiveName) {
            selector = `iframe[name="${effectiveName}"]`;
            playwrightSelector = `frame[name="${effectiveName}"]`;
          } else if (effectiveId) {
            selector = `iframe[id="${effectiveId}"]`;
            playwrightSelector = `frame[id="${effectiveId}"]`;
          } else if (effectiveSrc) {
            // Use src pattern for Playwright
            try {
              const url = new URL(effectiveSrc);
              playwrightSelector = `frame[url*="${url.pathname}"]`;
            } catch (e) {
              playwrightSelector = `frame >> nth=${foundIndex}`;
            }
          } else {
            selector = `(//iframe)[${foundIndex + 1}]`;
            playwrightSelector = `frame >> nth=${foundIndex}`;
          }
          
          path.unshift({
            xpath: iframeXPath,
            fullXPath: generateFullXPath(found),
            id: effectiveId,
            name: effectiveName,
            src: effectiveSrc,
            index: foundIndex,
            selector: selector,
            playwrightSelector: playwrightSelector,
            frameId: frameId ? `iframe[${frameId}]` : `iframe[${foundIndex}]`
          });
        } else {
          // Cross-origin or dynamic iframe
          path.unshift({
            crossOrigin: true,
            index: level,
            selector: `(//iframe)[${level + 1}]`,
            playwrightSelector: `frame >> nth=${level}`,
            frameId: `iframe[cross-origin-${level}]`
          });
        }
        
        currentWindow = currentWindow.parent;
        level++;
      } catch (e) {
        path.unshift({
          crossOrigin: true,
          message: 'Cross-origin boundary',
          index: level,
          frameId: `iframe[cross-origin-${level}]`
        });
        break;
      }
    }
    
    return path.length > 0 ? path : null;
  }
  
  /**
   * Get frame index for Selenium's switchTo().frame(index)
   */
  function getFrameIndex() {
    if (window === window.top) return null;
    
    try {
      const parentDoc = window.parent.document;
      const frames = parentDoc.querySelectorAll('iframe, frame');
      
      for (let i = 0; i < frames.length; i++) {
        try {
          if (frames[i].contentWindow === window) return i;
        } catch (e) { /* cross-origin */ }
      }
    } catch (e) { /* cross-origin parent */ }
    
    return null;
  }
  
  // ==================== SHADOW DOM DETECTION ====================
  
  /**
   * Get shadow DOM path if element is inside shadow DOM
   */
  function getShadowPath(element) {
    if (!element) return null;
    
    const root = element.getRootNode();
    if (root === document || root === element.ownerDocument) return null;
    if (!(root instanceof ShadowRoot)) return null;
    
    const path = [];
    let current = element;
    
    while (current) {
      const currentRoot = current.getRootNode();
      
      if (currentRoot instanceof ShadowRoot) {
        const host = currentRoot.host;
        if (!host) break;
        
        const hostXPath = generateXPath(host);
        const innerXPath = generateInnerXPath(current, currentRoot);
        
        path.unshift({
          hostXPath: hostXPath,
          hostTag: host.tagName.toLowerCase(),
          hostId: host.id || null,
          hostClass: host.className || null,
          innerXPath: innerXPath,
          shadowMode: currentRoot.mode
        });
        
        current = host;
      } else {
        break;
      }
    }
    
    return path.length > 0 ? path : null;
  }
  
  /**
   * Generate XPath within shadow root
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
  
  // ==================== ELEMENT VALUE EXTRACTION ====================
  
  /**
   * Get value from element, handling shadow DOM inputs
   */
  function getElementValue(element) {
    if (!element) return null;
    
    // Direct value
    if (element.value !== undefined && element.value !== '') {
      return element.value;
    }
    
    // Shadow host - look for inner input
    if (element.shadowRoot) {
      const selectors = ['input', 'textarea', '[contenteditable="true"]'];
      for (const sel of selectors) {
        try {
          const inner = element.shadowRoot.querySelector(sel);
          if (inner && inner.value) return inner.value;
        } catch (e) {}
      }
    }
    
    // Custom element - try to find nested input
    if (element.tagName.includes('-')) {
      const inner = element.querySelector?.('input, textarea');
      if (inner?.value) return inner.value;
    }
    
    // Contenteditable
    if (element.contentEditable === 'true' || element.isContentEditable) {
      return element.textContent || element.innerText || '';
    }
    
    return element.value || null;
  }
  
  /**
   * Get element information
   */
  function getElementInfo(element) {
    const rect = element.getBoundingClientRect();
    const value = getElementValue(element);
    
    return {
      tag: element.tagName.toLowerCase(),
      type: element.type || null,
      id: element.id || null,
      name: element.name || null,
      className: typeof element.className === 'string' ? element.className : null,
      text: (element.textContent || '').trim().slice(0, 100) || null,
      placeholder: element.placeholder || null,
      value: value,
      href: element.href || null,
      role: element.getAttribute('role') || null,
      ariaLabel: element.getAttribute('aria-label') || null,
      visible: rect.width > 0 && rect.height > 0,
      inShadowDOM: element.getRootNode() instanceof ShadowRoot,
      inIframe: window !== window.top
    };
  }
  
  // ==================== DESCRIPTION GENERATOR ====================
  
  function generateDescription(type, element, data = {}) {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || '').trim().slice(0, 30);
    const ariaLabel = element.getAttribute('aria-label') || '';
    const placeholder = element.placeholder || '';
    const name = element.name || '';
    const id = element.id || '';
    const value = data.value || element.value || '';
    
    // Build element identifier
    let target = '';
    if (text && text.length > 0 && text.length < 30) {
      target = text;
    } else if (ariaLabel) {
      target = ariaLabel;
    } else if (placeholder) {
      target = `${placeholder} field`;
    } else if (name) {
      target = `${name} field`;
    } else if (id) {
      target = `#${id}`;
    } else {
      target = tag;
    }
    
    switch (type) {
      case 'click':
        if (tag === 'button' || element.getAttribute('role') === 'button') {
          return `${target} Button`;
        } else if (tag === 'a') {
          return `${target} Link`;
        } else if (tag === 'input' && (element.type === 'checkbox' || element.type === 'radio')) {
          return `${target} ${element.type}`;
        }
        return target;
      
      case 'input':
        const masked = element.type === 'password' ? '****' : value;
        return `"${masked}" on ${target}`;
      
      case 'select':
        return `"${value}" from ${target}`;
      
      case 'check':
        return data.checked ? `Checked ${target}` : `Unchecked ${target}`;
      
      case 'keypress':
        return `${data.key} on ${target}`;
      
      case 'assertion':
        return `${target}`;
      
      default:
        return target;
    }
  }
  
  // ==================== ACTION RECORDING ====================
  
  let lastAction = null;
  let lastActionTime = 0;
  
  function recordAction(type, element, data = {}) {
    if (!isRecording || !element) return;
    
    // Skip recorder UI elements
    try {
      if (element.id === '__action-recorder-indicator') return;
      if (element.closest?.('#__action-recorder-indicator')) return;
    } catch (e) {}
    
    // If assertion mode and click, record assertion instead
    if (isAssertionMode && type === 'click') {
      recordAssertion(element);
      return;
    }
    
    try {
      const xpath = generateXPath(element);
      const now = Date.now();
      
      // Deduplicate rapid identical actions
      if (lastAction && lastAction.type === type && lastAction.xpath === xpath && (now - lastActionTime) < 300) {
        return;
      }
      
      const frameInfo = getFrameElementInfo();

      const action = {
        type: type,
        xpath: xpath,
        fullXPath: generateFullXPath(element),
        element: getElementInfo(element),
        iframe: getIframePath(),
        frameIndex: getFrameIndex(),
        frameElement: frameInfo,
        shadow: getShadowPath(element),
        description: generateDescription(type, element, data),
        ...data
      };

      // If this is an input/change on shadow-hosted element and value missing, extract via shadow helper
      if ((type === 'input' || type === 'change') && !action.value) {
        action.value = getShadowTextContent(element);
      }
      
      lastAction = { type, xpath };
      lastActionTime = now;
      
      console.log('[Recorder] Action:', type, xpath);
      if (action.iframe) console.log('[Recorder] Iframe path:', action.iframe);
      if (action.shadow) console.log('[Recorder] Shadow path:', action.shadow);
      
      chrome.runtime.sendMessage({
        type: 'ACTION_RECORDED',
        action: action
      }).catch(err => {
        console.error('[Recorder] Send error:', err);
      });
      
    } catch (err) {
      console.error('[Recorder] Error recording action:', err);
    }
  }
  
  function flushPendingInput() {
    if (pendingInput) {
      const element = pendingInput.element;
      let value = getElementValue(element);
      
      if (element.type === 'password') value = '****';
      
      recordAction('input', element, { value: value || '' });
      pendingInput = null;
    }
  }
  
  // ==================== ASSERTION RECORDING ====================
  
  /**
   * Get text content from shadow DOM element
   * Traverses into shadow roots to find actual text/value
   */
  function getShadowTextContent(element) {
    if (!element) return '';
    
    // Check for direct value first
    if (element.value !== undefined && element.value !== '') {
      return element.value;
    }
    
    // If element has shadow root, look inside
    if (element.shadowRoot) {
      // Try to find input/textarea inside shadow
      const input = element.shadowRoot.querySelector('input, textarea, [contenteditable="true"]');
      if (input) {
        if (input.value) return input.value;
        if (input.textContent) return input.textContent.trim();
      }
      
      // Get text from shadow root
      const shadowText = element.shadowRoot.textContent || '';
      if (shadowText.trim()) return shadowText.trim();
    }
    
    // For custom elements, check for nested inputs in light DOM
    if (element.tagName && element.tagName.includes('-')) {
      const nestedInput = element.querySelector('input, textarea');
      if (nestedInput?.value) return nestedInput.value;
    }
    
    // Fall back to regular text content
    return (element.textContent || '').trim();
  }
  
  /**
   * Get the inner element from shadow DOM for assertions
   * Returns the actual interactive element inside shadow root
   */
  function getShadowInnerElement(element) {
    if (!element || !element.shadowRoot) return element;
    
    // Look for interactive elements
    const selectors = [
      'input:not([type="hidden"])',
      'textarea',
      '[contenteditable="true"]',
      'select',
      'button',
      '[role="textbox"]',
      '[role="button"]'
    ];
    
    for (const sel of selectors) {
      try {
        const inner = element.shadowRoot.querySelector(sel);
        if (inner) return inner;
      } catch (e) {}
    }
    
    return element;
  }
  
  function recordAssertion(element) {
    if (!isRecording || !element) return;
    
    // For shadow elements, try to get the inner element
    const targetElement = getShadowInnerElement(element);
    
    // Get text value - handle shadow DOM specially
    const shadowPath = getShadowPath(element);
    let textValue = '';
    let shadowInnerValue = '';
    
    if (shadowPath && shadowPath.length > 0) {
      // Element is in shadow DOM - use special extraction
      textValue = getShadowTextContent(element);
      
      // Also try to get value from the actual target element
      if (targetElement !== element) {
        shadowInnerValue = targetElement.value || (targetElement.textContent || '').trim();
      }
    } else {
      // Regular element
      textValue = targetElement.value || (targetElement.textContent || '').trim();
    }
    
    const finalValue = shadowInnerValue || textValue;
    
    const frameInfo = getFrameElementInfo();

    const action = {
      type: 'assertion',
      assertionType: assertionType,
      xpath: generateXPath(element),
      fullXPath: generateFullXPath(element),
      element: getElementInfo(element),
      iframe: getIframePath(),
      frameIndex: getFrameIndex(),
      frameElement: frameInfo,
      shadow: shadowPath,
      // For shadow elements, include inner element info
      shadowInnerElement: shadowPath ? {
        xpath: generateXPath(targetElement),
        tag: targetElement.tagName?.toLowerCase(),
        id: targetElement.id || null,
        value: targetElement.value || null
      } : null,
      textContent: assertionType === 'text' ? finalValue.slice(0, 200) : null,
      expectedValue: assertionType === 'text' ? finalValue.slice(0, 200) : null,
      // Include a note about shadow DOM assertion
      shadowAssertionNote: shadowPath ? 
        'For shadow DOM text assertion, use page.locator(hostXPath).shadowRoot.locator(innerSelector) in Playwright' : null,
      description: generateDescription('assertion', element, { assertionType })
    };
    
    console.log('[Recorder] Assertion:', assertionType, action.xpath);
    if (shadowPath) {
      console.log('[Recorder] Shadow assertion - extracted value:', finalValue);
    }
    
    chrome.runtime.sendMessage({
      type: 'ACTION_RECORDED',
      action: action
    }).catch(err => console.error('[Recorder] Assertion error:', err));
    
    // Exit assertion mode
    exitAssertionMode();
    chrome.runtime.sendMessage({ type: 'ASSERTION_COMPLETE' }).catch(() => {});
  }
  
  function enterAssertionMode(type) {
    isAssertionMode = true;
    assertionType = type || 'element';
    document.body.style.cursor = 'crosshair';
    console.log('[Recorder] Assertion mode:', assertionType);
  }
  
  function exitAssertionMode() {
    isAssertionMode = false;
    document.body.style.cursor = '';
  }
  
  // ==================== EVENT HANDLERS ====================
  
  function handleClick(event) {
    if (!isRecording) return;
    
    flushPendingInput();
    
    const element = event.target;
    if (!element) return;
    
    recordAction('click', element);
  }
  
  function handleInput(event) {
    if (!isRecording) return;
    
    const element = event.target;
    if (!element?.tagName) return;
    if (!['INPUT', 'TEXTAREA'].includes(element.tagName)) return;
    
    pendingInput = {
      element: element,
      startTime: Date.now()
    };
  }
  
  function handleChange(event) {
    if (!isRecording) return;
    
    const element = event.target;
    if (!element?.tagName) return;
    
    if (element.tagName === 'SELECT') {
      flushPendingInput();
      recordAction('select', element, {
        value: element.value,
        text: element.options?.[element.selectedIndex]?.text || ''
      });
    } else if (element.type === 'checkbox' || element.type === 'radio') {
      flushPendingInput();
      recordAction('check', element, { checked: element.checked });
    }
  }
  
  function handleKeydown(event) {
    if (!isRecording) return;
    
    if (event.key === 'Enter') {
      flushPendingInput();
      if (event.target) {
        recordAction('keypress', event.target, { key: 'Enter' });
      }
    } else if (event.key === 'Tab') {
      flushPendingInput();
    }
  }
  
  function handleFocusOut(event) {
    if (!isRecording) return;
    
    if (pendingInput && pendingInput.element === event.target) {
      flushPendingInput();
    }
  }
  
  // ==================== EVENT LISTENER MANAGEMENT ====================
  
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
  
  // ==================== SHADOW DOM OBSERVATION ====================
  
  function findAndAttachToShadowRoots(root = document) {
    const processElement = (el) => {
      if (el.shadowRoot) {
        console.log('[Recorder] Found shadow root:', el.tagName, el.id || el.className);
        attachListeners(el.shadowRoot);
        findAndAttachToShadowRoots(el.shadowRoot);
        observeShadowRoot(el.shadowRoot);
      }
    };
    
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while (node = walker.nextNode()) {
      processElement(node);
    }
  }
  
  function observeShadowRoot(shadowRoot) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.shadowRoot) {
              attachListeners(node.shadowRoot);
              findAndAttachToShadowRoots(node.shadowRoot);
              observeShadowRoot(node.shadowRoot);
            }
            // Check children
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
            let child;
            while (child = walker.nextNode()) {
              if (child.shadowRoot) {
                attachListeners(child.shadowRoot);
                findAndAttachToShadowRoots(child.shadowRoot);
                observeShadowRoot(child.shadowRoot);
              }
            }
          }
        }
      }
    });
    
    observer.observe(shadowRoot, { childList: true, subtree: true });
    shadowObservers.push(observer);
  }
  
  // Main document observer
  function setupMainObserver() {
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
          }
        }
      }
    });
    
    observer.observe(document, { childList: true, subtree: true });
    shadowObservers.push(observer);
  }
  
  // ==================== RECORDING CONTROL ====================
  
  function startRecording() {
    if (isRecording) return;
    
    isRecording = true;
    console.log('[Recorder] Started recording');
    
    // Attach to main document
    attachListeners(document);
    
    // Find and attach to existing shadow roots
    findAndAttachToShadowRoots(document);
    
    // Observe for new shadow roots
    setupMainObserver();
  }
  
  function stopRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    isAssertionMode = false;
    document.body.style.cursor = '';
    console.log('[Recorder] Stopped recording');
    
    // Detach listeners
    detachListeners(document);
    
    // Disconnect observers
    shadowObservers.forEach(obs => obs.disconnect());
    shadowObservers = [];
  }
  
  // ==================== MESSAGE HANDLING ====================
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING':
        startRecording();
        sendResponse({ success: true });
        break;
        
      case 'STOP_RECORDING':
        stopRecording();
        sendResponse({ success: true });
        break;
        
      case 'ENTER_ASSERTION_MODE':
        enterAssertionMode(message.assertionType);
        sendResponse({ success: true });
        break;
        
      case 'EXIT_ASSERTION_MODE':
        exitAssertionMode();
        sendResponse({ success: true });
        break;
        
      case 'GET_STATUS':
        sendResponse({ isRecording, isAssertionMode });
        break;
    }
    return true;
  });
  
  // Handle stop via postMessage (for cross-frame communication)
  window.addEventListener('message', (event) => {
    if (event.data?.type === '__ACTION_RECORDER_STOP__') {
      stopRecording();
    }
  });
  
})();

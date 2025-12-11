// Export Utilities - Generate JSON export with all recording details

/**
 * Export recording to comprehensive JSON format
 * Includes all details: actions, page markers, iframe paths, shadow DOM paths
 */
function exportToJSON(recording) {
  const exportData = {
    // Metadata
    metadata: {
      name: recording.name || 'Unnamed Recording',
      testSuite: recording.testSuite || null,
      testSuiteId: recording.testSuiteId || null,
      testCase: recording.testCase || null,
      testCaseId: recording.testCaseId || null,
      url: recording.url || null,
      startTime: recording.startTime ? new Date(recording.startTime).toISOString() : null,
      endTime: recording.endTime ? new Date(recording.endTime).toISOString() : null,
      duration: recording.endTime && recording.startTime 
        ? Math.round((recording.endTime - recording.startTime) / 1000) + 's'
        : null,
      totalActions: recording.actions?.length || 0,
      exportedAt: new Date().toISOString()
    },
    
    // Page markers summary
    pageMarkers: extractPageMarkers(recording.actions || []),
    
    // All actions with full details
    actions: (recording.actions || []).map((action, index) => formatAction(action, index))
  };
  
  return JSON.stringify(exportData, null, 2);
}

/**
 * Extract page markers for summary
 */
function extractPageMarkers(actions) {
  return actions
    .filter(a => a.type === 'page-marker')
    .map((marker, index) => ({
      index: actions.indexOf(marker),
      pageName: marker.pageName,
      timestamp: marker.timestamp ? new Date(marker.timestamp).toISOString() : null
    }));
}

/**
 * Format a single action with all details
 */
function formatAction(action, index) {
  // Handle page markers
  if (action.type === 'page-marker') {
    return {
      index: index,
      type: 'page-marker',
      pageName: action.pageName,
      timestamp: action.timestamp ? new Date(action.timestamp).toISOString() : null
    };
  }
  
  // Handle assertions
  if (action.type === 'assertion') {
    return {
      index: index,
      type: 'assertion',
      assertionType: action.assertionType || 'element',
      description: action.description || null,
      
      // Locator information
      locator: {
        xpath: action.xpath || null,
        fullXPath: action.fullXPath || null
      },
      
      // Element details
      element: action.element ? {
        tag: action.element.tag,
        id: action.element.id || null,
        name: action.element.name || null,
        className: action.element.className || null,
        text: action.element.text || null,
        ariaLabel: action.element.ariaLabel || null
      } : null,
      
      // Expected values for text assertions
      expectedValue: action.expectedValue || action.textContent || null,
      
      // Context information
      context: buildContextInfo(action),
      
      timestamp: action.timestamp ? new Date(action.timestamp).toISOString() : null
    };
  }
  
  // Handle regular actions (click, input, select, keypress, etc.)
  const formatted = {
    index: index,
    type: action.type,
    description: action.description || null,
    
    // Locator information
    locator: {
      xpath: action.xpath || null,
      fullXPath: action.fullXPath || null
    },
    
    // Element details
    element: action.element ? {
      tag: action.element.tag,
      type: action.element.type || null,
      id: action.element.id || null,
      name: action.element.name || null,
      className: action.element.className || null,
      text: action.element.text || null,
      placeholder: action.element.placeholder || null,
      ariaLabel: action.element.ariaLabel || null
    } : null,
    
    // Context information (iframe, shadow DOM)
    context: buildContextInfo(action),
    
    timestamp: action.timestamp ? new Date(action.timestamp).toISOString() : null
  };
  
  // Add type-specific data
  if (action.type === 'input') {
    formatted.value = action.value || '';
  }
  
  if (action.type === 'select') {
    formatted.value = action.value || '';
    formatted.selectedText = action.text || '';
  }
  
  if (action.type === 'keypress') {
    formatted.key = action.key || '';
  }
  
  if (action.type === 'check') {
    formatted.checked = action.checked || false;
  }
  
  return formatted;
}

/**
 * Build context information (iframe path, shadow DOM path)
 */
function buildContextInfo(action) {
  const context = {
    inIframe: false,
    inShadowDOM: false
  };
  
  // Iframe information
  if (action.iframe && action.iframe.length > 0) {
    context.inIframe = true;
    context.iframeDepth = action.iframe.length;
    context.iframePath = action.iframe.map(frame => ({
      xpath: frame.xpath || null,
      fullXPath: frame.fullXPath || null,
      selector: frame.selector || null,
      id: frame.id || null,
      name: frame.name || null,
      index: frame.index,
      crossOrigin: frame.crossOrigin || false
    }));
    
    // Simplified iframe selector for automation
    context.iframeSelector = action.iframe
      .map(f => f.selector || `(//iframe)[${(f.index || 0) + 1}]`)
      .join(' → ');
  }
  
  // Frame index for simple switching
  if (action.frameIndex !== null && action.frameIndex !== undefined) {
    context.frameIndex = action.frameIndex;
  }
  
  // Shadow DOM information
  if (action.shadow && action.shadow.length > 0) {
    context.inShadowDOM = true;
    context.shadowDepth = action.shadow.length;
    context.shadowPath = action.shadow.map(shadow => ({
      hostXPath: shadow.hostXPath || null,
      hostTag: shadow.hostTag || null,
      hostId: shadow.hostId || null,
      hostClass: shadow.hostClass || null,
      innerXPath: shadow.innerXPath || null,
      shadowMode: shadow.shadowMode || 'open'
    }));
    
    // Build shadow host chain for automation
    context.shadowHostChain = action.shadow.map(s => s.hostXPath).filter(Boolean);
  }
  
  return context;
}

/**
 * Get best selector for automation frameworks
 * Returns xpath by default, with shadow/iframe context
 */
function getBestSelector(action) {
  return {
    primary: action.xpath || action.fullXPath || null,
    iframe: action.iframe?.map(f => f.selector) || null,
    shadowHosts: action.shadow?.map(s => s.hostXPath) || null
  };
}

// Make exportToJSON available globally
if (typeof window !== 'undefined') {
  window.exportToJSON = exportToJSON;
}

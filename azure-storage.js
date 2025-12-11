// Azure Blob Storage Integration for Action Recorder Extension
// This module handles uploading/downloading Excel files and recordings to Azure Blob Storage

/**
 * Azure Storage Configuration
 * IMPORTANT: Replace these with your actual Azure Storage details
 */
const AZURE_CONFIG = {
  // Your storage account name (e.g., 'actionrecorderstore')
  accountName: 'YOUR_STORAGE_ACCOUNT_NAME',
  
  // Your SAS token (starts with '?sv=...')
  // Generate from Azure Portal > Storage Account > Shared access signature
  sasToken: 'YOUR_SAS_TOKEN_HERE',
  
  // Container names
  containers: {
    recordings: 'recordings',
    excelData: 'excel-data'
  }
};

/**
 * Get the base URL for blob storage
 */
function getBlobBaseUrl(containerName) {
  return `https://${AZURE_CONFIG.accountName}.blob.core.windows.net/${containerName}`;
}

/**
 * Upload a file to Azure Blob Storage
 * @param {File|Blob} file - The file to upload
 * @param {string} containerName - The container name ('recordings' or 'excel-data')
 * @param {string} [customFileName] - Optional custom filename
 * @returns {Promise<{success: boolean, url: string, fileName: string}>}
 */
async function uploadToAzureBlob(file, containerName, customFileName = null) {
  try {
    // Generate unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const originalName = file.name || 'file';
    const fileName = customFileName || `${timestamp}_${originalName}`;
    
    // Construct upload URL
    const uploadUrl = `${getBlobBaseUrl(containerName)}/${fileName}${AZURE_CONFIG.sasToken}`;
    
    // Determine content type
    const contentType = file.type || getContentTypeFromExtension(fileName);
    
    // Upload using PUT request
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': contentType
      },
      body: file
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    
    // Return success with download URL
    const downloadUrl = `${getBlobBaseUrl(containerName)}/${fileName}`;
    
    console.log('[Azure Storage] File uploaded successfully:', fileName);
    
    return {
      success: true,
      url: downloadUrl,
      fileName: fileName,
      containerName: containerName,
      uploadedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Azure Storage] Upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Download a file from Azure Blob Storage
 * @param {string} containerName - The container name
 * @param {string} fileName - The file name to download
 * @returns {Promise<Blob>}
 */
async function downloadFromAzureBlob(containerName, fileName) {
  try {
    const downloadUrl = `${getBlobBaseUrl(containerName)}/${fileName}${AZURE_CONFIG.sasToken}`;
    
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    const blob = await response.blob();
    console.log('[Azure Storage] File downloaded successfully:', fileName);
    
    return blob;
  } catch (error) {
    console.error('[Azure Storage] Download error:', error);
    throw error;
  }
}

/**
 * List files in a container
 * @param {string} containerName - The container name
 * @returns {Promise<Array<{name: string, url: string, size: number}>>}
 */
async function listAzureBlobs(containerName) {
  try {
    // Use List Blobs API
    const listUrl = `${getBlobBaseUrl(containerName)}?restype=container&comp=list${AZURE_CONFIG.sasToken.replace('?', '&')}`;
    
    const response = await fetch(listUrl);
    
    if (!response.ok) {
      throw new Error(`List failed: ${response.status}`);
    }
    
    const xmlText = await response.text();
    
    // Parse XML response
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const blobs = xmlDoc.querySelectorAll('Blob');
    
    const files = [];
    blobs.forEach(blob => {
      const name = blob.querySelector('Name')?.textContent;
      const size = blob.querySelector('Content-Length')?.textContent;
      const lastModified = blob.querySelector('Last-Modified')?.textContent;
      
      if (name) {
        files.push({
          name: name,
          url: `${getBlobBaseUrl(containerName)}/${name}`,
          size: parseInt(size) || 0,
          lastModified: lastModified
        });
      }
    });
    
    console.log('[Azure Storage] Listed', files.length, 'files in', containerName);
    return files;
  } catch (error) {
    console.error('[Azure Storage] List error:', error);
    return [];
  }
}

/**
 * Delete a file from Azure Blob Storage
 * @param {string} containerName - The container name
 * @param {string} fileName - The file name to delete
 * @returns {Promise<boolean>}
 */
async function deleteFromAzureBlob(containerName, fileName) {
  try {
    const deleteUrl = `${getBlobBaseUrl(containerName)}/${fileName}${AZURE_CONFIG.sasToken}`;
    
    const response = await fetch(deleteUrl, {
      method: 'DELETE'
    });
    
    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed: ${response.status}`);
    }
    
    console.log('[Azure Storage] File deleted:', fileName);
    return true;
  } catch (error) {
    console.error('[Azure Storage] Delete error:', error);
    return false;
  }
}

/**
 * Upload Excel file to Azure
 * @param {File} file - The Excel file
 * @returns {Promise<Object>}
 */
async function uploadExcelFile(file) {
  return uploadToAzureBlob(file, AZURE_CONFIG.containers.excelData);
}

/**
 * Upload recording file to Azure
 * @param {string} content - The recording content (JSON, JS, Python, etc.)
 * @param {string} fileName - The filename with extension
 * @returns {Promise<Object>}
 */
async function uploadRecordingFile(content, fileName) {
  const blob = new Blob([content], { type: getContentTypeFromExtension(fileName) });
  return uploadToAzureBlob(blob, AZURE_CONFIG.containers.recordings, fileName);
}

/**
 * Get content type from file extension
 */
function getContentTypeFromExtension(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const types = {
    'json': 'application/json',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'py': 'text/x-python',
    'java': 'text/x-java-source',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'csv': 'text/csv'
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Check if Azure Storage is configured
 */
function isAzureConfigured() {
  return AZURE_CONFIG.accountName !== 'YOUR_STORAGE_ACCOUNT_NAME' && 
         AZURE_CONFIG.sasToken !== 'YOUR_SAS_TOKEN_HERE';
}

/**
 * Update Azure configuration
 * @param {string} accountName - Storage account name
 * @param {string} sasToken - SAS token
 */
function configureAzureStorage(accountName, sasToken) {
  AZURE_CONFIG.accountName = accountName;
  AZURE_CONFIG.sasToken = sasToken.startsWith('?') ? sasToken : '?' + sasToken;
  
  // Save to chrome.storage for persistence
  chrome.storage.local.set({
    azureConfig: {
      accountName: accountName,
      sasToken: sasToken
    }
  });
  
  console.log('[Azure Storage] Configuration updated');
}

/**
 * Load Azure configuration from storage
 */
async function loadAzureConfig() {
  try {
    const result = await chrome.storage.local.get('azureConfig');
    if (result.azureConfig) {
      AZURE_CONFIG.accountName = result.azureConfig.accountName;
      AZURE_CONFIG.sasToken = result.azureConfig.sasToken;
      console.log('[Azure Storage] Configuration loaded');
      return true;
    }
  } catch (e) {
    console.log('[Azure Storage] No saved configuration found');
  }
  return false;
}

// Export functions for use in sidepanel.js
window.AzureStorage = {
  uploadExcelFile,
  uploadRecordingFile,
  downloadFromAzureBlob,
  listAzureBlobs,
  deleteFromAzureBlob,
  uploadToAzureBlob,
  isAzureConfigured,
  configureAzureStorage,
  loadAzureConfig,
  AZURE_CONFIG
};

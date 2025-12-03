// Export Utilities - Generate test code with page markers and proper iframe/shadow handling

/**
 * Export recording to JSON format
 */
function exportToJSON(recording) {
  const simplified = {
    name: recording.name,
    url: recording.url,
    recordedAt: new Date(recording.startTime).toISOString(),
    actions: recording.actions.map(action => {
      // Handle page markers
      if (action.type === 'page-marker') {
        return {
          type: 'page-marker',
          pageName: action.pageName,
          description: action.description || null
        };
      }
      
      // Handle assertions
      if (action.type === 'assertion') {
        return {
          type: 'assertion',
          xpath: action.xpath || null,
          description: action.description || null,
          textContent: action.textContent || null,
          element: action.element?.tag || null
        };
      }
      
      const entry = {
        action: action.type,
        xpath: action.xpath || null,
        element: action.element?.tag || null,
        description: action.description || null
      };
      
      if (action.value !== undefined && action.value !== null) {
        entry.value = action.value;
      }
      
      if (action.key) {
        entry.key = action.key;
      }
      
      // Include iframe info
      if (action.iframe?.length > 0) {
        entry.iframe = action.iframe.map(f => ({
          xpath: f.xpath || null,
          id: f.id || null,
          name: f.name || null,
          index: f.index
        }));
      }
      
      // Include frame index for easy Selenium switching
      if (action.frameIndex !== null && action.frameIndex !== undefined) {
        entry.frameIndex = action.frameIndex;
      }
      
      // Include shadow DOM info
      if (action.shadow?.length > 0) {
        entry.shadow = action.shadow.map(s => ({
          hostXPath: s.hostXPath,
          innerSelector: s.innerSelector
        }));
      }
      
      return entry;
    })
  };
  
  return JSON.stringify(simplified, null, 2);
}

/**
 * Get XPath from action
 */
function getXPath(action) {
  return action.xpath || action.fullXPath || null;
}

/**
 * Export to Playwright format
 */
function exportToPlaywright(recording) {
  let code = `import { test, expect } from '@playwright/test';

test.describe('${escapeString(recording.name)}', () => {
  test('recorded test', async ({ page }) => {
    await page.goto('${escapeString(recording.url)}');
    
`;
  
  let currentIframe = null;
  let currentPage = null;
  
  for (const action of recording.actions) {
    // Handle page markers
    if (action.type === 'page-marker') {
      code += `\n    // ========== ${action.pageName} ==========\n\n`;
      currentPage = action.pageName;
      continue;
    }
    
    // Handle assertions
    if (action.type === 'assertion') {
      const xpath = getXPath(action);
      if (xpath) {
        if (action.description) {
          code += `    // ${action.description}\n`;
        }
        code += `    // Assert element exists and contains text\n`;
        code += `    await expect(${currentIframe ? 'frame' : 'page'}.locator('xpath=${escapeString(xpath)}')).toBeVisible();\n`;
        if (action.textContent) {
          code += `    await expect(${currentIframe ? 'frame' : 'page'}.locator('xpath=${escapeString(xpath)}')).toContainText('${escapeString(action.textContent)}');\n`;
        }
        code += '\n';
      }
      continue;
    }
    
    const xpath = getXPath(action);
    if (!xpath) continue;
    
    const tag = action.element?.tag || 'element';
    const iframePath = action.iframe;
    
    // Handle iframe context
    let locator = 'page';
    if (iframePath?.length > 0) {
      const iframe = iframePath[0];
      // Use the pre-built selector, or build one from available attributes
      const iframeSelector = iframe.selector || 
                             iframe.xpath || 
                             (iframe.name ? `iframe[name="${iframe.name}"]` : null) ||
                             (iframe.id ? `iframe[id="${iframe.id}"]` : null) ||
                             (typeof iframe.index === 'number' ? `iframe >> nth=${iframe.index}` : 'iframe');
      
      if (currentIframe !== iframeSelector) {
        code += `    // Switch to iframe\n`;
        if (iframe.crossOrigin) {
          code += `    // Note: Cross-origin iframe detected\n`;
        }
        code += `    const frame = page.frameLocator('${escapeString(iframeSelector)}');\n`;
        currentIframe = iframeSelector;
      }
      locator = 'frame';
    } else if (currentIframe) {
      code += `    // Back to main frame\n`;
      currentIframe = null;
      locator = 'page';
    }
    
    // Handle shadow DOM
    if (action.shadow?.length > 0) {
      code += `    // Note: Element is inside shadow DOM\n`;
      code += `    // Shadow host: ${action.shadow[0].hostXPath}\n`;
    }
    
    // Add description comment if available
    if (action.description) {
      code += `    // ${action.description}\n`;
    } else {
      code += `    // ${action.type} on ${tag}\n`;
    }
    
    switch (action.type) {
      case 'click':
        code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').click();\n`;
        break;
      case 'input':
        code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').fill('${escapeString(action.value || '')}');\n`;
        break;
      case 'select':
        code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').selectOption('${escapeString(action.value || '')}');\n`;
        break;
      case 'check':
        if (action.checked) {
          code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').check();\n`;
        } else {
          code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').uncheck();\n`;
        }
        break;
      case 'keypress':
        code += `    await ${locator}.locator('xpath=${escapeString(xpath)}').press('${action.key || 'Enter'}');\n`;
        break;
    }
    code += '\n';
  }
  
  code += `  });
});
`;
  
  return code;
}

/**
 * Export to Selenium Python format
 */
function exportToSeleniumPython(recording) {
  let code = `"""
${recording.name}
URL: ${recording.url}
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select


class Test${sanitizeClassName(recording.name)}:
    def setup_method(self):
        self.driver = webdriver.Chrome()
        self.driver.implicitly_wait(10)
        self.driver.maximize_window()
    
    def teardown_method(self):
        self.driver.quit()
    
    def test_recorded_actions(self):
        driver = self.driver
        driver.get("${escapeString(recording.url)}")
        
`;
  
  let inIframe = false;
  let currentPage = null;
  
  for (const action of recording.actions) {
    // Handle page markers
    if (action.type === 'page-marker') {
      code += `\n        # ========== ${action.pageName} ==========\n\n`;
      currentPage = action.pageName;
      continue;
    }
    
    // Handle assertions
    if (action.type === 'assertion') {
      const xpath = getXPath(action);
      if (xpath) {
        if (action.description) {
          code += `        # ${action.description}\n`;
        }
        code += `        # Assert element exists\n`;
        code += `        assert driver.find_element(By.XPATH, "${escapeString(xpath)}").is_displayed()\n`;
        if (action.textContent) {
          code += `        assert "${escapeString(action.textContent)}" in driver.find_element(By.XPATH, "${escapeString(xpath)}").text\n`;
        }
        code += '\n';
      }
      continue;
    }
    
    const xpath = getXPath(action);
    if (!xpath) continue;
    
    const tag = action.element?.tag || 'element';
    const iframePath = action.iframe;
    
    // Handle iframe switching
    if (iframePath?.length > 0 && !inIframe) {
      const iframe = iframePath[0];
      code += `        # Switch to iframe\n`;
      
      if (iframe.xpath) {
        code += `        iframe = driver.find_element(By.XPATH, "${escapeString(iframe.xpath)}")\n`;
        code += `        driver.switch_to.frame(iframe)\n`;
      } else if (iframe.id) {
        code += `        driver.switch_to.frame("${escapeString(iframe.id)}")\n`;
      } else if (iframe.name) {
        code += `        driver.switch_to.frame("${escapeString(iframe.name)}")\n`;
      } else if (iframe.index !== null && iframe.index !== undefined) {
        code += `        driver.switch_to.frame(${iframe.index})\n`;
      }
      code += '\n';
      inIframe = true;
    } else if (!iframePath?.length && inIframe) {
      code += `        # Switch back to main content\n`;
      code += `        driver.switch_to.default_content()\n\n`;
      inIframe = false;
    }
    
    // Handle shadow DOM
    if (action.shadow?.length > 0) {
      code += `        # Note: Element inside shadow DOM - may need JavaScript executor\n`;
      code += `        # Shadow host: ${action.shadow[0].hostXPath}\n`;
    }
    
    // Add description comment if available
    if (action.description) {
      code += `        # ${action.description}\n`;
    } else {
      code += `        # ${action.type} on ${tag}\n`;
    }
    
    switch (action.type) {
      case 'click':
        code += `        driver.find_element(By.XPATH, "${escapeString(xpath)}").click()\n`;
        break;
      case 'input':
        code += `        element = driver.find_element(By.XPATH, "${escapeString(xpath)}")\n`;
        code += `        element.clear()\n`;
        code += `        element.send_keys("${escapeString(action.value || '')}")\n`;
        break;
      case 'select':
        code += `        Select(driver.find_element(By.XPATH, "${escapeString(xpath)}")).select_by_value("${escapeString(action.value || '')}")\n`;
        break;
      case 'check':
        code += `        checkbox = driver.find_element(By.XPATH, "${escapeString(xpath)}")\n`;
        code += `        if checkbox.is_selected() != ${action.checked ? 'True' : 'False'}:\n`;
        code += `            checkbox.click()\n`;
        break;
      case 'keypress':
        const key = (action.key || 'ENTER').toUpperCase();
        code += `        driver.find_element(By.XPATH, "${escapeString(xpath)}").send_keys(Keys.${key})\n`;
        break;
    }
    code += '\n';
  }
  
  if (inIframe) {
    code += `        driver.switch_to.default_content()\n`;
  }
  
  code += `

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
`;
  
  return code;
}

/**
 * Export to Selenium Java format
 */
function exportToSeleniumJava(recording) {
  const className = sanitizeClassName(recording.name);
  
  let code = `import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;
import java.time.Duration;

/**
 * ${recording.name}
 * URL: ${recording.url}
 */
public class ${className} {
    
    private WebDriver driver;
    private WebDriverWait wait;
    
    public void setUp() {
        driver = new ChromeDriver();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
        driver.manage().window().maximize();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }
    
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
    
    public void testRecordedActions() {
        driver.get("${escapeString(recording.url)}");
        
`;
  
  let inIframe = false;
  let currentPage = null;
  
  for (const action of recording.actions) {
    // Handle page markers - generate as class separation comments
    if (action.type === 'page-marker') {
      code += `\n        // ========== ${action.pageName} ==========\n\n`;
      currentPage = action.pageName;
      continue;
    }
    
    // Handle assertions
    if (action.type === 'assertion') {
      const xpath = getXPath(action);
      if (xpath) {
        if (action.description) {
          code += `        // ${action.description}\n`;
        }
        code += `        // Assert element exists and is displayed\n`;
        code += `        WebElement assertElement = driver.findElement(By.xpath("${escapeString(xpath)}"));\n`;
        code += `        assert assertElement.isDisplayed();\n`;
        if (action.textContent) {
          code += `        assert assertElement.getText().contains("${escapeString(action.textContent)}");\n`;
        }
        code += '\n';
      }
      continue;
    }
    
    const xpath = getXPath(action);
    if (!xpath) continue;
    
    const tag = action.element?.tag || 'element';
    const iframePath = action.iframe;
    
    // Handle iframe switching
    if (iframePath?.length > 0 && !inIframe) {
      const iframe = iframePath[0];
      code += `        // Switch to iframe\n`;
      
      if (iframe.xpath) {
        code += `        WebElement iframeElement = driver.findElement(By.xpath("${escapeString(iframe.xpath)}"));\n`;
        code += `        driver.switchTo().frame(iframeElement);\n`;
      } else if (iframe.id) {
        code += `        driver.switchTo().frame("${escapeString(iframe.id)}");\n`;
      } else if (iframe.name) {
        code += `        driver.switchTo().frame("${escapeString(iframe.name)}");\n`;
      } else if (iframe.index !== null && iframe.index !== undefined) {
        code += `        driver.switchTo().frame(${iframe.index});\n`;
      }
      code += '\n';
      inIframe = true;
    } else if (!iframePath?.length && inIframe) {
      code += `        // Switch back to main content\n`;
      code += `        driver.switchTo().defaultContent();\n\n`;
      inIframe = false;
    }
    
    // Handle shadow DOM
    if (action.shadow?.length > 0) {
      code += `        // Note: Element inside shadow DOM - may need JavaScriptExecutor\n`;
      code += `        // Shadow host: ${action.shadow[0].hostXPath}\n`;
    }
    
    // Add description comment if available
    if (action.description) {
      code += `        // ${action.description}\n`;
    } else {
      code += `        // ${action.type} on ${tag}\n`;
    }
    
    switch (action.type) {
      case 'click':
        code += `        driver.findElement(By.xpath("${escapeString(xpath)}")).click();\n`;
        break;
      case 'input':
        code += `        WebElement inputElement = driver.findElement(By.xpath("${escapeString(xpath)}"));\n`;
        code += `        inputElement.clear();\n`;
        code += `        inputElement.sendKeys("${escapeString(action.value || '')}");\n`;
        break;
      case 'select':
        code += `        new Select(driver.findElement(By.xpath("${escapeString(xpath)}"))).selectByValue("${escapeString(action.value || '')}");\n`;
        break;
      case 'check':
        code += `        WebElement checkbox = driver.findElement(By.xpath("${escapeString(xpath)}"));\n`;
        code += `        if (checkbox.isSelected() != ${action.checked}) {\n`;
        code += `            checkbox.click();\n`;
        code += `        }\n`;
        break;
      case 'keypress':
        const key = (action.key || 'ENTER').toUpperCase();
        code += `        driver.findElement(By.xpath("${escapeString(xpath)}")).sendKeys(Keys.${key});\n`;
        break;
    }
    code += '\n';
  }
  
  if (inIframe) {
    code += `        driver.switchTo().defaultContent();\n`;
  }
  
  code += `    }
    
    public static void main(String[] args) {
        ${className} test = new ${className}();
        try {
            test.setUp();
            test.testRecordedActions();
            System.out.println("Test completed successfully!");
        } catch (Exception e) {
            System.err.println("Test failed: " + e.getMessage());
            e.printStackTrace();
        } finally {
            test.tearDown();
        }
    }
}
`;
  
  return code;
}

// ===== UTILITY FUNCTIONS =====

function escapeString(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function sanitizeClassName(name) {
  let className = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^[0-9]+/, '');
  
  if (!className) {
    className = 'RecordedTest';
  }
  
  // Capitalize first letter
  return className.charAt(0).toUpperCase() + className.slice(1);
}

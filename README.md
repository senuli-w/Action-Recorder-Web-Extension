# Action Recorder Studio

A Chrome extension for recording user actions on web pages with full support for iframes and shadow DOM elements. Export recordings to Playwright, Selenium (Python/Java), or JSON.

## Features

- **Recording Actions**: Click, input, select, checkbox/radio, keyboard events
- **Shadow DOM Support**: Automatically traverses and records actions within shadow DOM boundaries
- **Iframe Support**: Handles nested iframes with proper path tracking
- **Multiple Selector Strategies**: XPath, CSS selectors, ID-based, data-testid attributes
- **Recording History**: Save and access previous recordings from the sidebar
- **Export Options**: 
  - JSON (raw action data)
  - Playwright (TypeScript)
  - Selenium Python
  - Selenium Java

## Installation

1. Clone or download this extension
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your toolbar

## Usage

### Recording

1. Click the extension icon to open the side panel
2. Navigate to the webpage you want to record
3. Click **Start Recording**
4. Perform your actions on the page
5. Click **Stop Recording** when done

### Saving Recordings

After stopping a recording:
1. Click **Save Recording**
2. Enter a name for your recording (or use the auto-generated timestamp)
3. Click Save

### Accessing Previous Recordings

1. Open the side panel
2. Click the **History** tab
3. Click on any saved recording to view details
4. From the detail modal you can:
   - Export to different formats
   - Rename the recording
   - Delete the recording

### Export Formats

#### JSON
Raw action data including all selector strategies and element information.

#### Playwright (TypeScript)
```typescript
import { test, expect } from '@playwright/test';

test('Recorded Test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.locator('#button').click();
  await page.locator('input[name="email"]').fill('test@example.com');
});
```

#### Selenium Python
```python
from selenium import webdriver
from selenium.webdriver.common.by import By

driver = webdriver.Chrome()
driver.get("https://example.com")
driver.find_element(By.ID, "button").click()
driver.find_element(By.NAME, "email").send_keys("test@example.com")
```

#### Selenium Java
```java
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;

public class RecordedTest {
    public static void main(String[] args) {
        WebDriver driver = new ChromeDriver();
        driver.get("https://example.com");
        driver.findElement(By.id("button")).click();
        driver.findElement(By.name("email")).sendKeys("test@example.com");
    }
}
```

## Shadow DOM Handling

The extension automatically detects and handles shadow DOM elements:

1. **Detection**: Uses `getRootNode()` to detect shadow boundaries
2. **Path Recording**: Records the full shadow path for nested shadow DOMs
3. **Selector Generation**: Creates both CSS and XPath selectors with shadow piercing

For exported tests, shadow DOM elements include comments with the shadow path to help you implement the appropriate selector strategy for your framework.

## Iframe Handling

Nested iframes are fully supported:

1. Content scripts are injected into all frames (`all_frames: true`)
2. The iframe path is recorded for each action
3. Exported tests include comments with iframe navigation hints

## Technical Details

### Selector Priority

The extension generates selectors in this priority order:
1. `data-testid`, `data-test-id`, `data-cy`, `data-test` attributes
2. Element `id` attribute
3. `name` attribute
4. Computed CSS selector
5. XPath

### Recorded Action Data

Each recorded action contains:
- `type`: Action type (click, input, select, keydown, etc.)
- `timestamp`: When the action occurred
- `url`: Page URL
- `selectors`: Multiple selector strategies
- `elementInfo`: Tag, type, text, visibility, position
- `iframePath`: Path through iframes (if applicable)
- `shadowPath`: Path through shadow DOMs (if applicable)

## File Structure

```
action-recorder-extension/
├── manifest.json        # Extension configuration
├── background.js        # Service worker
├── content.js          # Content script (injected into pages)
├── sidepanel.html      # Side panel UI
├── sidepanel.css       # Styles
├── sidepanel.js        # Side panel logic
├── export.js           # Export utilities
├── icons/              # Extension icons
└── README.md           # This file
```

## Browser Support

- Chrome 116+ (required for sidePanel API)
- Microsoft Edge 116+ (Chromium-based)

## Limitations

- Cross-origin iframes: Limited access due to browser security
- Some dynamically generated selectors may need adjustment
- Very complex shadow DOM nesting may require manual selector refinement

## License

MIT License

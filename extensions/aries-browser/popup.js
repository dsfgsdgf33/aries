/**
 * Aries Browser Extension v2.0 — Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const tabTitle = document.getElementById('tabTitle');
  const tabUrl = document.getElementById('tabUrl');
  const capabilities = document.getElementById('capabilities');
  const resultArea = document.getElementById('resultArea');
  const resultBox = document.getElementById('resultBox');

  // Get status from background
  chrome.runtime.sendMessage({ _ariesPopup: true, cmd: 'getStatus' }, (resp) => {
    if (resp && resp.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
    } else {
      statusText.textContent = 'Disconnected';
    }
    if (resp && resp.capabilities) {
      resp.capabilities.forEach(cap => {
        const tag = document.createElement('span');
        tag.className = 'cap-tag';
        tag.textContent = cap;
        capabilities.appendChild(tag);
      });
    }
  });

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabTitle.textContent = tab.title || 'Untitled';
    tabUrl.textContent = tab.url || '—';
  }

  // Reconnect button
  document.getElementById('reconnectBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ _ariesPopup: true, cmd: 'reconnect' }, () => {
      statusText.textContent = 'Reconnecting...';
      setTimeout(() => {
        chrome.runtime.sendMessage({ _ariesPopup: true, cmd: 'getStatus' }, (resp) => {
          if (resp && resp.connected) {
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected';
          } else {
            statusDot.classList.remove('connected');
            statusText.textContent = 'Disconnected';
          }
        });
      }, 2000);
    });
  });

  function showResult(data) {
    resultArea.classList.add('visible');
    resultBox.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  function sendToTab(cmd, args) {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { _aries: true, cmd, args: args || {} }, (resp) => {
      if (chrome.runtime.lastError) {
        showResult('Error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.ok) showResult(resp.data);
      else showResult('Error: ' + (resp ? resp.error : 'No response'));
    });
  }

  // Action buttons
  document.getElementById('btnSnapshot').addEventListener('click', () => {
    sendToTab('ariaTree', { maxDepth: 8 });
  });

  document.getElementById('btnScreenshot').addEventListener('click', () => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (dataUrl) showResult('Screenshot captured (' + Math.round(dataUrl.length / 1024) + ' KB)');
      else showResult('Error capturing screenshot');
    });
  });

  document.getElementById('btnConsole').addEventListener('click', () => {
    sendToTab('consoleLogs', { limit: 50 });
  });

  document.getElementById('btnCookies').addEventListener('click', () => {
    if (!tab || !tab.url) return;
    chrome.cookies.getAll({ url: tab.url }, (cookies) => {
      showResult({ count: cookies.length, cookies: cookies.map(c => ({ name: c.name, value: c.value.slice(0, 50), domain: c.domain })) });
    });
  });

  document.getElementById('btnPdf').addEventListener('click', () => {
    showResult('PDF generation requires debugger API — use the gateway command: POST /api/extension/command { cmd: "pdf" }');
  });

  document.getElementById('btnNetwork').addEventListener('click', () => {
    showResult('Network recording requires debugger API — use: POST /api/extension/command { cmd: "networkGetLog" }');
  });

  document.getElementById('btnHighlight').addEventListener('click', () => {
    sendToTab('evaluate', {
      code: `
        document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [onclick], [tabindex]').forEach((el, i) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const ov = document.createElement('div');
          ov.style.cssText = 'position:fixed;z-index:999999;pointer-events:none;border:2px solid #00e5ff;background:#00e5ff18;border-radius:2px;' +
            'left:' + (rect.x-1) + 'px;top:' + (rect.y-1) + 'px;width:' + (rect.width+2) + 'px;height:' + (rect.height+2) + 'px;';
          const lbl = document.createElement('div');
          lbl.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.textContent.trim().slice(0,20) ? ' "' + el.textContent.trim().slice(0,20) + '"' : '');
          lbl.style.cssText = 'position:absolute;top:-16px;left:0;background:#00e5ff;color:#000;font-size:9px;padding:1px 4px;border-radius:2px;font-family:monospace;white-space:nowrap;';
          ov.appendChild(lbl);
          document.body.appendChild(ov);
          setTimeout(() => { ov.style.opacity = '0'; ov.style.transition = 'opacity 0.3s'; setTimeout(() => ov.remove(), 300); }, 5000);
        });
        'Highlighted ' + document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"]').length + ' interactive elements';
      `
    });
  });
});

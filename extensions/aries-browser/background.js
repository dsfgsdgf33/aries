/**
 * Aries Browser Extension v2.0 — Service Worker (Background)
 * Advanced browser control: DOM snapshots, element targeting, debugger API,
 * network interception, PDF generation, cookie management, dialog handling, and more.
 */

importScripts('crypto.js');

const WS_URL = 'ws://localhost:3333/ext';
const UPDATE_URL = 'http://localhost:3333/api/extension/version';
const VERSION = '2.0.0';
const RECONNECT_DELAY = 5000;
const UPDATE_INTERVAL = 3 * 60 * 60 * 1000;

let ws = null;
let wsConnected = false;
let reconnectTimer = null;

// Debugger state
let debuggerAttached = new Map(); // tabId -> true
let networkRecording = new Map(); // tabId -> { requests: [], enabled: boolean }
let dialogHandlers = new Map(); // tabId -> { autoRespond, response }

// ─── WebSocket Connection ───

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsConnected = true;
    clearTimeout(reconnectTimer);
    console.log('[ARIES] Connected to Aries v2.0');
    sendEvent('connected', { version: VERSION, capabilities: getCapabilities() });
    chrome.tabs.query({}, tabs => {
      sendEvent('tabList', { tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId })) });
    });
    restoreWatches();
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.id && msg.cmd) {
      handleCommand(msg).catch(err => {
        send({ id: msg.id, ok: false, error: err.message || String(err) });
      });
    }
  };

  ws.onclose = () => {
    wsConnected = false;
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {};
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendEvent(event, data) {
  send({ event, data });
}

function getCapabilities() {
  return [
    'snapshot', 'ariaTree', 'click', 'type', 'fill', 'select', 'hover', 'drag',
    'findElement', 'formFill', 'evaluate', 'navigate',
    'screenshot', 'fullPageScreenshot', 'pdf',
    'consoleLogs', 'networkIntercept',
    'dialogHandle', 'fileUpload',
    'cookies', 'clipboard',
    'scroll', 'highlight', 'waitFor', 'waitForIdle',
    'getTabs', 'openTab', 'closeTab', 'focusTab', 'groupTabs',
    'multiTabRun', 'watch', 'autoLogin'
  ];
}

// ─── Command Router ───

async function handleCommand(msg) {
  const { id, cmd, args } = msg;
  const a = args || {};
  let result;

  try {
    switch (cmd) {
      // === DOM / Content Operations (forwarded to content script) ===
      case 'snapshot': result = await cmdContentForward('snapshot', a); break;
      case 'ariaTree': result = await cmdContentForward('ariaTree', a); break;
      case 'click': result = await cmdContentForward('click', a); break;
      case 'type': result = await cmdContentForward('type', a); break;
      case 'fill': result = await cmdContentForward('fill', a); break;
      case 'select': result = await cmdContentForward('select', a); break;
      case 'hover': result = await cmdContentForward('hover', a); break;
      case 'drag': result = await cmdContentForward('drag', a); break;
      case 'findElement': result = await cmdContentForward('findElement', a); break;
      case 'formFill': result = await cmdContentForward('formFill', a); break;
      case 'evaluate': result = await cmdContentForward('evaluate', a); break;
      case 'scroll': result = await cmdContentForward('scroll', a); break;
      case 'highlight': result = await cmdContentForward('highlight', a); break;
      case 'waitFor': result = await cmdContentForward('waitFor', a); break;
      case 'waitForIdle': result = await cmdContentForward('waitForIdle', a); break;
      case 'getLinks': result = await cmdContentForward('getLinks', a); break;
      case 'getText': result = await cmdContentForward('getText', a); break;
      case 'getTables': result = await cmdContentForward('getTables', a); break;
      case 'consoleLogs': result = await cmdContentForward('consoleLogs', a); break;
      case 'fileUpload': result = await cmdContentForward('fileUpload', a); break;
      case 'clipboard': result = await cmdContentForward('clipboard', a); break;

      // === Navigation ===
      case 'navigate': result = await cmdNavigate(a); break;

      // === Screenshots ===
      case 'screenshot': result = await cmdScreenshot(a); break;
      case 'fullPageScreenshot': result = await cmdFullPageScreenshot(a); break;

      // === Debugger-based operations ===
      case 'pdf': result = await cmdPdf(a); break;
      case 'networkIntercept': result = await cmdNetworkIntercept(a); break;
      case 'networkGetLog': result = await cmdNetworkGetLog(a); break;

      // === Dialog handling ===
      case 'dialogHandle': result = await cmdDialogHandle(a); break;

      // === Cookies ===
      case 'getCookies': result = await cmdGetCookies(a); break;
      case 'setCookie': result = await cmdSetCookie(a); break;
      case 'deleteCookie': result = await cmdDeleteCookie(a); break;

      // === Tab Management ===
      case 'getTabs': result = await cmdGetTabs(); break;
      case 'openTab': result = await cmdOpenTab(a); break;
      case 'closeTab': result = await cmdCloseTab(a); break;
      case 'focusTab': result = await cmdFocusTab(a); break;
      case 'groupTabs': result = await cmdGroupTabs(a); break;
      case 'closeDuplicates': result = await cmdCloseDuplicates(); break;

      // === Multi-tab orchestration ===
      case 'multiTabRun': result = await cmdMultiTabRun(a); break;

      // === Page Watcher ===
      case 'watch': result = await cmdWatch(a); break;
      case 'unwatch': result = await cmdUnwatch(a); break;
      case 'listWatches': result = await cmdListWatches(); break;

      // === Auto-Auth ===
      case 'saveCredentials': result = await cmdSaveCredentials(a); break;
      case 'autoLogin': result = await cmdAutoLogin(a); break;
      case 'listCredentials': result = await cmdListCredentials(); break;
      case 'deleteCredentials': result = await cmdDeleteCredentials(a); break;

      default: throw new Error('Unknown command: ' + cmd);
    }
    send({ id, ok: true, data: result || {} });
  } catch (err) {
    send({ id, ok: false, error: err.message || String(err) });
  }
}

// ─── Content Script Forwarding ───

async function getActiveTabId(tabId) {
  if (tabId) return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab.id;
}

async function cmdContentForward(cmd, args) {
  const tabId = await getActiveTabId(args.tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { _aries: true, cmd, args }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) { reject(new Error('No response from content script')); return; }
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error));
    });
  });
}

// ─── Navigate ───

async function cmdNavigate(args) {
  if (args.newTab) {
    const tab = await chrome.tabs.create({ url: args.url, active: !args.background });
    return { tabId: tab.id, url: args.url };
  }
  const tabId = await getActiveTabId(args.tabId);
  await chrome.tabs.update(tabId, { url: args.url });
  // Optionally wait for load
  if (args.waitForLoad) {
    await waitForTabLoad(tabId, args.timeout || 30000);
  }
  return { tabId, url: args.url };
}

function waitForTabLoad(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timeout'));
    }, timeout);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ─── Screenshot ───

async function cmdScreenshot(args) {
  const format = args.format || 'png';
  const quality = args.quality || (format === 'jpeg' ? 80 : undefined);
  const opts = { format };
  if (quality) opts.quality = quality;
  const dataUrl = await chrome.tabs.captureVisibleTab(null, opts);
  return { image: dataUrl };
}

// ─── Full-Page Screenshot ───

async function cmdFullPageScreenshot(args) {
  const tabId = await getActiveTabId(args.tabId);
  await ensureDebugger(tabId);
  try {
    // Get page metrics
    const layoutMetrics = await sendDebuggerCommand(tabId, 'Page.getLayoutMetrics');
    const contentSize = layoutMetrics.cssContentSize || layoutMetrics.contentSize;
    const width = Math.ceil(contentSize.width);
    const height = Math.ceil(contentSize.height);

    // Override device metrics for full page
    await sendDebuggerCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
      mobile: false, width, height, deviceScaleFactor: 1
    });

    // Capture
    const result = await sendDebuggerCommand(tabId, 'Page.captureScreenshot', {
      format: args.format || 'png',
      quality: args.quality,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    });

    // Reset metrics
    await sendDebuggerCommand(tabId, 'Emulation.clearDeviceMetricsOverride');

    return { image: 'data:image/png;base64,' + result.data, width, height };
  } finally {
    if (!networkRecording.has(tabId)) {
      await detachDebugger(tabId);
    }
  }
}

// ─── PDF Generation (chrome.debugger) ───

async function cmdPdf(args) {
  const tabId = await getActiveTabId(args.tabId);
  await ensureDebugger(tabId);
  try {
    const params = {
      landscape: args.landscape || false,
      displayHeaderFooter: args.headerFooter || false,
      printBackground: args.printBackground !== false,
      scale: args.scale || 1,
      paperWidth: args.paperWidth || 8.5,
      paperHeight: args.paperHeight || 11,
      marginTop: args.marginTop || 0.4,
      marginBottom: args.marginBottom || 0.4,
      marginLeft: args.marginLeft || 0.4,
      marginRight: args.marginRight || 0.4,
    };
    const result = await sendDebuggerCommand(tabId, 'Page.printToPDF', params);
    return { pdf: result.data, size: result.data.length };
  } finally {
    if (!networkRecording.has(tabId)) {
      await detachDebugger(tabId);
    }
  }
}

// ─── Network Interception (chrome.debugger) ───

async function cmdNetworkIntercept(args) {
  const tabId = await getActiveTabId(args.tabId);
  const action = args.action || 'start';

  if (action === 'start') {
    await ensureDebugger(tabId);
    await sendDebuggerCommand(tabId, 'Network.enable');
    networkRecording.set(tabId, { requests: [], enabled: true, maxEntries: args.maxEntries || 500 });
    return { recording: true, tabId };
  }

  if (action === 'stop') {
    const record = networkRecording.get(tabId);
    if (record) {
      record.enabled = false;
      try { await sendDebuggerCommand(tabId, 'Network.disable'); } catch (e) {}
    }
    networkRecording.delete(tabId);
    await detachDebugger(tabId);
    return { recording: false, entries: record ? record.requests.length : 0 };
  }

  if (action === 'clear') {
    const record = networkRecording.get(tabId);
    if (record) record.requests = [];
    return { cleared: true };
  }

  throw new Error('Unknown network action: ' + action);
}

async function cmdNetworkGetLog(args) {
  const tabId = await getActiveTabId(args.tabId);
  const record = networkRecording.get(tabId);
  if (!record) return { requests: [], recording: false };
  const filter = args.filter || {};
  let reqs = record.requests;
  if (filter.urlPattern) {
    const re = new RegExp(filter.urlPattern, 'i');
    reqs = reqs.filter(r => re.test(r.url));
  }
  if (filter.method) {
    reqs = reqs.filter(r => r.method === filter.method.toUpperCase());
  }
  if (filter.statusCode) {
    reqs = reqs.filter(r => r.statusCode === filter.statusCode);
  }
  const limit = args.limit || 100;
  return { requests: reqs.slice(-limit), total: record.requests.length, recording: record.enabled };
}

// ─── Debugger Helpers ───

async function ensureDebugger(tabId) {
  if (debuggerAttached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttached.set(tabId, true);
}

async function detachDebugger(tabId) {
  if (!debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {}
  debuggerAttached.delete(tabId);
}

function sendDebuggerCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// Debugger event listener for network recording
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;

  if (method === 'Network.requestWillBeSent') {
    const record = networkRecording.get(tabId);
    if (record && record.enabled) {
      const entry = {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData,
        timestamp: params.timestamp,
        type: params.type
      };
      record.requests.push(entry);
      if (record.requests.length > record.maxEntries) {
        record.requests.shift();
      }
      sendEvent('networkRequest', { tabId, entry });
    }
  }

  if (method === 'Network.responseReceived') {
    const record = networkRecording.get(tabId);
    if (record && record.enabled) {
      const req = record.requests.find(r => r.requestId === params.requestId);
      if (req) {
        req.statusCode = params.response.status;
        req.statusText = params.response.statusText;
        req.responseHeaders = params.response.headers;
        req.mimeType = params.response.mimeType;
      }
    }
  }

  // Dialog events via debugger
  if (method === 'Page.javascriptDialogOpening') {
    const handler = dialogHandlers.get(tabId);
    sendEvent('dialog', { tabId, type: params.type, message: params.message, defaultPrompt: params.defaultPrompt });
    if (handler && handler.autoRespond) {
      const accept = handler.action !== 'dismiss';
      sendDebuggerCommand(tabId, 'Page.handleJavaScriptDialog', {
        accept,
        promptText: handler.promptText || ''
      }).catch(() => {});
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  debuggerAttached.delete(source.tabId);
  networkRecording.delete(source.tabId);
});

// ─── Dialog Handling ───

async function cmdDialogHandle(args) {
  const tabId = await getActiveTabId(args.tabId);
  if (args.action === 'configure') {
    await ensureDebugger(tabId);
    await sendDebuggerCommand(tabId, 'Page.enable');
    dialogHandlers.set(tabId, {
      autoRespond: args.autoRespond !== false,
      action: args.dialogAction || 'accept',
      promptText: args.promptText || ''
    });
    return { configured: true, tabId };
  }
  if (args.action === 'respond') {
    await ensureDebugger(tabId);
    await sendDebuggerCommand(tabId, 'Page.handleJavaScriptDialog', {
      accept: args.accept !== false,
      promptText: args.promptText || ''
    });
    return { responded: true };
  }
  if (args.action === 'disable') {
    dialogHandlers.delete(tabId);
    return { disabled: true };
  }
  throw new Error('Unknown dialog action: ' + args.action);
}

// ─── Cookie Management ───

async function cmdGetCookies(args) {
  const details = {};
  if (args.url) details.url = args.url;
  if (args.domain) details.domain = args.domain;
  if (args.name) details.name = args.name;
  const cookies = await chrome.cookies.getAll(details);
  return { cookies };
}

async function cmdSetCookie(args) {
  if (!args.url) throw new Error('Cookie requires url');
  const cookie = await chrome.cookies.set({
    url: args.url,
    name: args.name,
    value: args.value,
    domain: args.domain,
    path: args.path || '/',
    secure: args.secure,
    httpOnly: args.httpOnly,
    sameSite: args.sameSite,
    expirationDate: args.expirationDate
  });
  return { cookie };
}

async function cmdDeleteCookie(args) {
  if (!args.url || !args.name) throw new Error('Need url and name');
  await chrome.cookies.remove({ url: args.url, name: args.name });
  return { deleted: true, name: args.name };
}

// ─── Tab Management ───

async function cmdGetTabs() {
  const tabs = await chrome.tabs.query({});
  return { tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId, status: t.status, favIconUrl: t.favIconUrl })) };
}

async function cmdOpenTab(args) {
  const tab = await chrome.tabs.create({ url: args.url || 'about:blank', active: !args.background });
  return { tabId: tab.id };
}

async function cmdCloseTab(args) {
  if (args.tabId) {
    await chrome.tabs.remove(args.tabId);
    return { closed: [args.tabId] };
  }
  if (args.urlPattern) {
    const tabs = await chrome.tabs.query({ url: args.urlPattern });
    const ids = tabs.map(t => t.id);
    if (ids.length) await chrome.tabs.remove(ids);
    return { closed: ids };
  }
  throw new Error('Need tabId or urlPattern');
}

async function cmdFocusTab(args) {
  await chrome.tabs.update(args.tabId, { active: true });
  const tab = await chrome.tabs.get(args.tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  return { focused: args.tabId };
}

async function cmdGroupTabs(args) {
  let tabs;
  if (args.urlPattern) {
    tabs = await chrome.tabs.query({ url: args.urlPattern });
  } else if (args.domain) {
    tabs = await chrome.tabs.query({});
    tabs = tabs.filter(t => { try { return new URL(t.url).hostname.includes(args.domain); } catch { return false; } });
  } else {
    throw new Error('Need urlPattern or domain');
  }
  const ids = tabs.map(t => t.id);
  if (!ids.length) return { grouped: 0 };
  const groupId = await chrome.tabs.group({ tabIds: ids });
  if (args.title) await chrome.tabGroups.update(groupId, { title: args.title, color: args.color || 'cyan' });
  return { groupId, grouped: ids.length };
}

async function cmdCloseDuplicates() {
  const tabs = await chrome.tabs.query({});
  const seen = new Map();
  const toClose = [];
  for (const t of tabs) {
    if (seen.has(t.url)) toClose.push(t.id);
    else seen.set(t.url, t.id);
  }
  if (toClose.length) await chrome.tabs.remove(toClose);
  return { closed: toClose.length };
}

// ─── Multi-Tab Orchestration ───

async function cmdMultiTabRun(args) {
  const { commands } = args; // [{ tabId, cmd, args }]
  if (!Array.isArray(commands)) throw new Error('commands must be an array');
  const parallel = args.parallel !== false;

  if (parallel) {
    const results = await Promise.allSettled(
      commands.map(c => {
        const cmdArgs = { ...c.args, tabId: c.tabId };
        if (['navigate'].includes(c.cmd)) return cmdNavigate(cmdArgs);
        if (['screenshot'].includes(c.cmd)) return cmdScreenshot(cmdArgs);
        return cmdContentForward(c.cmd, cmdArgs);
      })
    );
    return {
      results: results.map((r, i) => ({
        tabId: commands[i].tabId,
        cmd: commands[i].cmd,
        ok: r.status === 'fulfilled',
        data: r.status === 'fulfilled' ? r.value : undefined,
        error: r.status === 'rejected' ? r.reason.message : undefined
      }))
    };
  }

  // Sequential
  const results = [];
  for (const c of commands) {
    try {
      const cmdArgs = { ...c.args, tabId: c.tabId };
      let result;
      if (c.cmd === 'navigate') result = await cmdNavigate(cmdArgs);
      else if (c.cmd === 'screenshot') result = await cmdScreenshot(cmdArgs);
      else result = await cmdContentForward(c.cmd, cmdArgs);
      results.push({ tabId: c.tabId, cmd: c.cmd, ok: true, data: result });
    } catch (e) {
      results.push({ tabId: c.tabId, cmd: c.cmd, ok: false, error: e.message });
      if (args.stopOnError) break;
    }
  }
  return { results };
}

// ─── Page Watcher ───

let watches = new Map();

async function restoreWatches() {
  const data = await chrome.storage.local.get('watches');
  const saved = data.watches || {};
  for (const [url, cfg] of Object.entries(saved)) {
    startWatch(url, cfg.interval || 60000, cfg.ignoreSelectors || []);
  }
}

async function persistWatches() {
  const obj = {};
  for (const [url, w] of watches) {
    obj[url] = { interval: w.interval, ignoreSelectors: w.ignoreSelectors };
  }
  await chrome.storage.local.set({ watches: obj });
}

function startWatch(url, interval, ignoreSelectors) {
  if (watches.has(url)) clearInterval(watches.get(url).timer);
  const w = { interval, ignoreSelectors, lastHash: null, timer: null };
  w.timer = setInterval(() => pollWatch(url, w), interval);
  watches.set(url, w);
  pollWatch(url, w);
}

async function pollWatch(url, w) {
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    const text = await resp.text();
    const hash = await hashText(text);
    if (w.lastHash && w.lastHash !== hash) {
      sendEvent('watchAlert', { url, changed: true });
    }
    w.lastHash = hash;
  } catch (e) {}
}

async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function cmdWatch(args) {
  startWatch(args.url, args.interval || 60000, args.ignoreSelectors || []);
  await persistWatches();
  return { watching: args.url };
}

async function cmdUnwatch(args) {
  const w = watches.get(args.url);
  if (w) { clearInterval(w.timer); watches.delete(args.url); }
  await persistWatches();
  return { unwatched: args.url };
}

async function cmdListWatches() {
  const list = [];
  for (const [url, w] of watches) {
    list.push({ url, interval: w.interval });
  }
  return { watches: list };
}

// ─── Auto-Auth (Credentials) ───

async function cmdSaveCredentials(args) {
  const { domain, username, password, loginUrl, usernameSelector, passwordSelector, submitSelector } = args;
  if (!domain || !username || !password) throw new Error('Need domain, username, password');
  const encrypted = await ArisCrypto.encrypt(JSON.stringify({ username, password, loginUrl, usernameSelector, passwordSelector, submitSelector }));
  const data = await chrome.storage.local.get('credentials');
  const creds = data.credentials || {};
  creds[domain] = encrypted;
  await chrome.storage.local.set({ credentials: creds });
  return { saved: domain };
}

async function cmdAutoLogin(args) {
  const { domain } = args;
  const data = await chrome.storage.local.get('credentials');
  const creds = data.credentials || {};
  if (!creds[domain]) throw new Error('No credentials for: ' + domain);
  const decrypted = JSON.parse(await ArisCrypto.decrypt(creds[domain]));
  const url = decrypted.loginUrl || `https://${domain}/login`;
  const tabId = await getActiveTabId(args.tabId);
  await chrome.tabs.update(tabId, { url });
  await new Promise(r => setTimeout(r, 3000));
  const uSel = decrypted.usernameSelector || 'input[type="email"], input[type="text"], input[name="username"], input[name="email"]';
  const pSel = decrypted.passwordSelector || 'input[type="password"]';
  const sSel = decrypted.submitSelector || 'button[type="submit"], input[type="submit"]';
  await cmdContentForward('fill', { tabId, fields: { [uSel]: decrypted.username, [pSel]: decrypted.password } });
  try {
    await cmdContentForward('click', { tabId, selector: sSel });
  } catch (e) {}
  return { loggedIn: domain };
}

async function cmdListCredentials() {
  const data = await chrome.storage.local.get('credentials');
  const creds = data.credentials || {};
  return { domains: Object.keys(creds) };
}

async function cmdDeleteCredentials(args) {
  const data = await chrome.storage.local.get('credentials');
  const creds = data.credentials || {};
  delete creds[args.domain];
  await chrome.storage.local.set({ credentials: creds });
  return { deleted: args.domain };
}

// ─── Tab Events ───

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    sendEvent('tabUpdated', { tabId, url: tab.url, title: tab.title });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sendEvent('tabRemoved', { tabId });
  debuggerAttached.delete(tabId);
  networkRecording.delete(tabId);
  dialogHandlers.delete(tabId);
});

// ─── Self-Update Check ───

async function checkForUpdate() {
  try {
    const resp = await fetch(UPDATE_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.version && data.version !== VERSION) {
      sendEvent('updateAvailable', { currentVersion: VERSION, serverVersion: data.version });
    }
  } catch (e) {}
}

// ─── Startup ───

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ARIES] Extension v2.0 installed');
  connect();
});

connect();

setInterval(checkForUpdate, UPDATE_INTERVAL);
setTimeout(checkForUpdate, 10000);

chrome.alarms.create('aries-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'aries-keepalive') {
    if (!wsConnected) connect();
  }
});

// ─── Message from popup ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg._ariesPopup) {
    if (msg.cmd === 'getStatus') {
      sendResponse({ connected: wsConnected, version: VERSION, capabilities: getCapabilities() });
      return false;
    }
    if (msg.cmd === 'reconnect') {
      connect();
      sendResponse({ reconnecting: true });
      return false;
    }
  }
  return false;
});

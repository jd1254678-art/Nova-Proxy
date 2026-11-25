import http from "node:http";
import express from "express";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";

const app = express();
const server = http.createServer(app);

// 1. Mount pre-built Ultraviolet, Bare-Mux, and Epoxy bundles from node_modules
app.use("/uv/", express.static(uvPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));

// 2. Serve /uv/uv.config.js dynamically
app.get("/uv/uv.config.js", (_req, res) => {
  res.type("application/javascript").send(`
    self.__uv$config = {
      prefix: "/service/",
      encodeUrl: Ultraviolet.codec.xor.encode,
      decodeUrl: Ultraviolet.codec.xor.decode,
      handler: "/uv/uv.handler.js",
      client: "/uv/uv.client.js",
      bundle: "/uv/uv.bundle.js",
      config: "/uv/uv.config.js",
      sw: "/uv/uv.sw.js"
    };
  `);
});

// 3. Serve /sw.js Service Worker dynamically
app.get("/sw.js", (_req, res) => {
  res.type("application/javascript").send(`
    importScripts("/uv/uv.bundle.js");
    importScripts("/uv/uv.config.js");
    importScripts(__uv$config.sw || "/uv/uv.sw.js");

    const uv = new UVServiceWorker();

    self.addEventListener("fetch", (event) => {
      if (uv.route(event)) {
        event.respondWith(uv.fetch(event));
      }
    });
  `);
});

// 4. Serve the complete browser shell at /
app.get("/", (_req, res) => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nova Shell</title>
  <link id="dynamic-favicon" rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>" />
  <style>
    :root {
      --bg-bar: #010409;
      --bg-nav: #161b22;
      --bg-card: #161b22;
      --bg-input: #0d1117;
      --border: #30363d;
      --accent: #58a6ff;
      --text: #e6edf3;
      --muted: #8b949e;
    }
    [data-theme="nebula"] {
      --bg-bar: #0b0716;
      --bg-nav: #150e28;
      --bg-card: #1a1230;
      --bg-input: #0e091b;
      --border: #2e2152;
      --accent: #a855f7;
    }
    [data-theme="cosmic"] {
      --bg-bar: #041014;
      --bg-nav: #0a1f26;
      --bg-card: #0e2933;
      --bg-input: #06151a;
      --border: #194554;
      --accent: #22d3ee;
    }
    [data-theme="sunset"] {
      --bg-bar: #14080a;
      --bg-nav: #241014;
      --bg-card: #2c1419;
      --bg-input: #170a0d;
      --border: #4d222b;
      --accent: #fb7185;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg-input); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* Tab Strip */
    .tab-bar { display: flex; align-items: center; gap: 6px; background: var(--bg-bar); padding: 6px 10px 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
    .tab { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: var(--bg-nav); border: 1px solid var(--border); border-bottom: none; border-radius: 8px 8px 0 0; font-size: 13px; cursor: pointer; max-width: 190px; flex-shrink: 0; }
    .tab.active { background: var(--bg-card); border-color: var(--accent); color: #fff; }
    .tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab button { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 14px; }
    .tab button:hover { color: #f85149; }
    .new-tab { background: var(--bg-nav); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 4px 10px; cursor: pointer; margin-bottom: 4px; }

    /* Omnibox Bar */
    .nav-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-nav); border-bottom: 1px solid var(--border); position: relative; }
    .nav-btn { background: var(--bg-input); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .nav-btn:hover { border-color: var(--accent); }
    #url-form { flex: 1; display: flex; }
    #url-input { width: 100%; background: var(--bg-input); border: 1px solid var(--border); color: var(--text); padding: 7px 12px; border-radius: 6px; font-size: 14px; outline: none; }
    #url-input:focus { border-color: var(--accent); }
    .status { font-size: 12px; color: #3fb950; padding: 0 6px; white-space: nowrap; }

    /* Viewport */
    .viewport { flex: 1; position: relative; background: var(--bg-input); }
    .viewport iframe { width: 100%; height: 100%; border: none; display: none; }
    .viewport iframe.active { display: block; }

    /* Settings Popover */
    .settings-panel {
      position: absolute; top: 48px; right: 12px; width: 340px; max-height: 82vh; overflow-y: auto;
      background: var(--bg-nav); border: 1px solid var(--border); border-radius: 10px; padding: 14px; z-index: 999;
      box-shadow: 0 12px 32px rgba(0,0,0,0.65); display: none; flex-direction: column; gap: 11px;
    }
    .settings-panel.open { display: flex; }
    .settings-panel h3 { font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    .setting-row { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
    .setting-row-inline { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text); }
    .setting-row select, .setting-row input {
      background: var(--bg-input); border: 1px solid var(--border); color: var(--text);
      padding: 6px 8px; border-radius: 6px; font-size: 12px; outline: none;
    }
    .btn-row { display: flex; gap: 6px; }
    .btn-row button { flex: 1; }
  </style>
  <script src="/baremux/index.js"></script>
  <script src="/uv/uv.bundle.js"></script>
  <script src="/uv/uv.config.js"></script>
</head>
<body>
  <div class="tab-bar" id="tab-bar">
    <button class="new-tab" id="new-tab-btn" title="New Tab">+</button>
  </div>

  <div class="nav-bar">
    <button class="nav-btn" id="home-btn" title="New Tab Home">&#8962;</button>
    <button class="nav-btn" id="back-btn" title="Back">&#8592;</button>
    <button class="nav-btn" id="fwd-btn" title="Forward">&#8594;</button>
    <button class="nav-btn" id="reload-btn" title="Reload">&#8635;</button>
    <form id="url-form">
      <input id="url-input" type="text" placeholder="Search or enter URL..." autocomplete="off" />
    </form>
    <span class="status" id="status-badge">Initializing...</span>
    <button class="nav-btn" id="panic-now-btn" title="Panic Redirect">Panic</button>
    <button class="nav-btn" id="settings-toggle-btn" title="Settings">Settings</button>

    <div class="settings-panel" id="settings-panel">
      <h3>Shell &amp; Network Settings</h3>

      <div class="setting-row">
        <label for="theme-select">Interface Theme</label>
        <select id="theme-select">
          <option value="midnight">Midnight (Default)</option>
          <option value="nebula">Nebula Purple</option>
          <option value="cosmic">Cosmic Cyan</option>
          <option value="sunset">Sunset Rose</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="search-select">Default Search Engine</label>
        <select id="search-select">
          <option value="https://duckduckgo.com/?q=">DuckDuckGo</option>
          <option value="https://search.brave.com/search?q=">Brave Search</option>
          <option value="https://www.google.com/search?q=">Google</option>
          <option value="https://www.bing.com/search?q=">Bing</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="wisp-input">Wisp Server Endpoint (wss://)</label>
        <input id="wisp-input" type="text" placeholder="Auto (same host /wisp/)" />
      </div>

      <div class="setting-row-inline">
        <span>Anti-Tab Close Prompt</span>
        <input type="checkbox" id="anti-close-toggle" checked />
      </div>

      <div class="setting-row-inline">
        <span>Auto-Cloak on Tab Switch</span>
        <input type="checkbox" id="auto-cloak-toggle" />
      </div>

      <div class="setting-row">
        <label for="cloak-preset">Tab Title &amp; Icon Cloak</label>
        <select id="cloak-preset">
          <option value="default">Default (Nova Shell)</option>
          <option value="drive">Google Drive</option>
          <option value="docs">Google Docs</option>
          <option value="classroom">Google Classroom</option>
          <option value="canvas">Canvas Dashboard</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="panic-key-input">Panic Key</label>
        <input id="panic-key-input" type="text" maxlength="1" value="\`" />
      </div>

      <div class="setting-row">
        <label for="panic-url-input">Panic Redirect URL</label>
        <input id="panic-url-input" type="text" value="https://classroom.google.com" />
      </div>

      <div class="btn-row">
        <button class="nav-btn" id="save-settings-btn" type="button">Save &amp; Apply</button>
        <button class="nav-btn" id="cloak-blank-btn" type="button">about:blank</button>
        <button class="nav-btn" id="cloak-blob-btn" type="button">blob: Shell</button>
      </div>
    </div>
  </div>

  <div class="viewport" id="viewport"></div>

  <script>
    const statusBadge = document.getElementById("status-badge");
    const tabBar = document.getElementById("tab-bar");
    const newTabBtn = document.getElementById("new-tab-btn");
    const viewport = document.getElementById("viewport");
    const urlForm = document.getElementById("url-form");
    const urlInput = document.getElementById("url-input");
    const faviconEl = document.getElementById("dynamic-favicon");
    const settingsPanel = document.getElementById("settings-panel");

    // Persistent Preferences
    const DEFAULTS = {
      theme: "midnight",
      searchEngine: "https://duckduckgo.com/?q=",
      wispUrl: "",
      antiClose: true,
      autoCloak: false,
      cloakPreset: "default",
      panicKey: "\`",
      panicUrl: "https://classroom.google.com"
    };

    let prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("nova_prefs") || "{}") };
    let tabs = [];
    let activeTabId = null;
    let tabCounter = 0;
    let bareConnection = null;

    const CLOAK_PRESETS = {
      default: {
        title: "Nova Shell",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌐</text></svg>"
      },
      drive: {
        title: "My Drive - Google Drive",
        icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png"
      },
      docs: {
        title: "Google Docs",
        icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico"
      },
      classroom: {
        title: "Home - Classroom",
        icon: "https://ssl.gstatic.com/classroom/favicon.png"
      },
      canvas: {
        title: "Dashboard",
        icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico"
      }
    };

    const SHORTCUTS = [
      { name: "DuckDuckGo", url: "https://duckduckgo.com", desc: "Private Search" },
      { name: "Wikipedia", url: "https://www.wikipedia.org", desc: "Encyclopedia" },
      { name: "GitHub", url: "https://github.com", desc: "Code & Repos" },
      { name: "Archive.org", url: "https://archive.org", desc: "Digital Library" },
      { name: "JSFiddle", url: "https://jsfiddle.net", desc: "Code Sandbox" },
      { name: "Example.com", url: "https://example.com", desc: "Connection Test" }
    ];

    function buildHomeSrcdoc() {
      const cards = SHORTCUTS.map(
        (s) => \`<div class="card" onclick="parent.postMessage({type:'NAV',url:'\${s.url}'},'*')">
          <div class="card-title">\${s.name}</div>
          <div class="card-desc">\${s.desc}</div>
        </div>\`
      ).join("");

      return \`<!DOCTYPE html>
      <html><head><style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        body {
          background: radial-gradient(circle at top, #182232 0%, #0d1117 70%);
          color: #e6edf3; height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center; padding: 24px;
        }
        h1 { font-size: 32px; letter-spacing: -0.5px; margin-bottom: 6px; }
        p { color: #8b949e; font-size: 14px; margin-bottom: 22px; }
        form { width: 100%; max-width: 540px; display: flex; gap: 8px; margin-bottom: 32px; }
        input {
          flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid #30363d;
          background: #161b22; color: #fff; font-size: 15px; outline: none;
        }
        input:focus { border-color: #58a6ff; }
        button {
          padding: 0 18px; border-radius: 10px; border: none; background: #58a6ff;
          color: #0d1117; font-weight: 600; cursor: pointer;
        }
        .grid { display: grid; grid-template-columns: repeat(3, minmax(130px, 165px)); gap: 12px; }
        .card {
          background: rgba(22, 27, 34, 0.85); border: 1px solid #30363d; border-radius: 10px;
          padding: 14px; cursor: pointer; transition: transform 0.15s, border-color 0.15s;
        }
        .card:hover { transform: translateY(-2px); border-color: #58a6ff; }
        .card-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
        .card-desc { font-size: 12px; color: #8b949e; }
      </style></head>
      <body>
        <h1>Nova Proxy Shell</h1>
        <p>Ultraviolet Rewriter + Bare-Mux Wisp Transport</p>
        <form onsubmit="event.preventDefault(); parent.postMessage({type:'NAV',url:document.getElementById('q').value},'*')">
          <input id="q" placeholder="Search the web or enter a URL..." autofocus />
          <button type="submit">Go</button>
        </form>
        <div class="grid">\${cards}</div>
      </body></html>\`;
    }

    function applyPreferences() {
      document.documentElement.setAttribute("data-theme", prefs.theme);
      document.getElementById("theme-select").value = prefs.theme;
      document.getElementById("search-select").value = prefs.searchEngine;
      document.getElementById("wisp-input").value = prefs.wispUrl;
      document.getElementById("anti-close-toggle").checked = prefs.antiClose;
      document.getElementById("auto-cloak-toggle").checked = prefs.autoCloak;
      document.getElementById("cloak-preset").value = prefs.cloakPreset;
      document.getElementById("panic-key-input").value = prefs.panicKey;
      document.getElementById("panic-url-input").value = prefs.panicUrl;

      const cloak = CLOAK_PRESETS[prefs.cloakPreset] || CLOAK_PRESETS.default;
      document.title = cloak.title;
      faviconEl.href = cloak.icon;
    }

    function getActiveWispUrl() {
      if (prefs.wispUrl.trim()) return prefs.wispUrl.trim();
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      return proto + "//" + location.host + "/wisp/";
    }

    async function initProxy() {
      if (!("serviceWorker" in navigator)) {
        statusBadge.textContent = "SW Unsupported";
        statusBadge.style.color = "#f85149";
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: __uv$config.prefix });
      bareConnection = new BareMux.BareMuxConnection("/baremux/worker.js");
      await bareConnection.setTransport("/epoxy/index.mjs", [{ wisp: getActiveWispUrl() }]);
      statusBadge.textContent = "Wisp Ready";
    }

    // Listen for navigation messages from the New-Tab Home Dashboard
    window.addEventListener("message", (e) => {
      if (e.data?.type === "NAV" && activeTabId) {
        navigateTab(activeTabId, e.data.url);
      }
    });

    // Anti-tab close guard
    window.addEventListener("beforeunload", (e) => {
      if (!prefs.antiClose) return;
      e.preventDefault();
      e.returnValue = "";
    });

    // Auto-cloak on tab hide
    document.addEventListener("visibilitychange", () => {
      if (!prefs.autoCloak) return;
      const cloak = document.hidden
        ? CLOAK_PRESETS.docs
        : (CLOAK_PRESETS[prefs.cloakPreset] || CLOAK_PRESETS.default);
      document.title = cloak.title;
      faviconEl.href = cloak.icon;
    });

    // Panic key handler
    function triggerPanic() {
      prefs.antiClose = false;
      window.location.replace(prefs.panicUrl || "https://classroom.google.com");
    }

    function handleKeydown(e) {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.key === (prefs.panicKey || "\`")) {
        e.preventDefault();
        triggerPanic();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    document.getElementById("panic-now-btn").addEventListener("click", triggerPanic);

    // Settings controls
    document.getElementById("settings-toggle-btn").addEventListener("click", () => {
      settingsPanel.classList.toggle("open");
    });

    document.getElementById("save-settings-btn").addEventListener("click", async () => {
      prefs = {
        theme: document.getElementById("theme-select").value,
        searchEngine: document.getElementById("search-select").value,
        wispUrl: document.getElementById("wisp-input").value.trim(),
        antiClose: document.getElementById("anti-close-toggle").checked,
        autoCloak: document.getElementById("auto-cloak-toggle").checked,
        cloakPreset: document.getElementById("cloak-preset").value,
        panicKey: document.getElementById("panic-key-input").value || "\`",
        panicUrl: document.getElementById("panic-url-input").value.trim() || "https://classroom.google.com"
      };
      localStorage.setItem("nova_prefs", JSON.stringify(prefs));
      applyPreferences();

      if (bareConnection) {
        statusBadge.textContent = "Updating Wisp...";
        await bareConnection.setTransport("/epoxy/index.mjs", [{ wisp: getActiveWispUrl() }]);
        statusBadge.textContent = "Wisp Ready";
      }
      settingsPanel.classList.remove("open");
    });

    // about:blank and blob: launchers
    function launchWrappedWindow(useBlob) {
      const targetUrl = location.href;
      const cloak = CLOAK_PRESETS[prefs.cloakPreset] || CLOAK_PRESETS.drive;

      if (useBlob) {
        const html = \`<!DOCTYPE html><html><head><title>\${cloak.title}</title><link rel="icon" href="\${cloak.icon}"></head><body style="margin:0;overflow:hidden;background:#0d1117;"><iframe src="\${targetUrl}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>\`;
        const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const win = window.open(blobUrl, "_blank");
        if (!win) return alert("Allow pop-ups to open in a blob: tab.");
      } else {
        const win = window.open("about:blank", "_blank");
        if (!win) return alert("Allow pop-ups to open in an about:blank tab.");
        win.document.title = cloak.title;
        const icon = win.document.createElement("link");
        icon.rel = "icon";
        icon.href = cloak.icon;
        win.document.head.appendChild(icon);
        const iframe = win.document.createElement("iframe");
        Object.assign(iframe.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", border: "none" });
        iframe.src = targetUrl;
        win.document.body.style.margin = "0";
        win.document.body.appendChild(iframe);
      }
      triggerPanic();
    }

    document.getElementById("cloak-blank-btn").addEventListener("click", () => launchWrappedWindow(false));
    document.getElementById("cloak-blob-btn").addEventListener("click", () => launchWrappedWindow(true));

    // URL formatting & Tab Management
    function formatInput(raw) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === "nova://home") return "nova://home";
      if (/^https?:\\/\\//i.test(trimmed)) return trimmed;
      if (trimmed.includes(".") && !trimmed.includes(" ")) return "https://" + trimmed;
      return prefs.searchEngine + encodeURIComponent(trimmed);
    }

    function createTab(initialUrl = "nova://home") {
      const id = ++tabCounter;

      const tabEl = document.createElement("div");
      tabEl.className = "tab";
      tabEl.innerHTML = '<span class="tab-title">New Tab</span><button title="Close">&times;</button>';
      tabEl.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") closeTab(id);
        else switchTab(id);
      });
      tabBar.insertBefore(tabEl, newTabBtn);

      const iframe = document.createElement("iframe");
      iframe.addEventListener("load", () => {
        try {
          iframe.contentWindow.addEventListener("keydown", handleKeydown);
          const tab = tabs.find((t) => t.id === id);
          if (!tab || tab.url === "nova://home") return;

          const title = iframe.contentDocument?.title;
          if (title) tabEl.querySelector(".tab-title").textContent = title;
          const proxiedPath = iframe.contentWindow.location.pathname;
          if (proxiedPath.startsWith(__uv$config.prefix)) {
            const decoded = __uv$config.decodeUrl(proxiedPath.slice(__uv$config.prefix.length));
            tab.url = decoded;
            if (activeTabId === id) urlInput.value = decoded;
          }
        } catch {}
      });

      viewport.appendChild(iframe);
      tabs.push({ id, tabEl, iframe, url: initialUrl });
      switchTab(id);
      navigateTab(id, initialUrl);
    }

    function switchTab(id) {
      activeTabId = id;
      tabs.forEach((t) => {
        const active = t.id === id;
        t.tabEl.classList.toggle("active", active);
        t.iframe.classList.toggle("active", active);
        if (active) urlInput.value = t.url === "nova://home" ? "" : t.url;
      });
    }

    function closeTab(id) {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      tabs[idx].tabEl.remove();
      tabs[idx].iframe.remove();
      tabs.splice(idx, 1);

      if (tabs.length === 0) createTab("nova://home");
      else if (activeTabId === id) switchTab(tabs[Math.max(0, idx - 1)].id);
    }

    function navigateTab(id, rawInput) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;

      const targetUrl = formatInput(rawInput);
      tab.url = targetUrl;

      if (targetUrl === "nova://home") {
        tab.tabEl.querySelector(".tab-title").textContent = "New Tab";
        if (activeTabId === id) urlInput.value = "";
        tab.iframe.removeAttribute("src");
        tab.iframe.srcdoc = buildHomeSrcdoc();
        return;
      }

      tab.iframe.removeAttribute("srcdoc");
      tab.tabEl.querySelector(".tab-title").textContent = new URL(targetUrl).hostname;
      if (activeTabId === id) urlInput.value = targetUrl;
      tab.iframe.src = __uv$config.prefix + __uv$config.encodeUrl(targetUrl);
    }

    urlForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (activeTabId) navigateTab(activeTabId, urlInput.value);
    });

    newTabBtn.addEventListener("click", () => createTab("nova://home"));
    document.getElementById("home-btn").addEventListener("click", () => {
      if (activeTabId) navigateTab(activeTabId, "nova://home");
    });
    document.getElementById("back-btn").addEventListener("click", () => {
      tabs.find((t) => t.id === activeTabId)?.iframe.contentWindow?.history.back();
    });
    document.getElementById("fwd-btn").addEventListener("click", () => {
      tabs.find((t) => t.id === activeTabId)?.iframe.contentWindow?.history.forward();
    });
    document.getElementById("reload-btn").addEventListener("click", () => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      if (tab.url === "nova://home") navigateTab(tab.id, "nova://home");
      else tab.iframe.contentWindow?.location.reload();
    });

    applyPreferences();
    initProxy().then(() => createTab("nova://home"));
  </script>
</body>
</html>`);
});

// 5. Route /wisp/ WebSocket upgrades to the Wisp server
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(\`Nova Shell running at http://localhost:\${PORT}\`);
});
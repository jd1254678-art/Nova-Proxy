import { createServer } from "node:http";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import wisp from "wisp-server-node";

const app = express();
const PORT = process.env.PORT || 7860;

// Serve static assets for Ultraviolet, EpoxyTransport, and Bare-Mux
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));

// Serve custom UV configuration dynamically
app.get("/uv/uv.config.js", (_req, res) => {
  res.type("application/javascript").send([
    "self.__uv$config = {",
    '  prefix: "/uv/service/",',
    '  encodeUrl: Ultraviolet.codec.xor.encode,',
    '  decodeUrl: Ultraviolet.codec.xor.decode,',
    '  handler: "/uv/uv.handler.js",',
    '  client: "/uv/uv.client.js",',
    '  bundle: "/uv/uv.bundle.js",',
    '  config: "/uv/uv.config.js",',
    '  sw: "/uv/sw.js",',
    "};"
  ].join("\n"));
});

// Serve the Nova Shell UI (uses standard quotes inside HTML to avoid backtick conflicts)
const HTML_SHELL = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
  '  <title>Nova Shell</title>',
  '  <script src="/baremux/index.js"></script>',
  '  <script src="/uv/uv.bundle.js"></script>',
  '  <script src="/uv/uv.config.js"></script>',
  '  <style>',
  '    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }',
  '    body { background: #0f172a; color: #f8fafc; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }',
  '    header { background: #1e293b; padding: 10px 16px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #334155; }',
  '    .brand { font-weight: 700; font-size: 15px; color: #38bdf8; letter-spacing: 0.5px; }',
  '    .nav-btn { background: #334155; color: #e2e8f0; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }',
  '    .nav-btn:hover { background: #475569; }',
  '    #url-form { flex: 1; display: flex; }',
  '    #url-input { width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 6px; padding: 7px 12px; font-size: 14px; outline: none; }',
  '    #url-input:focus { border-color: #38bdf8; }',
  '    .badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: #eab308; color: #0f172a; white-space: nowrap; }',
  '    .badge.ready { background: #22c55e; color: #052e16; }',
  '    .badge.error { background: #ef4444; color: #ffffff; }',
  '    main { flex: 1; position: relative; background: #090d16; }',
  '    iframe { width: 100%; height: 100%; border: none; display: none; background: #ffffff; }',
  '    #welcome { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 20px; }',
  '    #welcome h1 { font-size: 28px; color: #f8fafc; }',
  '    #welcome p { color: #94a3b8; font-size: 14px; max-width: 440px; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <header>',
  '    <span class="brand">NOVA SHELL</span>',
  '    <button class="nav-btn" id="back-btn" title="Back">&#8592;</button>',
  '    <button class="nav-btn" id="fwd-btn" title="Forward">&#8594;</button>',
  '    <button class="nav-btn" id="reload-btn" title="Reload">&#8635;</button>',
  '    <form id="url-form">',
  '      <input id="url-input" type="text" placeholder="Enter URL or search query (e.g. example.com)..." autocomplete="off" />',
  '    </form>',
  '    <span id="status-badge" class="badge">Initializing...</span>',
  '  </header>',
  '  <main>',
  '    <div id="welcome">',
  '      <h1>Nova Web Shell</h1>',
  '      <p>Type any URL or search term in the bar above once the status badge turns green.</p>',
  '    </div>',
  '    <iframe id="proxy-frame"></iframe>',
  '  </main>',
  '  <script>',
  '    const statusBadge = document.getElementById("status-badge");',
  '    const form = document.getElementById("url-form");',
  '    const input = document.getElementById("url-input");',
  '    const frame = document.getElementById("proxy-frame");',
  '    const welcome = document.getElementById("welcome");',
  '    const connection = new BareMux.BareMuxConnection("/baremux/worker.js");',
  '',
  '    async function initProxy() {',
  '      try {',
  '        if ("serviceWorker" in navigator) {',
  '          await navigator.serviceWorker.register("/uv/sw.js", { scope: "/uv/service/" });',
  '        }',
  '        const wispProtocol = location.protocol === "https:" ? "wss://" : "ws://";',
  '        const wispUrl = wispProtocol + location.host + "/wisp/";',
  '        await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);',
  '        statusBadge.textContent = "Wisp Ready";',
  '        statusBadge.className = "badge ready";',
  '      } catch (err) {',
  '        console.error("Proxy init error:", err);',
  '        statusBadge.textContent = "Init Error";',
  '        statusBadge.className = "badge error";',
  '      }',
  '    }',
  '',
  '    function resolveInput(raw) {',
  '      const trimmed = raw.trim();',
  '      if (/^https?:\\/\\//i.test(trimmed)) return trimmed;',
  '      if (trimmed.includes(".") && !trimmed.includes(" ")) return "https://" + trimmed;',
  '      return "https://duckduckgo.com/?q=" + encodeURIComponent(trimmed);',
  '    }',
  '',
  '    form.addEventListener("submit", async (e) => {',
  '      e.preventDefault();',
  '      if (!input.value.trim()) return;',
  '      const target = resolveInput(input.value);',
  '      const wispProtocol = location.protocol === "https:" ? "wss://" : "ws://";',
  '      const wispUrl = wispProtocol + location.host + "/wisp/";',
  '      if (!(await connection.getTransport())) {',
  '        await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);',
  '      }',
  '      welcome.style.display = "none";',
  '      frame.style.display = "block";',
  '      frame.src = __uv$config.prefix + __uv$config.encodeUrl(target);',
  '    });',
  '',
  '    document.getElementById("back-btn").addEventListener("click", () => {',
  '      try { frame.contentWindow.history.back(); } catch {}',
  '    });',
  '    document.getElementById("fwd-btn").addEventListener("click", () => {',
  '      try { frame.contentWindow.history.forward(); } catch {}',
  '    });',
  '    document.getElementById("reload-btn").addEventListener("click", () => {',
  '      try { frame.contentWindow.location.reload(); } catch {}',
  '    });',
  '',
  '    initProxy();',
  '  </script>',
  '</body>',
  '</html>'
].join("\n");

app.get("/", (_req, res) => {
  res.type("text/html").send(HTML_SHELL);
});

const server = createServer(app);

// Route WebSocket upgrades for Wisp
server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Nova Shell running at http://localhost:${PORT}`);
});

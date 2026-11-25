import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { WebSocketServer } from "ws";

const epoxyPath = fileURLToPath(
  new URL("./node_modules/@mercuryworkshop/epoxy-transport/dist", import.meta.url)
);

// Connect to sites over IPv4 when they have both. Many home networks hand out
// IPv6 addresses that don't actually work, which makes every page fail.
wisp.options.dns_result_order = "ipv4first";

const app = express();
const PORT = Number(process.env.PORT) || 8080;

// ==================== PASSWORD LOGIN ====================
// Where the password comes from, in order:
//   1. the PROXY_PASSWORD environment variable (what hosts like Fly.io use)
//   2. nova-config.json next to this file (made for you on first run)
//   3. if neither exists and you started it in a terminal, it asks you once
//      and saves your answer to nova-config.json
// Never put the password in this file. A correct password gets a login token
// the browser keeps, so people only type it once. Tokens are signed with the
// password itself, so changing the password logs everyone out.
const CONFIG_FILE = fileURLToPath(new URL("./nova-config.json", import.meta.url));
const wantsNewPassword = process.argv.includes("--set-password");

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}

async function askForPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nSet the password people will need to use Nova.");
    while (true) {
      const first = (await rl.question("New password: ")).trim();
      if (first.length < 4) { console.log("Use at least 4 characters.\n"); continue; }
      const again = (await rl.question("Type it again: ")).trim();
      if (first === again) return first;
      console.log("Those didn't match. Try again.\n");
    }
  } finally {
    rl.close();
  }
}

let PROXY_PASSWORD = wantsNewPassword ? "" : (process.env.PROXY_PASSWORD || readConfig().password || "");
if (!PROXY_PASSWORD && process.stdin.isTTY) {
  PROXY_PASSWORD = await askForPassword();
  writeFileSync(CONFIG_FILE, JSON.stringify({ password: PROXY_PASSWORD }, null, 2) + "\n");
  console.log("Saved to nova-config.json. To change it later, run: npm run set-password\n");
}
if (wantsNewPassword) {
  if (!PROXY_PASSWORD) {
    console.error("Run this in a terminal window so it can ask you for the new password.");
    process.exit(1);
  }
  console.log("Password updated. Everyone who was logged in will need the new one.");
  if (process.env.PROXY_PASSWORD) console.log("Note: PROXY_PASSWORD is set in your environment, and it wins over nova-config.json.");
  process.exit(0);
}
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS) || 180;
if (!PROXY_PASSWORD) {
  console.warn("No password set (PROXY_PASSWORD or nova-config.json): nobody can log in and the proxy is locked.");
}

function sign(data) {
  return createHmac("sha256", "nova-login:" + PROXY_PASSWORD).update(data).digest("base64url");
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function makeToken() {
  const expires = String(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return expires + "." + sign(expires);
}

function tokenIsValid(token) {
  if (!PROXY_PASSWORD || typeof token !== "string") return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  return sameText(sig, sign(expires));
}

// Slow down password guessing: 10 wrong tries per IP every 15 minutes.
const failedTries = new Map(); // ip -> { count, since }
function clientIp(req) {
  const fwd = req.headers["fly-client-ip"] || req.headers["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim() || req.socket.remoteAddress || "?";
}
function tooManyTries(ip) {
  const entry = failedTries.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > 15 * 60 * 1000) { failedTries.delete(ip); return false; }
  return entry.count >= 10;
}
function recordFailure(ip) {
  const entry = failedTries.get(ip);
  if (!entry || Date.now() - entry.since > 15 * 60 * 1000) failedTries.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

// The Nova site runs on another domain (GitHub Pages), so it needs CORS to log in.
app.use("/auth", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/auth/login", express.json({ limit: "2kb" }), (req, res) => {
  const ip = clientIp(req);
  if (tooManyTries(ip)) {
    return res.status(429).json({ ok: false, error: "Too many wrong tries. Wait 15 minutes." });
  }
  const password = req.body && req.body.password;
  if (PROXY_PASSWORD && typeof password === "string" && sameText(password, PROXY_PASSWORD)) {
    failedTries.delete(ip);
    return res.json({ ok: true, token: makeToken() });
  }
  recordFailure(ip);
  res.status(401).json({ ok: false, error: "Wrong password." });
});

app.get("/auth/check", (req, res) => {
  res.json({ ok: tokenIsValid(req.query.token) });
});

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
    '  sw: "/uv/uv.sw.js",',
    "};"
  ].join("\n"));
});

app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));

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
  '      <p id="welcome-msg">Type any URL or search term in the bar above once the status badge turns green.</p>',
  '      <form id="login-form" style="display:none;gap:8px">',
  '        <input id="login-pass" type="password" placeholder="Password" autocomplete="current-password" style="background:#0f172a;color:#f8fafc;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:14px" />',
  '        <button class="nav-btn" type="submit">Log in</button>',
  '      </form>',
  '      <p id="login-error" style="color:#f87171"></p>',
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
  '    function getToken() { try { return localStorage.getItem("nova_token") || ""; } catch { return ""; } }',
  '    function wispAddress() {',
  '      const wispProtocol = location.protocol === "https:" ? "wss://" : "ws://";',
  '      return wispProtocol + location.host + "/wisp/t/" + encodeURIComponent(getToken() || "none") + "/";',
  '    }',
  '',
  '    function showLogin(message) {',
  '      statusBadge.textContent = "Locked";',
  '      statusBadge.className = "badge error";',
  '      document.getElementById("welcome-msg").textContent = "Enter the password to use Nova Shell.";',
  '      document.getElementById("login-form").style.display = "flex";',
  '      document.getElementById("login-error").textContent = message || "";',
  '      document.getElementById("login-pass").focus();',
  '    }',
  '',
  '    document.getElementById("login-form").addEventListener("submit", async (e) => {',
  '      e.preventDefault();',
  '      const pass = document.getElementById("login-pass").value;',
  '      try {',
  '        const r = await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });',
  '        const data = await r.json();',
  '        if (!data.ok) return showLogin(data.error || "Wrong password.");',
  '        try { localStorage.setItem("nova_token", data.token); } catch {}',
  '        document.getElementById("login-form").style.display = "none";',
  '        document.getElementById("login-error").textContent = "";',
  '        document.getElementById("welcome-msg").textContent = "Type any URL or search term in the bar above once the status badge turns green.";',
  '        initProxy();',
  '      } catch { showLogin("Could not reach the server."); }',
  '    });',
  '',
  '    async function initProxy() {',
  '      try {',
  '        const check = await fetch("/auth/check?token=" + encodeURIComponent(getToken())).then((r) => r.json());',
  '        if (!check.ok) return showLogin();',
  '        if ("serviceWorker" in navigator) {',
  '          await navigator.serviceWorker.register("/uv/sw.js", { scope: "/uv/service/" });',
  '        }',
  '        const wispUrl = wispAddress();',
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
  '      if (!getToken()) return showLogin();',
  '      const target = resolveInput(input.value);',
  '      const wispUrl = wispAddress();',
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

app.get("/health", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ ok: true, wisp: true, mp: true, ts: Date.now() });
});

// ==================== DEDICATED MULTIPLAYER RELAY (/mp/) ====================
const mpWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const mpTopics = new Map(); // topic -> Set<ws>

function mpUnsubAll(ws) {
  if (!ws._subs) return;
  for (const topic of ws._subs) {
    const set = mpTopics.get(topic);
    if (set) {
      set.delete(ws);
      if (set.size === 0) mpTopics.delete(topic);
    }
  }
  ws._subs.clear();
}

function mpPublish(topic, msg) {
  const set = mpTopics.get(topic);
  if (!set || !set.size) return;
  const raw = JSON.stringify({ t: "msg", topic, msg });
  for (const peer of set) {
    if (peer.readyState === 1) {
      try { peer.send(raw); } catch {}
    }
  }
}

mpWss.on("connection", (ws) => {
  ws._subs = new Set();
  ws._will = null;
  ws._alive = true;
  ws.on("pong", () => { ws._alive = true; });
  ws.on("message", (data) => {
    let p;
    try { p = JSON.parse(String(data)); } catch { return; }
    if (!p || typeof p !== "object") return;
    if (p.t === "ping") {
      try { ws.send('{"t":"pong"}'); } catch {}
      return;
    }
    if (p.t === "will" && typeof p.topic === "string" && p.msg) {
      ws._will = { topic: p.topic.slice(0, 128), msg: p.msg };
      return;
    }
    if (p.t === "sub" && typeof p.topic === "string") {
      const topic = p.topic.slice(0, 128);
      if (ws._subs.size >= 16) return;
      ws._subs.add(topic);
      let set = mpTopics.get(topic);
      if (!set) { set = new Set(); mpTopics.set(topic, set); }
      set.add(ws);
      return;
    }
    if (p.t === "unsub" && typeof p.topic === "string") {
      const topic = p.topic.slice(0, 128);
      ws._subs.delete(topic);
      const set = mpTopics.get(topic);
      if (set) {
        set.delete(ws);
        if (set.size === 0) mpTopics.delete(topic);
      }
      return;
    }
    if (p.t === "pub" && typeof p.topic === "string" && p.msg !== undefined) {
      mpPublish(p.topic.slice(0, 128), p.msg);
    }
  });
  ws.on("close", () => {
    const will = ws._will;
    ws._will = null;
    mpUnsubAll(ws);
    if (will) mpPublish(will.topic, will.msg);
  });
  ws.on("error", () => {
    try { ws.close(); } catch {}
  });
});

setInterval(() => {
  for (const ws of mpWss.clients) {
    if (!ws._alive) { try { ws.terminate(); } catch {} continue; }
    ws._alive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);

const server = createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/wisp/")) {
    // The proxy itself: only logged-in browsers get through. Browsers can't add
    // headers to a WebSocket, so the token rides in the URL path:
    // /wisp/t/<token>/  (the path form, because some Wisp clients such as
    // libcurl.js refuse any URL that doesn't end in "/"). /wisp/?token=... also works.
    const url = new URL(req.url, "http://localhost");
    const inPath = url.pathname.match(/^\/wisp\/t\/([^/]+)\/$/);
    let token = url.searchParams.get("token");
    if (inPath) { try { token = decodeURIComponent(inPath[1]); } catch { token = ""; } }
    if (!tokenIsValid(token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    // wisp-js expects the plain Wisp path, so drop the token before handing off.
    req.url = "/wisp/";
    try { socket.setKeepAlive(true, 30000); socket.setNoDelay(true); } catch {}
    wisp.routeRequest(req, socket, head);
  } else if (req.url && (req.url === "/mp" || req.url.startsWith("/mp/"))) {
    try { socket.setKeepAlive(true, 25000); socket.setNoDelay(true); } catch {}
    mpWss.handleUpgrade(req, socket, head, (ws) => {
      mpWss.emit("connection", ws, req);
    });
  } else {
    socket.end();
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other copy of Nova, or start with a different PORT.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nNova Shell is running.`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) console.log(`  On your Wi-Fi:      http://${net.address}:${PORT}`);
    }
  }
  console.log(`  Wisp address:       ws://localhost:${PORT}/wisp/`);
  console.log(`\nLeave this window open. Press Ctrl+C to stop.\n`);
});

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import dns from "node:dns";
import path from "node:path";
import express from "express";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { WebSocketServer } from "ws";

// Prefer IPv4 globally (many home Wi-Fi routers advertise broken IPv6 routes,
// which causes YouTube and other sites to stall or time out).
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

// Tune Wisp for smooth YouTube / video streaming on residential laptops:
// - ipv4first DNS + 5 min cache
// - 512-packet send buffer (4x default) for smooth 1080p video chunks
// - disable UDP streams so YouTube uses rock-solid TCP/HTTP2 instead of stalled QUIC
wisp.options.dns_result_order = "ipv4first";
wisp.options.dns_ttl = 300;
wisp.options.send_buffer_size = 512;
wisp.options.allow_udp_streams = false;
wisp.options.allow_tcp_streams = true;

const __dir = path.dirname(fileURLToPath(import.meta.url));
const epoxyPath = path.join(__dir, "node_modules", "@mercuryworkshop", "epoxy-transport", "dist");
const CONFIG_FILE = path.join(__dir, "nova-config.json");
const PORT = Number(process.env.PORT) || 8080;
const SITE_URL = (process.env.NOVA_SITE_URL || "https://site2.jd1254678.workers.dev").replace(/\/+$/, "");

const SITE_REPO = process.env.NOVA_SITE_REPO || "jd1254678-art/Site";
const wantsNewPassword = process.argv.includes("--set-password");
const wantsSetupSync = process.argv.includes("--setup-sync");
const wantsTunnel = process.argv.includes("--tunnel");
const wantsNoPassword = process.argv.includes("--no-password");

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function saveConfig(obj) {
  const merged = Object.assign({}, readConfig(), obj);
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
}

if (wantsSetupSync) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n=== Auto-Sync Setup (Updates your Site automatically on every start) ===");
    console.log("1. Open: https://github.com/settings/personal-access-tokens/new");
    console.log("2. Repository access -> Only select repositories -> " + SITE_REPO);
    console.log("3. Permissions -> Repository permissions -> Contents -> Read and write");
    console.log("4. Click Generate token and paste it below:\n");
    const gh = (await rl.question("GitHub Token: ")).trim();
    if (!gh) { console.log("Cancelled."); process.exit(0); }
    saveConfig({ githubToken: gh, siteRepo: SITE_REPO });
    console.log("\nSaved to nova-config.json! Next time you run start.bat, your friends' site will auto-update.\n");
  } finally {
    rl.close();
  }
  process.exit(0);
}

async function askForPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nSet a password for your Nova proxy (or just press Enter to leave it open):");
    while (true) {
      const first = (await rl.question("Password: ")).trim();
      if (!first) return "";
      if (first.length < 4) { console.log("Use at least 4 characters (or press Enter for no password).\n"); continue; }
      const again = (await rl.question("Type it again: ")).trim();
      if (first === again) return first;
      console.log("Those didn't match. Try again.\n");
    }
  } finally {
    rl.close();
  }
}

const cfg = readConfig();
let PROXY_PASSWORD = wantsNoPassword
  ? ""
  : (wantsNewPassword ? "" : (process.env.PROXY_PASSWORD ?? cfg.password ?? null));

if ((PROXY_PASSWORD === null || wantsNewPassword) && process.stdin.isTTY) {
  PROXY_PASSWORD = await askForPassword();
  saveConfig({ password: PROXY_PASSWORD });
  console.log(
    PROXY_PASSWORD
      ? "Saved password to nova-config.json. (Change anytime with: npm run set-password)\n"
      : "No password set — anyone with your link can connect. (Add one anytime with: npm run set-password)\n"
  );
}
if (wantsNewPassword) {
  if (PROXY_PASSWORD === null) {
    console.error("Run this in a terminal window so it can ask you for the new password.");
    process.exit(1);
  }
  console.log("Updated. Everyone who was logged in will need the new password.");
  process.exit(0);
}
PROXY_PASSWORD = PROXY_PASSWORD || "";

const TOKEN_DAYS = Number(process.env.TOKEN_DAYS) || 180;

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
  if (!PROXY_PASSWORD) return true; // open mode
  if (typeof token !== "string" || !token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  return sameText(sig, sign(expires));
}

// Slow down password guessing: 12 wrong tries per IP every 15 minutes
const failedTries = new Map();
function clientIp(req) {
  const fwd = req.headers["cf-connecting-ip"] || req.headers["fly-client-ip"] || req.headers["x-forwarded-for"] || "";
  return String(fwd).split(",")[0].trim() || req.socket.remoteAddress || "?";
}
function tooManyTries(ip) {
  const entry = failedTries.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > 15 * 60 * 1000) { failedTries.delete(ip); return false; }
  return entry.count >= 12;
}
function recordFailure(ip) {
  const entry = failedTries.get(ip);
  if (!entry || Date.now() - entry.since > 15 * 60 * 1000) failedTries.set(ip, { count: 1, since: Date.now() });
  else entry.count++;
}

const app = express();

// CORS for Nova frontend (Cloudflare Workers / GitHub Pages / about:blank)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "8kb" }));

app.post("/auth/login", (req, res) => {
  if (!PROXY_PASSWORD) return res.json({ ok: true, token: "open", authRequired: false });
  const ip = clientIp(req);
  if (tooManyTries(ip)) return res.status(429).json({ ok: false, error: "Too many wrong tries. Wait 15 minutes." });
  const pass = typeof req.body?.password === "string" ? req.body.password : "";
  if (!sameText(pass, PROXY_PASSWORD)) {
    recordFailure(ip);
    return res.status(401).json({ ok: false, error: "Wrong password." });
  }
  failedTries.delete(ip);
  res.json({ ok: true, token: makeToken(), authRequired: true });
});

app.get("/auth/check", (req, res) => {
  if (!PROXY_PASSWORD) return res.json({ ok: true, authRequired: false });
  const tok = typeof req.query.token === "string" ? req.query.token : "";
  res.json({ ok: tokenIsValid(tok), authRequired: true });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, wisp: true, mp: true, authRequired: !!PROXY_PASSWORD, ts: Date.now() });
});

// Serve Ultraviolet, Bare-Mux, and Epoxy static assets if someone opens the laptop URL directly
app.use("/uv/", express.static(uvPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));

app.get("/", (_req, res) => {
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nova Proxy Server</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07050d;color:#f5f3ff;font-family:Inter,system-ui,sans-serif;padding:20px}
  .card{max-width:460px;width:100%;background:#110d1e;border:1px solid rgba(167,139,250,.28);border-radius:16px;padding:26px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.5)}
  h1{margin:0 0 8px;font-size:22px;color:#c4b5fd}
  p{margin:0 0 16px;color:#9d94b8;font-size:14px;line-height:1.5}
  .pill{display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(74,222,128,.14);border:1px solid rgba(74,222,128,.4);color:#4ade80;font-size:12.5px;font-weight:700;margin-bottom:16px}
  a.btn{display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#a855f7);color:#fff;text-decoration:none;font-weight:600;font-size:14px}
  code{display:block;margin-top:14px;padding:10px;border-radius:8px;background:#090611;border:1px solid rgba(167,139,250,.18);color:#e9d5ff;font-size:12px;word-break:break-all}
</style>
</head>
<body>
  <div class="card">
    <div class="pill">● Nova Proxy Online</div>
    <h1>Nova Laptop Proxy</h1>
    <p>Your Wisp proxy &amp; Multiplayer relay are running smoothly. Open Nova below to connect automatically:</p>
    <a class="btn" id="open-nova" href="${SITE_URL}">Open Nova →</a>
    <code id="wisp-out"></code>
  </div>
  <script>
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wisp = proto + "//" + location.host + "/wisp/";
    document.getElementById("wisp-out").textContent = wisp;
    document.getElementById("open-nova").href = ${JSON.stringify(SITE_URL)} + "/?server=" + encodeURIComponent(location.origin);
  </script>
</body>
</html>`);
});

// ==================== DEDICATED MULTIPLAYER RELAY (/mp/) ====================
const mpWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const mpTopics = new Map();

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
    if (p.t === "ping") { try { ws.send('{"t":"pong"}'); } catch {} return; }
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
  ws.on("error", () => { try { ws.close(); } catch {} });
});

setInterval(() => {
  for (const ws of mpWss.clients) {
    if (!ws._alive) { try { ws.terminate(); } catch {} continue; }
    ws._alive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);

// ==================== HTTP + WEBSOCKET UPGRADE SERVER ====================
const server = createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/wisp/")) {
    const url = new URL(req.url, "http://localhost");
    const inPath = url.pathname.match(/^\/wisp\/t\/([^/]+)\/?$/);
    let token = url.searchParams.get("token") || "";
    if (inPath) { try { token = decodeURIComponent(inPath[1]); } catch { token = ""; } }
    if (!tokenIsValid(token)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    // Strip token path/query before passing to wisp-js
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
    console.error(`Port ${PORT} is already in use. Close the other Nova window first.`);
    process.exit(1);
  }
  throw err;
});

// ==================== OPTIONAL CLOUDFLARE TUNNEL (--tunnel) ====================
let tunnelProc = null;
async function publishLiveWispUrl(host) {
  const conf = readConfig();
  const ghToken = process.env.GITHUB_TOKEN || conf.githubToken || "";
  const repo = process.env.NOVA_SITE_REPO || conf.siteRepo || SITE_REPO;
  if (!ghToken) {
    console.log("  Tip: Double-click setup-sync.bat once so friends NEVER need a new link!\n");
    return;
  }
  const apiUrl = `https://api.github.com/repos/${repo}/contents/wisp.json`;
  const headers = {
    "Authorization": `Bearer ${ghToken}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "nova-laptop-proxy"
  };
  try {
    let sha;
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }
    const payload = JSON.stringify({
      wisp: `wss://${host}/wisp/`,
      mp: `wss://${host}/mp/`,
      updatedAt: Date.now()
    }, null, 2) + "\n";
    const putBody = {
      message: "Auto-update live laptop tunnel URL [skip ci]",
      content: Buffer.from(payload, "utf8").toString("base64")
    };
    if (sha) putBody.sha = sha;
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify(putBody)
    });
    if (putRes.ok) {
      console.log(`  [Auto-Sync] Updated ${SITE_URL}/wisp.json! Friends will connect automatically.\n`);
    } else {
      console.error(`  [Auto-Sync] GitHub update failed (${putRes.status}). Re-run setup-sync.bat if token expired.\n`);
    }
  } catch (err) {
    console.error("  [Auto-Sync] Network error:", err.message);
  }
}

function startCloudflareTunnel() {
  const localBin = path.join(__dir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  const bin = existsSync(localBin) ? localBin : "cloudflared";
  const token = process.env.CLOUDFLARED_TOKEN || readConfig().tunnelToken || "";
  const args = token
    ? ["tunnel", "--no-autoupdate", "run", "--token", token]
    : ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`];

  console.log(token ? "Starting your Cloudflare Named Tunnel..." : "Opening a free Cloudflare public tunnel...");
  try {
    tunnelProc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    console.error("Could not start cloudflared:", err.message);
    return;
  }

  let printedUrl = false;
  function handleOut(chunk) {
    const text = String(chunk);
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !printedUrl) {
      printedUrl = true;
      const pubUrl = m[0];
      const host = pubUrl.replace(/^https:\/\//i, "");
      const wispUrl = `wss://${host}/wisp/`;
      const oneClick = `${SITE_URL}/?server=${encodeURIComponent(host)}`;
      console.log("\n======================================================================");
      console.log("  NOVA LAPTOP PROXY IS LIVE!");
      console.log("======================================================================");
      console.log(`  Friends Link:  ${SITE_URL}/`);
      console.log(`  1-Click Link:  ${oneClick}`);
      console.log(`  Server URL:    ${wispUrl}`);
      console.log(`  Password:      ${PROXY_PASSWORD ? "(enabled - saved in nova-config.json)" : "(none - open access)"}`);
      console.log("======================================================================");
      console.log("  Leave this window open while using Nova. Press Ctrl+C to stop.\n");
      publishLiveWispUrl(host);
    }
  }
  tunnelProc.stdout.on("data", handleOut);
  tunnelProc.stderr.on("data", handleOut);
  tunnelProc.on("error", (err) => {
    console.error("cloudflared error:", err.message);
  });
  tunnelProc.on("exit", (code) => {
    if (code && !printedUrl) {
      console.error(`cloudflared exited with code ${code}. Your local proxy is still running on http://localhost:${PORT}`);
    }
  });
}

function shutdown() {
  if (tunnelProc) { try { tunnelProc.kill(); } catch {} }
  try { server.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nNova Proxy listening on http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  Local Wi-Fi:   http://${net.address}:${PORT}`);
      }
    }
  }
  if (wantsTunnel) {
    startCloudflareTunnel();
  } else {
    console.log(`  Wisp address:  ws://localhost:${PORT}/wisp/`);
    console.log(`\nTip: Run with --tunnel (or double-click start.bat) for a public HTTPS link.\n`);
  }
});

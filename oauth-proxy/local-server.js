/**
 * Local OAuth Proxy for Decap CMS (Development)
 * ================================================
 * Clean approach: GitHub redirects directly to localhost:8000 (CMS origin),
 * so window.opener is preserved and postMessage works without issues.
 *
 * Flow:
 *   1. Decap CMS opens popup → localhost:8081/auth
 *   2. Proxy redirects to GitHub with redirect_uri=localhost:8000/admin/auth-complete.html
 *   3. GitHub redirects to localhost:8000/admin/auth-complete.html?code=xxx
 *   4. auth-complete.html fetches localhost:8081/token?code=xxx
 *   5. Proxy exchanges code → returns { token }
 *   6. auth-complete.html sends postMessage to CMS (same origin ✅)
 *
 * Usage:
 *   GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy node local-server.js
 */

const http = require("http");
const https = require("https");
const url = require("url");

const PORT = 8081;
const CMS_ORIGIN = "http://localhost:8000";
// GitHub will redirect back to this page after OAuth
const REDIRECT_URI = `${CMS_ORIGIN}/admin/auth-complete.html`;

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\n❌  Missing environment variables!");
  console.error("    Run with:");
  console.error(
    "    GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy node local-server.js\n"
  );
  process.exit(1);
}

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS — allow auth-complete.html to fetch /token
  res.setHeader("Access-Control-Allow-Origin", CMS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── GET /auth — Start GitHub OAuth ──────────────────────────────────
  // Decap CMS opens: localhost:8081/auth?provider=github&...
  // We redirect to GitHub with redirect_uri pointing to localhost:8000
  if (pathname === "/auth") {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "repo,user",
      redirect_uri: REDIRECT_URI,     // ← GitHub sends user back to localhost:8000
    });
    const githubUrl = `https://github.com/login/oauth/authorize?${params}`;
    console.log(`[auth]  → Redirecting to GitHub OAuth`);
    console.log(`        redirect_uri: ${REDIRECT_URI}`);
    res.writeHead(302, { Location: githubUrl });
    res.end();
    return;
  }

  // ── GET /token?code=xxx — Exchange code for token ───────────────────
  // Called by auth-complete.html via fetch() after GitHub sends back the code
  if (pathname === "/token") {
    const code = parsed.query.code;

    if (!code) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing code parameter" }));
      return;
    }

    console.log(`[token] Exchanging code for GitHub token...`);

    const body = JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    });

    let tokenData;
    try {
      tokenData = await httpsPost(
        {
          hostname: "github.com",
          path: "/login/oauth/access_token",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Accept: "application/json",
          },
        },
        body
      );
    } catch (err) {
      console.error("[token] Exchange failed:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Token exchange failed" }));
      return;
    }

    if (tokenData.error) {
      console.error("[token] GitHub error:", tokenData.error_description);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: tokenData.error_description }));
      return;
    }

    console.log(`[token] ✅ Token received! Sending to auth-complete.html`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token: tokenData.access_token }));
    return;
  }

  // ── GET /bridge — iframe that forwards messages with localhost:8081 origin ──
  // Decap CMS checks event.origin === base_url (localhost:8081).
  // A self-postMessage from index.html has origin localhost:8000, which is
  // rejected. Loading this page in an iframe and having it call
  // window.parent.postMessage makes event.origin === 'http://localhost:8081' ✅
  if (pathname === '/bridge') {
    const CMS = CMS_ORIGIN;
    const html = `<!DOCTYPE html>
<html>
<head><title>Decap CMS Auth Bridge</title></head>
<body>
<script>
  // Tell the parent we are ready
  window.parent.postMessage({ action: 'bridge-ready' }, '${CMS}');

  // Listen for token from parent (index.html at localhost:8000)
  window.addEventListener('message', function (e) {
    if (e.origin !== '${CMS}') return;
    if (e.data && e.data.action === 'decap-auth-forward') {
      // Forward to parent WITH THIS WINDOW'S ORIGIN (localhost:8081)
      // so Decap CMS sees event.origin === 'http://localhost:8081'
      window.parent.postMessage(e.data.message, '${CMS}');
      console.log('[bridge] Forwarded auth message \\u2705 (origin: http://localhost:${PORT})');
    }
  });
<\/script>
</body>
</html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': CMS_ORIGIN,
    });
    res.end(html);
    return;
  }

  // ── Health check ─────────────────────────────────────────────────────

  if (pathname === "/" || pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", redirect_uri: REDIRECT_URI }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`\n✅  Decap CMS OAuth Proxy running`);
  console.log(`   Proxy:        http://localhost:${PORT}`);
  console.log(`   Auth:         http://localhost:${PORT}/auth`);
  console.log(`   Token:        http://localhost:${PORT}/token?code=xxx`);
  console.log(`   Redirect URI: ${REDIRECT_URI}`);
  console.log(`\n⚠️  Make sure GitHub OAuth App callback URL is set to:`);
  console.log(`   ${REDIRECT_URI}`);
  console.log(`\n   Open CMS: ${CMS_ORIGIN}/admin/\n`);
});

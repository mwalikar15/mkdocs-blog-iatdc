/**
 * Decap CMS OAuth Proxy (Development & VPS Production)
 * ======================================================
 * Operates standalone locally or behind Nginx reverse proxy on Ubuntu VPS.
 *
 * Environment Variables:
 *   PORT                 - Server port (default: 8081)
 *   CMS_ORIGIN           - Allowed CMS origin (default: http://localhost:8000 or production domain)
 *   REDIRECT_URI         - GitHub OAuth redirect URI
 *   GITHUB_CLIENT_ID     - GitHub OAuth App Client ID
 *   GITHUB_CLIENT_SECRET - GitHub OAuth App Client Secret
 */

const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 8081;
const CMS_ORIGIN = process.env.CMS_ORIGIN || "http://localhost:8000";
const REDIRECT_URI = process.env.REDIRECT_URI || `${CMS_ORIGIN}/admin/auth-complete.html`;

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\n❌  Missing environment variables!");
  console.error("    Ensure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set.\n");
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
  // Strip trailing or leading path prefix if proxied via Nginx /oauth/
  let pathname = parsed.pathname.replace(/^\/oauth/, '');
  if (!pathname || pathname === '') pathname = '/';

  res.setHeader("Access-Control-Allow-Origin", CMS_ORIGIN === "*" ? "*" : CMS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // ── GET /auth — Start GitHub OAuth ──────────────────────────────────
  if (pathname === "/auth") {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "repo,user",
      redirect_uri: REDIRECT_URI,
    });
    const githubUrl = `https://github.com/login/oauth/authorize?${params}`;
    console.log(`[auth] Redirecting to GitHub OAuth (redirect_uri: ${REDIRECT_URI})`);
    res.writeHead(302, { Location: githubUrl });
    res.end();
    return;
  }

  // ── GET /token?code=xxx — Exchange code for token ───────────────────
  if (pathname === "/token") {
    const code = parsed.query.code;

    if (!code) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing code parameter" }));
      return;
    }

    console.log(`[token] Exchanging authorization code for token...`);

    const body = JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    });

    try {
      const tokenData = await httpsPost(
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

      if (tokenData.error) {
        console.error("[token] GitHub error:", tokenData.error_description || tokenData.error);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: tokenData.error_description || tokenData.error }));
        return;
      }

      console.log(`[token] ✅ Token successfully retrieved!`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: tokenData.access_token }));
    } catch (err) {
      console.error("[token] Exchange exception:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Token exchange failed" }));
    }
    return;
  }

  // ── GET /bridge — Cross-origin iframe bridge ───────────────────────
  if (pathname === '/bridge') {
    const html = `<!DOCTYPE html>
<html>
<head><title>Decap CMS Auth Bridge</title></head>
<body>
<script>
  window.parent.postMessage({ action: 'bridge-ready' }, '*');
  window.addEventListener('message', function (e) {
    if (e.data && e.data.action === 'decap-auth-forward') {
      window.parent.postMessage(e.data.message, '*');
    }
  });
<\/script>
</body>
</html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
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
  console.log(`\n✅  Decap CMS OAuth Proxy running on port ${PORT}`);
  console.log(`   CMS Origin:   ${CMS_ORIGIN}`);
  console.log(`   Redirect URI: ${REDIRECT_URI}\n`);
});

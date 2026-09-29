/**
 * Cloudflare Worker — Production GitHub OAuth Proxy for Decap CMS
 * =================================================================
 * Compatible with local-server.js architecture (/auth, /token, /bridge).
 *
 * Setup:
 *   1. npx wrangler deploy
 *   2. npx wrangler secret put GITHUB_CLIENT_ID
 *   3. npx wrangler secret put GITHUB_CLIENT_SECRET
 *   4. npx wrangler secret put REDIRECT_URI  (e.g. https://yourblogdomain.com/admin/auth-complete.html)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── GET /auth — Redirect to GitHub OAuth ───────────────────────────
    if (url.pathname === "/auth") {
      const redirectUri = env.REDIRECT_URI || `${url.origin}/callback`;
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        scope: "repo,user",
        redirect_uri: redirectUri,
      });
      return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
    }

    // ── GET /token?code=xxx — Exchange code for token ──────────────────
    if (url.pathname === "/token") {
      const code = url.searchParams.get("code");
      const redirectUri = env.REDIRECT_URI || `${url.origin}/callback`;

      if (!code) {
        return new Response(JSON.stringify({ error: "Missing code" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const data = await tokenRes.json();

      if (data.error) {
        return new Response(JSON.stringify({ error: data.error_description || data.error }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ token: data.access_token }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // ── GET /bridge — Bridge iframe for cross-origin postMessage ───────
    if (url.pathname === "/bridge") {
      const cmsOrigin = env.CMS_ORIGIN || "*";
      const html = `<!DOCTYPE html>
<html>
<head><title>Decap Auth Bridge</title></head>
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
      return new Response(html, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }

    return new Response("Decap CMS OAuth Proxy — Not Found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};

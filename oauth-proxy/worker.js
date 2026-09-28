/**
 * Cloudflare Worker — GitHub OAuth Proxy for Decap CMS
 * ======================================================
 * Deploy this worker to enable GitHub OAuth login for Decap CMS
 * without relying on Netlify.
 *
 * Setup:
 *   1. wrangler deploy worker.js --name decap-oauth
 *   2. wrangler secret put GITHUB_CLIENT_ID
 *   3. wrangler secret put GITHUB_CLIENT_SECRET
 *
 * Then set your GitHub OAuth App callback URL to:
 *   https://decap-oauth.<your-subdomain>.workers.dev/callback
 *
 * And update docs/admin/config.yml:
 *   backend:
 *     base_url: https://decap-oauth.<your-subdomain>.workers.dev
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS headers for browser requests ─────────────────────────────
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── /auth — Start OAuth flow ───────────────────────────────────────
    if (url.pathname === "/auth") {
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        scope: "repo,user",
        redirect_uri: `${url.origin}/callback`,
      });
      return Response.redirect(
        `https://github.com/login/oauth/authorize?${params}`,
        302
      );
    }

    // ── /callback — Exchange code for token ───────────────────────────
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");

      if (!code) {
        return new Response("Missing OAuth code", { status: 400 });
      }

      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
          }),
        }
      );

      const data = await tokenRes.json();

      if (data.error) {
        return new Response(`OAuth error: ${data.error_description}`, {
          status: 400,
        });
      }

      const { access_token } = data;

      // Post token back to the CMS window opener
      const script = `
        <!DOCTYPE html>
        <html>
        <head><title>Authenticating...</title></head>
        <body>
        <script>
          (function() {
            function receiveMessage(e) {
              console.log("receiveMessage %o", e);
            }
            window.addEventListener("message", receiveMessage, false);
            window.opener.postMessage(
              'authorization:github:success:${JSON.stringify({ token: access_token, provider: "github" })}',
              window.location.origin
            );
          })();
        <\/script>
        </body>
        </html>
      `;

      return new Response(script, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    }

    return new Response("Decap CMS OAuth Proxy — Not Found", { status: 404 });
  },
};

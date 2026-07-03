import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./middleware/auth.ts";
import { cfFontKV, denoFontKV } from "./services/kv.ts";
import type { FontKV } from "./services/kv.ts";
import convertRoute from "./routes/convert.ts";

type EnvBindings = {
  FONT_KV?: { get(key: string, type?: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };
};

type AppVariables = {
  kv: FontKV;
};

const app = new Hono<{ Bindings: EnvBindings; Variables: AppVariables }>();

app.use("*", async (c, next) => {
  const kv = c.env?.FONT_KV ? cfFontKV(c.env.FONT_KV) : await denoFontKV().catch(() => undefined);
  if (kv) c.set("kv", kv);
  await next();
});

app.use("*", cors());
app.use("*", logger());

app.use("/api/*", auth);

app.route("/api", convertRoute);

app.get("/", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>X to Image API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1419;
      color: #e7e9ea;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 640px;
      width: 100%;
    }
    h1 {
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    p.sub {
      color: #71767b;
      margin-bottom: 24px;
    }
    .endpoint {
      background: #16181c;
      border: 1px solid #2f3336;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .method {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      margin-right: 8px;
    }
    .get { background: #1d9bf0; color: #fff; }
    .post { background: #00ba7c; color: #fff; }
    .path {
      font-family: monospace;
      font-size: 14px;
      color: #e7e9ea;
    }
    code {
      background: #2f3336;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    .example {
      margin-top: 8px;
      font-size: 13px;
      color: #71767b;
    }
    a {
      color: #1d9bf0;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>X to Image API</h1>
    <p class="sub">Convert X/Twitter tweets to PNG images</p>
    <div class="endpoint">
      <span class="method get">GET</span>
      <span class="path">/api/convert?url=&lt;tweet_url&gt;&amp;theme=light|dim|dark</span>
      <div class="example">Example: <a href="/api/convert?url=https://x.com/elonmusk/status/1894154523456782336&theme=dark">/api/convert?url=...&amp;theme=dark</a></div>
    </div>
    <div class="endpoint">
      <span class="method post">POST</span>
      <span class="path">/api/convert</span>
      <div class="example">Body: <code>{"url": "https://x.com/user/status/123", "theme": "light"}</code></div>
    </div>
  </div>
</body>
</html>`);
});

app.get("/health", (c) => c.json({ status: "ok" }));

const g = globalThis as any;
const isBun = g.Bun !== undefined;
const isDeno = g.Deno !== undefined;

if (isDeno) {
  const port = parseInt(g.Deno.env.get("PORT")) || 3000;
  g.Deno.serve({ port }, app.fetch);
} else if (isBun) {
  const port = parseInt(g.Bun.env.PORT) || 3000;
  g.Bun.serve({ fetch: app.fetch, port, idleTimeout: 120 });
}

// For Cloudflare Workers and other environments that use export default.
// When running with Bun, the server is already started manually above,
// so we export a marker object (not a valid ServerConfig) to prevent
// Bun from auto-starting another server on the same port.
const _default = isBun || isDeno ? { __alreadyServed: true } : app;
export { _default as default };

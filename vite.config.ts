import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Vite plugin: 在 dev server 上代理 /api-proxy?url=<target> 请求，
 * 用于 web-mock 模式绕过 CORS 限制。
 */
function apiProxyPlugin(): Plugin {
  return {
    name: "far-api-proxy",
    configureServer(server) {
      server.middlewares.use("/api-proxy", async (req, res) => {
        const parsed = new URL(req.url ?? "/", "http://localhost");
        const targetUrl = parsed.searchParams.get("url");
        if (!targetUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing ?url= parameter" }));
          return;
        }

        try {
          // 收集请求 body
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          const body = Buffer.concat(chunks);

          // 转发请求头（移除 host 等 hop-by-hop）
          const forwardHeaders: Record<string, string> = {};
          const skipHeaders = new Set(["host", "connection", "referer", "origin"]);
          for (const [k, v] of Object.entries(req.headers)) {
            if (!skipHeaders.has(k) && typeof v === "string") {
              forwardHeaders[k] = v;
            }
          }

          const upstream = await fetch(targetUrl, {
            method: req.method ?? "GET",
            headers: forwardHeaders,
            body: body.length > 0 ? body : undefined,
          });

          // 回写响应
          const respHeaders: Record<string, string> = {};
          upstream.headers.forEach((v, k) => { respHeaders[k] = v; });
          // 允许前端读取所有响应头
          respHeaders["access-control-expose-headers"] = "*";

          res.writeHead(upstream.status, upstream.statusText, respHeaders);
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), apiProxyPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

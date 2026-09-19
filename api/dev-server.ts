/**
 * Local / preview development server for CRAM AI.
 *
 * Serves the platform-agnostic handler in ./core.ts over HTTP so the
 * Vite dev server (which proxies /api → localhost:3001) can reach it.
 * This is the same handler used by the Vercel, Netlify and Cloudflare
 * adapters, so preview behaviour matches production exactly.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

// Load .env.local from the project root (two levels up from api/)
const __apiDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__apiDir, "..");
for (const envFile of [".env", ".env.local", ".env.development"]) {
  try {
    const content = readFileSync(resolve(projectRoot, envFile), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // File doesn't exist — skip
  }
}
if (process.env.GEMINI_API_KEY) {
  console.log("[CRAM] GEMINI_API_KEY loaded from env file");
} else {
  console.warn("[CRAM] GEMINI_API_KEY not found — running in demo mode");
}

const PORT = Number(process.env.PORT || 3001);

async function main() {
  // Dynamic import so a syntax error in core.ts surfaces as a clear
  // startup failure instead of an unhandled promise rejection.
  const { handle } = await import("./core.js");

  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);

      const origin = `${req.headers["x-forwarded-proto"] || "http"}://${
        req.headers.host || `localhost:${PORT}`
      }`;

      const request = new Request(`${origin}${req.url}`, {
        method: req.method,
        headers: new Headers(req.headers as Record<string, string>),
        body:
          req.method !== "GET" && req.method !== "HEAD" && body.length > 0
            ? body
            : undefined,
        // Node's fetch sets this automatically for streaming bodies; harmless here.
        duplex: "half",
      } as RequestInit);

      const response = await handle(request);

      res.statusCode = response.status;
      const contentType = response.headers.get("content-type") || "";
      if (req.method === "HEAD") {
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end();
        return;
      }
      // Server-Sent Events must reach the browser as they are produced —
      // buffering the body here would defeat live generation progress.
      if (contentType.includes("text/event-stream") && response.body) {
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "content-length") res.setHeader(key, value);
        });
        await pipeline(Readable.fromWeb(response.body as never), res);
        return;
      }
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } catch (e) {
      console.error("[CRAM] dev-server error:", e);
      // A streamed response may already have started (e.g. the client
      // disconnected mid-generation) — nothing more can be sent.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: e instanceof Error ? e.message : "Unexpected server error.",
        })
      );
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[CRAM] dev server listening on http://0.0.0.0:${PORT} (model: ${
        process.env.GEMINI_API_KEY ? "real Gemini" : "NO KEY — demo mode"
      })`
    );
  });
}

main().catch((e) => {
  console.error("[CRAM] failed to start dev server:", e);
  process.exit(1);
});

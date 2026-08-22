import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env files from the project root (two levels up from artifacts/api-server/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const { config: loadDotenv } = await import("dotenv");
loadDotenv({ path: path.join(projectRoot, ".env") });
loadDotenv({ path: path.join(projectRoot, ".env.local") });
loadDotenv({ path: path.join(projectRoot, ".env.development") });

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Log whether the Gemini API key is configured (without revealing the key)
if (process.env.GEMINI_API_KEY) {
  logger.info("GEMINI_API_KEY detected — using real AI generation");
} else {
  logger.warn("GEMINI_API_KEY not found — running in demo mode");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

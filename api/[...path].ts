/**
 * Vercel Serverless Function entry point.
 *
 * This is a thin adapter that delegates to the platform-agnostic
 * handler in ./core.ts. Deploy to Vercel by placing this file in
 * the `api/` directory — Vercel automatically routes `/api/**` to it.
 */

import { handle, json } from "./core.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export default async function handler(
  request: Request,
): Promise<Response> {
  try {
    return await handle(request);
  } catch (e) {
    console.error("CRAM AI API error:", e);
    return json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Unexpected server error.",
      },
      500,
    );
  }
}

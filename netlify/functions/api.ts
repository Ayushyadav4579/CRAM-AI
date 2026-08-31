/**
 * Netlify Functions entry point.
 *
 * Converts Netlify's event format to a Web API Request, delegates
 * to the platform-agnostic handler in ../../api/core.ts, and converts
 * the Response back to Netlify's expected format.
 *
 * Netlify routes: add this to netlify.toml:
 *   [[redirects]]
 *     from = "/api/*"
 *     to = "/.netlify/functions/api/:splat"
 *     status = 200
 */

import { handle } from "../../api/core.js";

export const handler = async (event: {
  path: string;
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  isBase64Encoded: boolean;
  queryStringParameters?: Record<string, string>;
}) => {
  try {
    // Build the full URL from the Netlify event
    const params = event.queryStringParameters
      ? "?" + new URLSearchParams(event.queryStringParameters).toString()
      : "";
    const url = `https://placeholder.netlify.app${event.path}${params}`;

    // Convert body from base64 if needed
    let body: BodyInit | null = null;
    if (event.body) {
      body = event.isBase64Encoded
        ? Uint8Array.from(atob(event.body), (c) => c.charCodeAt(0))
        : event.body;
    }

    // Create a Web API Request
    const request = new Request(url, {
      method: event.httpMethod,
      headers: new Headers(event.headers),
      body: event.httpMethod !== "GET" && event.httpMethod !== "HEAD"
        ? body
        : undefined,
    });

    // Delegate to the platform-agnostic handler
    const response = await handle(request);

    // Convert Response back to Netlify format
    const responseBody = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      statusCode: response.status,
      headers,
      body: responseBody,
    };
  } catch (e) {
    console.error("Netlify API handler error:", e);
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        error: e instanceof Error ? e.message : "Unexpected server error.",
      }),
    };
  }
};

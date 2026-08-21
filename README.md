# CRAM AI

CRAM AI is a mobile-friendly AI study workspace that turns a student's own PDFs and notes into a complete learning system.

## Features

- PDF, DOCX, TXT and Markdown upload
- Paste notes
- Automatic subject detection and topic extraction
- AI-generated detailed and quick revision notes
- AI MCQs and exam questions (DPP/Test mode)
- Mnemonics and memory tricks for difficult facts
- Flashcards, fill-in-the-blanks, true/false, mind maps, definitions and formulas
- Ask your notes with a source-grounded AI tutor
- Local study history
- Copy and download study packs
- Secure server-side Gemini API integration
- Math-aware extraction and question generation
- PDF text spacing repair and Unicode math normalization
- Responsive mobile-first interface

## Project Structure

```
├── artifacts/
│   ├── cram-ai/          # Vite + React frontend (SPA)
│   └── api-server/       # Express.js API server (Gemini, PDF parsing)
├── api/
│   └── [...path].ts      # Vercel serverless function adapter
├── lib/
│   └── api-client-react/ # Typed API client
├── vercel.json           # Vercel deployment config
├── netlify.toml          # Netlify deployment config
└── package.json          # Workspace root
```

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Express.js API server with Google Gemini AI
- **API client**: Auto-generated typed client (Zod schemas)
- **AI**: Google Gemini (PDF extraction, study generation, OCR)

The frontend communicates with the API via `/api/*` routes. In development, Vite proxies these to the API server on port 3001. In production, the hosting platform routes them to the appropriate backend.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key for AI features |
| `GEMINI_MODEL` | No | Gemini model name (default: `gemini-3.6-flash`) |
| `SITE_URL` | No | Production URL for CORS origin checks |

**Never put `GEMINI_API_KEY` in frontend code.** It must stay server-side only.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/Ayushyadav4579/CRAM-AI.git
cd CRAM-AI

# Install dependencies
pnpm install

# Set environment variables (create a .env file in artifacts/api-server/)
echo "GEMINI_API_KEY=your_key_here" > artifacts/api-server/.env
echo "PORT=3001" >> artifacts/api-server/.env

# Start the frontend dev server (port 5173) and API server (port 3001)
pnpm dev
```

The frontend runs on `http://localhost:5173` and proxies API requests to `http://localhost:3001`.

## Deploy to Vercel

Vercel is the recommended deployment platform. The included `vercel.json` handles everything:

1. Push this repo to GitHub
2. Import the repo in [Vercel](https://vercel.com/new)
3. Vercel automatically detects: `pnpm install` → `pnpm --filter @workspace/cram-ai build`
4. Add environment variables in **Vercel → Project → Settings → Environment Variables**:
   - `GEMINI_API_KEY` (required)
   - `GEMINI_MODEL` (optional)
   - `SITE_URL` (optional)
5. Deploy — the `api/[...path].ts` catch-all serves all `/api/*` routes as serverless functions

No manual configuration needed in the Vercel dashboard. PDF/DOCX/image uploads are capped at 4 MB to stay under Vercel's request-body limit.

## Deploy to Netlify

1. Push this repo to GitHub
2. Import the repo in [Netlify](https://app.netlify.com)
3. Netlify reads `netlify.toml` for build settings:
   - Build command: `npx pnpm install --no-frozen-lockfile && npx pnpm --filter @workspace/cram-ai build`
   - Publish directory: `artifacts/cram-ai/dist`
4. Add environment variables in **Netlify → Site → Build & deploy → Environment**:
   - `GEMINI_API_KEY` (required)
5. Deploy

**Note**: The API server (`artifacts/api-server/`) must be hosted separately (e.g., Railway, Render, Fly.io) for Netlify deployments, since Netlify Functions have a different structure than Express.js. Update the frontend's API base URL to point to your hosted API server.

The SPA routing fallback is configured in `netlify.toml` — all routes serve `index.html`.

## Deploy to Cloudflare Pages

1. Push this repo to GitHub
2. Connect the repo in [Cloudflare Pages](https://dash.cloudflare.com/)
3. Set the build configuration:
   - Framework preset: None
   - Build command: `npx pnpm install --no-frozen-lockfile && npx pnpm --filter @workspace/cram-ai build`
   - Build output directory: `artifacts/cram-ai/dist`
4. Add environment variables in **Cloudflare Pages → Settings → Environment variables**
5. Deploy

Cloudflare Pages automatically supports SPA routing. The `_redirects` file in `public/` provides the fallback.

**Note**: Same API server consideration as Netlify — host the Express API separately.

## Deploy to Other Node.js Hosts (Railway, Render, Fly.io)

For a full-stack deployment with both frontend and API:

```bash
# Install and build the frontend
pnpm install
pnpm --filter @workspace/cram-ai build

# The API server is in artifacts/api-server/
cd artifacts/api-server
node dist/index.mjs  # Requires PORT env var
```

Set the following environment variables on your hosting platform:
- `GEMINI_API_KEY` (required)
- `PORT` (required for API server)
- `NODE_ENV=production` (optional)

For a **frontend-only** static site deployment (API hosted elsewhere):
- Build: `pnpm install && pnpm --filter @workspace/cram-ai build`
- Output: `artifacts/cram-ai/dist`
- Serve with any static file server

## Deploy to GitHub Pages (Frontend Only)

GitHub Pages serves static files only. The API must be hosted elsewhere.

```bash
pnpm install
pnpm --filter @workspace/cram-ai build
```

Deploy `artifacts/cram-ai/dist/` to GitHub Pages. The SPA routing fallback needs the `_redirects` file (already included in `public/`).

## OCR Support

CRAM AI supports OCR for scanned/image-only PDFs and JPG/PNG study images. Normal text PDFs are parsed locally first; when a PDF has no readable text, the server uses the configured Gemini model's multimodal input to extract the visible text.

The OCR path requires `GEMINI_API_KEY` and respects the 4 MB upload limit.

## Math-Aware Processing

When uploaded documents contain mathematical content, CRAM AI:
- Preserves equations, variables, and mathematical notation
- Normalizes Unicode math characters (e.g., `푥` → `x`)
- Repairs PDF text spacing issues
- Generates math-specific questions with computational problems
- Verifies mathematical answers

## License

MIT

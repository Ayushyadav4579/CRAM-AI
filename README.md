# CRAM AI

CRAM AI is a mobile-friendly AI study workspace that turns a student's own PDFs and notes into a complete learning system.

## Included

- PDF, DOCX, TXT and Markdown upload
- Paste notes
- Automatic topic detection
- AI-generated detailed and quick revision notes
- AI MCQs and exam questions
- AI mixed quiz
- Mnemonics and memory tricks for difficult facts
- Flashcards, fill-in-the-blanks, true/false, mind maps, definitions and formulas
- Ask your notes with a source-grounded AI tutor
- Local study history
- Copy and download study systems
- Secure server-side Gemini API integration
- Vercel Functions backend (Netlify Functions also included)
- Security headers, origin protection and basic rate limiting
- Responsive mobile-first interface

## AI setup

Set `GEMINI_API_KEY` in your hosting provider's environment variables. Never put the key in frontend code.

Optional: `GEMINI_MODEL` (defaults to `gemini-3.6-flash`) and `SITE_URL`.

## Deploy to Vercel

Push this repo to GitHub, then import it in Vercel. The included `vercel.json` already sets the install command, build command (`pnpm --filter @workspace/cram-ai build`), output directory, and the security headers, and `api/[...path].ts` serves all `/api/*` routes as a single Vercel Function — no extra configuration needed in the dashboard.

Before your first deploy, add these in Vercel → Project → Settings → Environment Variables:

- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, defaults to `gemini-3.6-flash`)
- `SITE_URL` (optional — your production URL, used to restrict allowed request origins)

Then redeploy so the function picks up the new variables. PDF/DOCX/image uploads are capped at 4 MB in-app, which stays safely under Vercel's fixed 4.5 MB request-body limit; TXT/MD files are read directly in the browser and never hit that limit.

## Deploy to Netlify

The project is configured for Vercel: the Vite app builds to `artifacts/cram-ai/dist`, while the root `api/[...path].ts` catch-all handles `/api/*` requests. PDF/DOCX/image uploads are capped below Vercel's 4.5 MB serverless request-body limit; TXT/MD files are read in the browser.

## Subscription

This release intentionally contains **no fake/demo Pro subscription UI**. Real paid plans can be integrated later with a payment provider and server-side verification.


## OCR support

CRAM AI supports OCR for scanned/image-only PDFs and JPG/PNG study images. Normal text PDFs are parsed locally first; when a PDF has no readable text, the server uses the configured Gemini model's multimodal input to extract the visible text. JPG/PNG uploads are OCR'd through the same server-side Gemini API key.

The OCR path requires `GEMINI_API_KEY` in your hosting provider's environment variables and respects the 4 MB upload limit.

/**
 * Source content cleaning module.
 *
 * Separates educational content from document metadata before
 * the AI generation pipeline processes the text.
 *
 * Strategy:
 * 1. Normalize whitespace and encoding
 * 2. Remove repeated running headers/footers
 * 3. Strip metadata lines (author, school, copyright, page numbers, etc.)
 * 4. Remove noise fragments (URLs, long IDs, course codes)
 * 5. Collapse blank lines and trim
 *
 * Educational content that is ALWAYS preserved:
 * - Concepts, definitions, facts, examples
 * - Equations, formulas, derivations (marked to protect from stripping)
 * - Dates, names that are part of subject matter
 * - Processes, relationships, numerical information
 * - Tables when their text can be extracted
 */

// ── Metadata line patterns ────────────────────────────────────────────────────

const METADATA_PATTERNS: RegExp[] = [
  // Author / preparation lines
  /^(?:author|prepared by|written by|created by|submitted by|submitted to|teacher|instructor|professor|faculty|under (?:the )?guidance of)\s*[:\-–—]?\s*.*/im,

  // School / institute / university lines
  /^(?:school|college|university|institute|academy|department|faculty of|centre for|center for)\s+.{3,80}$/im,

  // Contact / email / phone — only standalone lines
  /^\s*(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4})\s*$/im,

  // Page numbers (standalone lines)
  /^\s*(?:page|pg\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?\s*$/im,

  // Copyright notices — handles 'Copyright 2024', 'Copyright © 2024', '© 2024', '(c) 2024'
  /^\s*(?:©|\(c\)|copyright)\s*(?:©\s*)?\d{4}.*$/im,

  // File metadata
  /^\s*(?:file\s*(?:name|size|type|path)|document\s*(?:id|number|ref))\s*[:\-–—]?\s*.*/im,

  // Timestamps
  /^\s*(?:date|time|timestamp|created|modified|updated)\s*[:\-–—]\s*\d{1,4}[-./]\d{1,2}[-./]\d{1,4}.*$/im,

  // Separator lines
  /^\s*[-=]{3,}\s*$/m,

  // Confidential / draft markings
  /^\s*(?:confidential|draft|internal use|for internal (?:use only)|not for distribution|do not (?:copy|distribute))\s*$/im,

  // Roll/enrollment/class administrative lines
  /^\s*(?:roll\s*(?:no|number)|enrollment\s*(?:no|number)|register\s*(?:no|number)|class:|section:|batch:)\s*[:\-–—]?\s*\S*\s*$/im,

  // Semester/session/year academic admin
  /^\s*(?:semester|session|academic year|term)\s*[:\-–—]?\s*\S+\s*$/im,

  // Grading / marks lines
  /^\s*(?:total\s*marks|max(?:imum)?\s*marks|marks|grade|grading)\s*[:\-–—]?\s*\S+\s*$/im,

  // "To", "From", "Subject:" header blocks (like memos)
  /^\s*(?:to|from|subject|dear)\s*[:\-–—]\s*.*/im,

  // QR code / barcode descriptions
  /^\s*(?:qr\s*code|barcode|scan\s*(?:code|here)|scan\s*me)\s*$/im,

  // ISBN numbers
  /^\s*(?:isbn|isbn-?\d+)\s*[:\-–—]?\s*[\d\s\-]{10,20}$/im,

  // Price information
  /^\s*(?:price|mrp|m\.?r\.?p\.?|cost|rs\.?|inr|usd|eur|£|\$|₹)\s*[:\-–—]?\s*[\d.,]+/im,

  // Publisher information
  /^\s*(?:published by|published at|publisher|published in|printed by|printed at|printed at|imprint)\s*[:\-–—]?\s*.*/im,

  // Printing/paper information
  /^\s*(?:printed on|printed on\s+\d+\s*gsm|paper type|paper quality|binding)\s*.*/im,

  // Edition information
  /^\s*(?:\d+(?:st|nd|rd|th)\s+edition|edition\s*[:\-–—]?\s*\d+|revised edition|new edition|first edition|second edition|third edition)\s*$/im,

  // Copyright / all rights reserved (already partially covered, but add more)
  /^\s*(?:all\s+rights\s+reserved|no\s+part\s+of\s+this|reproduced\s+without|without\s+prior|written\s+permission)\s*.*/im,

  // Legal/disclaimer lines
  /^\s*(?:disclaimer|legal\s+notice|terms\s+and\s+conditions|privacy\s+policy|licence|license\s+agreement)\s*[:\-–—]?\s*.*/im,

  // Publication address lines (city, country patterns)
  /^\s*[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)*\s*,\s*(?:india|usa|uk|canada|australia|pune|delhi|mumbai|bangalore|chennai|kolkata|hyderabad)\s*$/im,

  // Catalog / series numbers
  /^\s*(?:catalog(?:ue)?\s*(?:no|number)?|series\s*(?:no|number)?|volume\s*(?:no|number)?)\s*[:\-–—]?\s*\S+\s*$/im,

  // Price / MRP on its own line
  /^\s*(?:rs\.?|inr|₹|\$|usd|price|mrp)\s*[:\-–—]?\s*\d[\d.,]*\s*$/im,
];

// ── "Protected" metadata tokens ──────────────────────────────────────────────
// Phrases that indicate a line is metadata, not educational content.

const METADATA_LINE_MARKERS = [
  "prepared by",
  "submitted by",
  "submitted to",
  "written by",
  "created by",
  "taught by",
  "under the guidance of",
  "instructor",
  "professor",
  "faculty",
  "department of",
  "school of",
  "college of",
  "university",
  "institute of",
  "academy",
  "contact:",
  "email:",
  "phone:",
  "website:",
  "www.",
  "all rights reserved",
  "no part of this",
  "reproduced without",
  "printed in",
  "published by",
  "edition:",
  "version:",
  "revision:",
  "semester:",
  "session:",
  "academic year",
  "enrollment no",
  "roll no",
  "register no",
  "batch:",
  "isbn:",
  "isbn ",
  "price:",
  "mrp:",
  "printed by",
  "printed on",
  "all rights reserved",
  "no part of this",
  "written permission",
  "catalog no",
  "catalogue no",
  "series no",
  "volume no",
];

// ── Preprocessing steps ──────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")           // trailing spaces per line
    .replace(/\n{3,}/g, "\n\n")         // collapse blank lines
    .trim();
}

function removeRepeatedHeadings(text: string): string {
  const lines = text.split("\n");
  const freq = new Map<string, number>();
  for (const line of lines) {
    const normed = line.trim().toLowerCase();
    if (normed.length >= 4 && normed.length <= 80 && !/[.!?]$/.test(normed)) {
      freq.set(normed, (freq.get(normed) ?? 0) + 1);
    }
  }
  const repeated = new Set<string>();
  for (const [line, count] of freq) {
    if (count >= 3) repeated.add(line);
  }
  if (repeated.size === 0) return text;

  return lines
    .filter((line) => {
      const normed = line.trim().toLowerCase();
      return !repeated.has(normed);
    })
    .join("\n");
}

function removeMetadataLines(text: string): string {
  const lines = text.split("\n");
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;

      // Check if the line matches any metadata pattern
      for (const pattern of METADATA_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(trimmed)) return false;
      }

      // Check for metadata marker phrases in short lines
      const lower = trimmed.toLowerCase();
      if (trimmed.length <= 120) {
        for (const marker of METADATA_LINE_MARKERS) {
          if (lower.startsWith(marker) || lower.includes(`: ${marker}`) || lower === marker) {
            return false;
          }
        }
      }
      return true;
    })
    .join("\n");
}

function removeNoiseFragments(text: string): string {
  return text
    .replace(/\b(?:www|http|https|ftp|mailto)\S*/gi, "")
    .replace(/\b\d{10,}\b/g, "")            // long numeric strings (IDs, roll numbers)
    .replace(/\b[A-Z]{2,3}\d{4,}\b/g, "")   // course codes like CS1001
    .trim();
}

/**
 * Protect equations and formulas from being damaged by cleaning.
 * Markdown math expressions like $...$ and $$...$$ are wrapped in
 * invisible markers so they survive the pipeline.
 */
function protectFormulas(text: string): string {
  // Protect inline math $...$
  return text.replace(
    /(\$[^$]+\$)/g,
    (match) => `\x00FORMULA_START\x00${match}\x00FORMULA_END\x00`,
  );
}

function restoreFormulas(text: string): string {
  return text
    .replace(/\x00FORMULA_START\x00/g, "")
    .replace(/\x00FORMULA_END\x00/g, "");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Clean raw extracted text by stripping metadata, noise, and
 * repeated headings while preserving educational content.
 */
export function cleanSourceText(rawText: string): string {
  let text = normalizeWhitespace(rawText);

  // Protect formulas before aggressive cleaning
  text = protectFormulas(text);

  text = removeRepeatedHeadings(text);
  text = removeMetadataLines(text);
  text = removeNoiseFragments(text);

  // Restore protected formulas
  text = restoreFormulas(text);

  text = normalizeWhitespace(text);        // final collapse
  return text;
}

/**
 * Returns stats about how much text was removed.
 */
export function cleaningStats(raw: string, cleaned: string): {
  rawChars: number;
  cleanedChars: number;
  removedPercent: number;
} {
  const rawChars = raw.length;
  const cleanedChars = cleaned.length;
  const removedPercent = rawChars > 0
    ? Math.round(((rawChars - cleanedChars) / rawChars) * 100)
    : 0;

  return { rawChars, cleanedChars, removedPercent };
}

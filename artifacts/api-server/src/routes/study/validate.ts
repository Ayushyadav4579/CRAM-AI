/**
 * Validation pipeline for AI-generated study items.
 *
 * Validates each item against its type-specific Zod schema,
 * checks source grounding, performs semantic deduplication,
 * and filters metadata-contaminated or low-quality content.
 */

import { z } from "zod";
import {
  STUDY_ITEM_SCHEMAS,
  type StudyItemType,
} from "@workspace/api-zod";

// ── Semantic deduplication ───────────────────────────────────────────────────

/**
 * Simple semantic dedup: normalize text and check for near-duplicates
 * by computing a simplified word-shingle fingerprint.
 */
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordShingles(text: string, size: number = 3): Set<string> {
  const words = normalizeForDedup(text).split(" ");
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - size; i++) {
    shingles.add(words.slice(i, i + size).join(" "));
  }
  return shingles;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function extractPrimaryKey(item: Record<string, unknown>): string {
  const keys = ["question", "statement", "front", "fact", "term", "word", "heading", "branch", "formula", "content"];
  for (const key of keys) {
    const val = item[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return JSON.stringify(item);
}

/**
 * Deduplicate items semantically: remove items whose primary text
 * has Jaccard similarity > 0.65 with an earlier item.
 */
export function deduplicateItems(items: unknown[]): unknown[] {
  const seen: { key: string; shingles: Set<string> }[] = [];
  const UNIQUE_THRESHOLD = 0.65;

  return items.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const record = item as Record<string, unknown>;
    const primary = extractPrimaryKey(record);
    const shingles = wordShingles(primary);

    for (const prev of seen) {
      const sim = jaccardSimilarity(shingles, prev.shingles);
      if (sim > UNIQUE_THRESHOLD) return false;
    }

    seen.push({ key: primary, shingles });
    return true;
  });
}

// ── Metadata contamination filter ──────────────────────────────────────────

/**
 * Metadata patterns that should never appear in generated study content.
 */
const METADATA_CONTAMINATION = /^(?:isbn|price|mrp|copyright|all rights reserved|printed (?:in|on)|published (?:in|by)|edition|version|author|prepared by|grade \d|class \d|total marks|time:|section:|semester|session|academic year|enrollment|roll no|register no|batch:|school of|college of|university|institute of|department of|contact:|email:|phone:|website:|www\.|\d+ marks|\d+ minutes|\d+ questions|\d+ items|the correct price|the publication|the publisher)/i;

/**
 * Check if a string contains metadata contamination.
 */
function containsMetadata(text: string): boolean {
  return METADATA_CONTAMINATION.test(text);
}

/**
 * Filter items that contain metadata contamination.
 * Returns true if the item is clean (no metadata).
 */
function passesMetadataFilter(item: Record<string, unknown>): boolean {
  const checkFields = ["question", "statement", "front", "fact", "term", "heading", "definition", "word"];
  for (const field of checkFields) {
    const val = item[field];
    if (typeof val === "string" && containsMetadata(val)) {
      return false;
    }
  }
  return true;
}

// ── MCQ quality checks ──────────────────────────────────────────────────────

/**
 * Check if an MCQ item has acceptable quality.
 * Returns true if quality is acceptable.
 */
function passesMcqQuality(item: Record<string, unknown>): boolean {
  const question = typeof item.question === "string" ? item.question : "";
  const correctAnswer = typeof item.correctAnswer === "string" ? item.correctAnswer : "";
  const options = Array.isArray(item.options) ? item.options : [];

  // Reject if question contains the answer (answer leaked into question)
  if (question.length > 10 && correctAnswer.length > 10 && question.includes(correctAnswer.slice(0, 20))) {
    return false;
  }

  // Reject generic/bad questions
  const badPatterns = [
    /^what does the material say/i,
    /^which of the following is mentioned/i,
    /^explain:/i,
    /^what is correct\?/i,
    /^what is \w+\?$/i, // single-word questions like "What is Channel?"
  ];
  for (const pattern of badPatterns) {
    if (pattern.test(question)) return false;
  }

  // Reject if options contain metadata
  for (const opt of options) {
    if (typeof opt === "string" && containsMetadata(opt)) return false;
  }

  // Reject if all options are identical
  const uniqueOptions = new Set(options.map(o => typeof o === "string" ? o.toLowerCase().trim() : ""));
  if (uniqueOptions.size < 3) return false;

  return true;
}

// ── Schema validation ────────────────────────────────────────────────────────

/**
 * Validate an array of items against the Zod schema for the given type.
 * Returns the validated items, discarding any that fail validation.
 */
export function validateItems(
  type: StudyItemType,
  items: unknown[],
): unknown[] {
  const schema = STUDY_ITEM_SCHEMAS[type];
  if (!schema) return items;

  const validated: unknown[] = [];
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) {
      validated.push(result.data);
    }
    // Silently drop malformed items – the AI was asked to generate
    // them, but they didn't match the required shape.
  }
  return validated;
}

// ── Source grounding check ───────────────────────────────────────────────────

/**
 * Quick heuristic source-grounding check.
 * Returns true if the item text shares sufficient vocabulary with the source.
 *
 * This is NOT a semantic check – it's a fast filter for clearly
 * fabricated content that has no overlap with the source material.
 */
export function passesSourceGrounding(
  item: Record<string, unknown>,
  sourceText: string,
  minOverlap: number = 0.12,
): boolean {
  // Extract the "content" fields from the item
  const contentParts: string[] = [];
  for (const val of Object.values(item)) {
    if (typeof val === "string" && val.length > 10) {
      contentParts.push(val);
    }
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string" && v.length > 5) contentParts.push(v);
      }
    }
  }
  if (contentParts.length === 0) return false;

  const itemText = contentParts.join(" ");
  const itemWords = new Set(normalizeForDedup(itemText).split(" ").filter((w) => w.length > 3));
  const sourceWords = new Set(normalizeForDedup(sourceText).split(" ").filter((w) => w.length > 3));

  if (itemWords.size === 0) return false;

  let overlap = 0;
  for (const w of itemWords) {
    if (sourceWords.has(w)) overlap++;
  }

  return overlap / itemWords.size >= minOverlap;
}

// ── Full validation pipeline ─────────────────────────────────────────────────

/**
 * Run the full validation pipeline on a section of generated items:
 * 1. Schema validation (drop malformed items)
 * 2. Metadata contamination filter (drop items based on metadata)
 * 3. Source grounding check (drop items that look fabricated)
 * 4. MCQ quality check (for MCQ type only)
 * 5. Semantic deduplication (drop near-duplicate items)
 */
export function validateSection(
  type: string,
  items: unknown[],
  sourceText: string,
): unknown[] {
  let validated = items;

  // Step 1: Schema validation
  if (type in STUDY_ITEM_SCHEMAS) {
    validated = validateItems(type as StudyItemType, validated);
  }

  // Step 2: Metadata contamination filter
  validated = validated.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return passesMetadataFilter(item as Record<string, unknown>);
  });

  // Step 3: Source grounding
  validated = validated.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return passesSourceGrounding(item as Record<string, unknown>, sourceText);
  });

  // Step 4: MCQ quality check (for MCQ type only)
  if (type === "mcq") {
    validated = validated.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return passesMcqQuality(item as Record<string, unknown>);
    });
  }

  // Step 5: Semantic deduplication
  validated = deduplicateItems(validated);

  return validated;
}

// ── Type labels (mirrors the frontend) ───────────────────────────────────────

export const typeLabels: Record<string, string> = {
  notes: "Detailed Notes",
  short_notes: "Short Notes",
  mcq: "MCQs",
  short_answer: "Short Answer Questions",
  long_answer: "Long Answer Questions",
  true_false: "True/False",
  fill_blank: "Fill in the Blanks",
  flashcards: "Flashcards",
  quiz: "Mixed Quiz",
  mindmap: "Mind Map",
  definitions: "Definitions",
  formulas: "Formulas",
  difficult_words: "Difficult Words",
  mnemonics: "Mnemonics",
};

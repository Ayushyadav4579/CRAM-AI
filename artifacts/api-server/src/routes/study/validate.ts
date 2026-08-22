/**
 * Validation pipeline for AI-generated study items.
 *
 * Validates each item against its type-specific Zod schema,
 * checks source grounding, performs semantic deduplication,
 * and filters metadata-contaminated or low-quality content.
 *
 * Enhanced with:
 * - Generic/vague question detection
 * - MCQ option quality checks (correct answer in options, length balance)
 * - Notes minimum content length
 * - Flashcard atomicity check
 * - Mind map brevity check
 * - Mnemonics genuineness guard
 * - Short/long answer quality gates
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

// ── Generic/vague question detection ────────────────────────────────────────

/**
 * Patterns for questions that are too vague, generic, or meaningless.
 * These should be rejected even if they pass schema validation.
 */
const GENERIC_QUESTION_PATTERNS: RegExp[] = [
  // Vague reference patterns
  /^what does the material say/i,
  /^which of the following is mentioned/i,
  /^which statement is (?:correct|true|supported|mentioned)/i,
  /^what is correct\?/i,
  /^what is (?:the )?type\?/i,
  /^what is each\?/i,
  /^what is (?:the )?correct\?/i,
  // Meta-questions about the text itself
  /^explain this (?:section|chapter|paragraph|part)/i,
  /^discuss (?:this|the above)/i,
  /^write about (?:this|the above)/i,
  // Single word questions (not meaningful)
  /^what is \w+\?$/i,
  /^what are \w+\?$/i,
  // Answer-in-question patterns
  /^explain:/i,
  /^describe (?:briefly )?:/i,
  // Too-short questions
  /^.{0,15}\?$/i,
];

/**
 * Check if a question is too vague or generic to be educationally useful.
 */
function passesGenericQuestionFilter(item: Record<string, unknown>): boolean {
  const question = typeof item.question === "string" ? item.question : "";
  const statement = typeof item.statement === "string" ? item.statement : "";
  const text = question || statement;

  if (text.length === 0) return true; // no question to check

  for (const pattern of GENERIC_QUESTION_PATTERNS) {
    if (pattern.test(text)) return false;
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
  const explanation = typeof item.explanation === "string" ? item.explanation : "";

  // Reject if question contains the answer (answer leaked into question)
  if (question.length > 10 && correctAnswer.length > 10 && question.includes(correctAnswer.slice(0, 20))) {
    return false;
  }

  // Reject generic/bad questions
  if (!passesGenericQuestionFilter(item)) return false;

  // Reject if options contain metadata
  for (const opt of options) {
    if (typeof opt === "string" && containsMetadata(opt)) return false;
  }

  // Reject if all options are identical
  const uniqueOptions = new Set(options.map(o => typeof o === "string" ? o.toLowerCase().trim() : ""));
  if (uniqueOptions.size < 3) return false;

  // Reject if no explanation provided
  if (explanation.length < 10) return false;

  // Reject if correct answer doesn't appear in any option (mismatched answer)
  if (correctAnswer.length > 0 && options.length > 0) {
    const normalizedCorrect = correctAnswer.replace(/^[A-Da-d][).)\]:]\s*/, "").trim().toLowerCase();
    const anyOptionContains = options.some(o => {
      if (typeof o !== "string") return false;
      const normalizedOpt = o.replace(/^[A-Da-d][).)\]:]\s*/, "").trim().toLowerCase();
      return normalizedOpt.includes(normalizedCorrect.slice(0, 20)) || normalizedCorrect.includes(normalizedOpt.slice(0, 20));
    });
    if (!anyOptionContains && normalizedCorrect.length > 5) return false;
  }

  // Reject if any option is dramatically longer than others (length giveaway)
  if (options.length >= 3) {
    const lengths = options.map(o => typeof o === "string" ? o.length : 0).filter(l => l > 0);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    if (maxLen > minLen * 4 && maxLen > 80) return false;
  }

  return true;
}

// ── Notes quality check ────────────────────────────────────────────────────

/**
 * Check if a notes item has sufficient educational content.
 */
function passesNotesQuality(item: Record<string, unknown>): boolean {
  const heading = typeof item.heading === "string" ? item.heading : "";
  const content = typeof item.content === "string" ? item.content : "";

  // Reject if content is too short to be educational
  if (content.length < 20) return false;

  // Reject if heading is empty or too generic
  if (heading.length === 0) return false;

  // Reject metadata-contaminated headings
  if (containsMetadata(heading)) return false;

  // Reject if heading is just a sentence (not a topic label)
  if (heading.length > 100 && /[.!?]$/.test(heading)) return false;

  return true;
}

// ── Flashcard quality check ────────────────────────────────────────────────

/**
 * Check if a flashcard follows atomicity (one concept per card).
 */
function passesFlashcardQuality(item: Record<string, unknown>): boolean {
  const front = typeof item.front === "string" ? item.front : "";
  const back = typeof item.back === "string" ? item.back : "";

  // Front should be concise (one question/term)
  if (front.length > 150) return false;

  // Back should be concise (1-3 sentences)
  if (back.length > 300) return false;

  // Front should not be empty
  if (front.length < 5) return false;

  // Back should not be empty
  if (back.length < 3) return false;

  // Reject metadata-contaminated cards
  if (containsMetadata(front)) return false;

  return true;
}

// ── Mind map quality check ─────────────────────────────────────────────────

/**
 * Check if a mind map item has short, meaningful labels.
 */
function passesMindmapQuality(item: Record<string, unknown>): boolean {
  const branch = typeof item.branch === "string" ? item.branch : "";
  const children = Array.isArray(item.children) ? item.children : [];

  // Branch should be short (1-5 words)
  if (branch.length > 50) return false;

  // Children should be short
  for (const child of children) {
    if (typeof child === "string" && child.length > 60) return false;
  }

  // Branch should not be metadata
  if (containsMetadata(branch)) return false;

  // Branch should not be empty
  if (branch.length < 2) return false;

  // Should have at least one child
  if (children.length === 0) return false;

  return true;
}

// ── Mnemonics quality check ────────────────────────────────────────────────

/**
 * Check if a mnemonic is genuinely useful (not forced).
 */
function passesMnemonicQuality(item: Record<string, unknown>): boolean {
  const fact = typeof item.fact === "string" ? item.fact : "";
  const trick = typeof item.trick === "string" ? item.trick : "";

  // Trick should be substantive
  if (trick.length < 10) return false;

  // Reject obviously forced/generic mnemonics
  const forcedPatterns = [
    /^no mnemonic/i,
    /^understanding.*is more reliable/i,
    /^better learned through/i,
    /^easier to remember directly/i,
  ];
  for (const pattern of forcedPatterns) {
    if (pattern.test(trick)) return false;
  }

  // Reject if the trick is just a rephrasing of the fact
  if (fact.length > 5 && trick.length > 5) {
    const factNorm = normalizeForDedup(fact);
    const trickNorm = normalizeForDedup(trick);
    if (factNorm === trickNorm) return false;
  }

  // Reject metadata-contaminated mnemonics
  if (containsMetadata(fact)) return false;

  return true;
}

// ── Short/long answer quality check ────────────────────────────────────────

/**
 * Check if a short answer question has a substantive question and answer.
 */
function passesShortAnswerQuality(item: Record<string, unknown>): boolean {
  const question = typeof item.question === "string" ? item.question : "";
  const answer = typeof item.answer === "string" ? item.answer : "";

  // Question should be substantive
  if (question.length < 15) return false;

  // Answer should be substantive
  if (answer.length < 10) return false;

  // Reject metadata-contaminated
  if (containsMetadata(question)) return false;

  // Reject generic questions
  if (!passesGenericQuestionFilter(item)) return false;

  return true;
}

/**
 * Check if a long answer question has a meaningful question, answer, and key points.
 */
function passesLongAnswerQuality(item: Record<string, unknown>): boolean {
  const question = typeof item.question === "string" ? item.question : "";
  const answer = typeof item.answer === "string" ? item.answer : "";
  const keyPoints = Array.isArray(item.keyPoints) ? item.keyPoints : [];

  // Question should be substantial
  if (question.length < 20) return false;

  // Answer should be substantial
  if (answer.length < 30) return false;

  // Should have key points
  if (keyPoints.length < 2) return false;

  // Reject metadata-contaminated
  if (containsMetadata(question)) return false;

  // Reject generic questions
  if (!passesGenericQuestionFilter(item)) return false;

  return true;
}

// ── Definition quality check ───────────────────────────────────────────────

function passesDefinitionQuality(item: Record<string, unknown>): boolean {
  const term = typeof item.term === "string" ? item.term : "";
  const definition = typeof item.definition === "string" ? item.definition : "";

  // Term should be a meaningful term (not a sentence fragment)
  if (term.length < 2 || term.length > 80) return false;

  // Definition should be substantive
  if (definition.length < 10) return false;

  // Reject metadata-contaminated terms
  if (containsMetadata(term)) return false;

  return true;
}

// ── Formula quality check ──────────────────────────────────────────────────

function passesFormulaQuality(item: Record<string, unknown>): boolean {
  const formula = typeof item.formula === "string" ? item.formula : "";

  // Formula should not be a sentence
  if (formula.length > 100) return false;

  // Formula should contain mathematical content (at least one of: =, +, -, ×, variable)
  if (!/[=+\-×÷a-zA-Z]/.test(formula)) return false;

  // Reject metadata disguised as formulas
  if (containsMetadata(formula)) return false;

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
 * 4. Type-specific quality checks (MCQ, notes, flashcards, etc.)
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

  // Step 4: Type-specific quality checks
  switch (type) {
    case "mcq":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesMcqQuality(item as Record<string, unknown>);
      });
      break;

    case "notes":
    case "short_notes":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesNotesQuality(item as Record<string, unknown>);
      });
      break;

    case "flashcards":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesFlashcardQuality(item as Record<string, unknown>);
      });
      break;

    case "mindmap":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesMindmapQuality(item as Record<string, unknown>);
      });
      break;

    case "mnemonics":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesMnemonicQuality(item as Record<string, unknown>);
      });
      break;

    case "short_answer":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesShortAnswerQuality(item as Record<string, unknown>);
      });
      break;

    case "long_answer":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesLongAnswerQuality(item as Record<string, unknown>);
      });
      break;

    case "definitions":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesDefinitionQuality(item as Record<string, unknown>);
      });
      break;

    case "formulas":
      validated = validated.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return passesFormulaQuality(item as Record<string, unknown>);
      });
      break;

    case "true_false":
    case "fill_blank":
      // These use the generic quality filters already applied
      break;
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

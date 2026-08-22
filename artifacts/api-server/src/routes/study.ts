import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AskStudyDocumentBody,
  AskStudyDocumentResponse,
  DetectStudyTopicsBody,
  DetectStudyTopicsResponse,
  ExtractStudyMaterialResponse,
  GenerateStudyPackBody,
  GenerateStudyPackResponse,
} from "@workspace/api-zod";

import { cleanSourceText, cleaningStats } from "./study/clean";
import { normalizeExtractedText } from "./study/normalize";
import { buildPrompt } from "./study/prompts";
import { validateSection, typeLabels } from "./study/validate";
import {
  buildMathKnowledge,
  buildMathContext,
  repairMathSymbols,
  extractEquations,
  detectSubject,
  type Subject,
  type MathKnowledge,
} from "./study/math";

const router: IRouter = Router();
const MAX_SOURCE_CHARS = 220_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RETRIES = 2;
const API_RETRIES = 2;
const API_RETRY_BASE_MS = 2000;
const RATE_LIMIT_MAX_RETRIES = 3;
const DAILY_QUOTA_MAX_RETRIES = 0;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

// ── File upload middleware ────────────────────────────────────────────────────

const uploadFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "This file is larger than 20 MB. Upload a shorter chapter or paste the relevant section." });
      return;
    }
    if (error) {
      res.status(400).json({ error: error.message || "The file upload could not be read." });
      return;
    }
    next();
  });
};

// ── Gemini model accessor ────────────────────────────────────────────────────

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "CRAM AI needs GEMINI_API_KEY to generate content. Add it in the project's Keys/API keys tab and try again.",
    );
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  return new GoogleGenerativeAI(key).getGenerativeModel({ model });
}

// ── Retry-aware AI generation ───────────────────────────────────────────────

/**
 * Thrown when the Gemini API returns a daily/fixed quota exhaustion error.
 * Should NOT be retried — the quota won't recover within the session.
 */
export class QuotaExceededError extends Error {
  readonly retryAfter?: number;
  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = "QuotaExceededError";
    this.retryAfter = retryAfter;
  }
}

/** Detect HTTP 429 / rate-limit errors specifically. */
function isRateLimitError(msg: string): boolean {
  return /\b429\b/.test(msg) ||
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /quota exceeded/i.test(msg) ||
    /rate.?limit/i.test(msg) ||
    /requests per minute/i.test(msg) ||
    /requests per day/i.test(msg) ||
    /exceeded your current quota/i.test(msg);
}

/** Detect daily/unrecoverable quota errors (won't self-heal). */
function isDailyQuotaError(msg: string): boolean {
  return /requests per day/i.test(msg) ||
    /daily quota/i.test(msg) ||
    /quota has been exceeded/i.test(msg) ||
    /exceeded your daily/i.test(msg);
}

/** Detect transient server errors (502, 503, capacity, etc.). */
function isTransientServerError(msg: string): boolean {
  return /\b50[23]\b/.test(msg) ||
    /capacity/i.test(msg) ||
    /overloaded/i.test(msg) ||
    /UNAVAILABLE/i.test(msg) ||
    /service unavailable/i.test(msg) ||
    /temporarily at capacity/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract Retry-After delay from error message (in seconds). */
function extractRetryAfter(msg: string): number | undefined {
  const match = msg.match(/retry[_\s-]?after[:\s]*(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Add jitter to a delay value to prevent thundering herd.
 * Returns delay ± 25% with a minimum floor.
 */
function jitteredDelay(baseMs: number): number {
  const jitter = baseMs * 0.25;
  return Math.max(500, baseMs + (Math.random() * 2 * jitter - jitter));
}

async function generateWithRetry(
  model: ReturnType<typeof getModel>,
  prompt: string,
): Promise<string> {
  const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  let lastError: Error | null = null;
  let rateLimitRetries = 0;
  let serverRetries = 0;

  for (let attempt = 0; attempt <= API_RETRIES + RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(msg);

      // ── Daily / fixed quota exhaustion → do NOT retry ────────────────────
      if (isDailyQuotaError(msg)) {
        console.error(
          `[GEMINI] Daily quota exhausted — model=${modelName}, attempt=${attempt + 1}, retryCount=0`,
        );
        throw new QuotaExceededError(
          "Your Gemini API daily quota has been exhausted. Try again tomorrow, or increase your quota in Google AI Studio.",
        );
      }

      // ── HTTP 429 / rate limit → retry with backoff + jitter ─────────────
      if (isRateLimitError(msg) && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
        rateLimitRetries++;
        const retryAfter = extractRetryAfter(msg);
        const baseDelay = retryAfter
          ? retryAfter * 1000
          : API_RETRY_BASE_MS * Math.pow(2, rateLimitRetries - 1);
        const delay = jitteredDelay(baseDelay);
        console.warn(
          `[GEMINI] Rate limited (429) — model=${modelName}, attempt=${attempt + 1}, retryCount=${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES}, waitMs=${Math.round(delay)}`,
        );
        await sleep(delay);
        continue;
      }

      // ── Transient server error (502, 503, capacity) → retry with backoff ──
      if (isTransientServerError(msg) && serverRetries < API_RETRIES) {
        serverRetries++;
        const delay = jitteredDelay(API_RETRY_BASE_MS * Math.pow(2, serverRetries - 1));
        console.warn(
          `[GEMINI] Transient server error — model=${modelName}, status=${msg.match(/\b5\d{2}\b/)?.[0] ?? "unknown"}, attempt=${attempt + 1}, retryCount=${serverRetries}/${API_RETRIES}, waitMs=${Math.round(delay)}`,
        );
        await sleep(delay);
        continue;
      }

      // ── Non-retryable error → throw immediately ─────────────────────────
      console.error(
        `[GEMINI] Non-retryable error — model=${modelName}, attempt=${attempt + 1}, error=${msg.slice(0, 200)}`,
      );
      throw lastError;
    }
  }

  throw lastError ?? new Error("AI generation failed after retries");
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseModelJson(raw: string): unknown {
  // Strip markdown fences and whitespace
  let cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try to extract the first JSON object or array
  // Prefer array if the response starts with [
  if (cleaned.startsWith("[")) {
    const end = cleaned.lastIndexOf("]");
    if (end > 0) {
      try { return JSON.parse(cleaned.slice(0, end + 1)); } catch { /* fall through */ }
    }
  }

  // Try object extraction
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
  }

  // Last resort: try to fix common JSON issues
  try {
    // Replace single quotes with double quotes (common AI mistake)
    const fixed = cleaned
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, "$1"); // trailing commas
    const jsonStart = fixed.indexOf("{");
    const jsonEnd = fixed.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      return JSON.parse(fixed.slice(jsonStart, jsonEnd + 1));
    }
  } catch { /* give up */ }

  throw new Error("The AI returned an invalid response. Please try again.");
}

function sourceForPrompt(text: string): string {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 8_000) {
    chunks.push(`[SOURCE SECTION ${chunks.length + 1}]\n${text.slice(index, index + 8_000)}`);
  }
  return chunks.join("\n\n");
}

// ── Subject-aware summary builder ────────────────────────────────────────────

function buildSubjectSummary(knowledge: MathKnowledge): string {
  const parts: string[] = [];
  if (knowledge.subject !== "general") {
    parts.push(`Subject: ${knowledge.subject.charAt(0).toUpperCase() + knowledge.subject.slice(1)}`);
  }
  if (knowledge.gradeLevel) parts.push(knowledge.gradeLevel);
  if (knowledge.chapter) parts.push(`Chapter: ${knowledge.chapter}`);
  if (knowledge.topics.length) parts.push(`Topics: ${knowledge.topics.slice(0, 5).join(", ")}`);
  if (knowledge.equations.length) parts.push(`${knowledge.equations.length} equations detected`);
  if (knowledge.questionBank.isQuestionBank) {
    parts.push(`Question bank: ${knowledge.questionBank.mcqs.length} MCQs, ${knowledge.questionBank.questions.length} questions`);
  }
  return parts.join(" · ");
}

// ── AI generation with retry ─────────────────────────────────────────────────

/**
 * Generate content using a focused per-type prompt.
 * Retries up to MAX_RETRIES times on malformed output.
 */
async function generateWithType(
  type: string,
  text: string,
  difficulty: "easy" | "medium" | "detailed",
  language: string,
  topic: string | null,
  count: number,
  knowledge?: MathKnowledge | null,
): Promise<{ type: string; title: string; items: unknown[] }> {
  const model = getModel();
  const title = typeLabels[type] ?? type;

  // Build the source text for the prompt: use math context if subject is detected
  const sourceText = knowledge?.hasMathContent ? buildMathContext(text, knowledge) : text;
  const prompt = buildPrompt(type, sourceText, difficulty, language, topic, count, knowledge);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = parseModelJson(await generateWithRetry(model, prompt));

      // Extract the items array from the response
      let items: unknown[] = [];
      if (Array.isArray(raw)) {
        items = raw;
      } else if (raw && typeof raw === "object") {
        const record = raw as Record<string, unknown>;
        if (Array.isArray(record.items)) {
          items = record.items;
        }
        if (Array.isArray(record.questions)) {
          items = record.questions;
        }
      }

      // Validate, ground, and deduplicate
      const validated = validateSection(type, items, text);

      if (validated.length > 0) {
        return { type, title, items: validated };
      }

      if (attempt === MAX_RETRIES) {
        return { type, title, items: validated };
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Quota exhausted → stop immediately, do NOT retry validation loop
      if (err instanceof QuotaExceededError) {
        throw err;
      }

      // Rate limited → stop validation retries, return what we have
      if (isRateLimitError(errMsg)) {
        console.warn(
          `[STUDY] Stopping validation retries for "${type}" due to rate limit — returning partial results`,
        );
        return { type, title, items: [] };
      }

      // Detect token limit exceeded — truncate source and retry
      if (errMsg.includes("context") || errMsg.includes("token") || errMsg.includes("TOO_LONG") || errMsg.includes("max tokens")) {
        if (attempt < MAX_RETRIES) {
          continue;
        }
      }
      if (attempt === MAX_RETRIES) {
        throw new Error(`Study pack generation failed: ${errMsg.length > 200 ? errMsg.slice(0, 200) + "..." : errMsg}`);
      }
    }
  }

  return { type, title, items: [] };
}

// ── Demo mode helpers ────────────────────────────────────────────────────────

/**
 * Build topics for demo mode, including subject detection and math-specific topics.
 */
function demoTopics(text: string, knowledge?: MathKnowledge | null): string[] {
  const topics: string[] = [];

  // Use math knowledge if available
  if (knowledge) {
    if (knowledge.chapter) topics.push(knowledge.chapter);
    if (knowledge.topics.length) topics.push(...knowledge.topics);
    if (knowledge.concepts.length) topics.push(...knowledge.concepts.slice(0, 5));
    if (knowledge.subject !== "general") {
      topics.push(`${knowledge.subject.charAt(0).toUpperCase() + knowledge.subject.slice(1)} concepts`);
    }
  }

  // Also extract headings from text
  const headings = text
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 90 && !/[.!?]$/.test(line));
  topics.push(...headings);

  // Remove metadata-like headings
  const metadataWords = ["author", "prepared by", "school", "college", "university", "grade", "class", "total marks", "time", "section"];
  const filtered = [...new Set(topics)]
    .filter((t) => !metadataWords.some((mw) => t.toLowerCase().includes(mw)))
    .filter((t) => t.toLowerCase() !== "study material")
    .slice(0, 12);

  if (filtered.length === 0) filtered.push("Core concepts");
  return filtered;
}

/**
 * Math-aware demo items — generates structurally correct items without AI.
 */
/** Generate plausible distractors for MCQ options based on the subject */
function generateDistractors(keyTerm: string, correctConcept: string, subject: string): string[] {
  // Generic distractors that work across subjects
  const genericDistractors = [
    `A related concept that deals with a different aspect of ${keyTerm}`,
    `A misconception about ${keyTerm} that is commonly confused`,
    `An outdated understanding of ${keyTerm} that has been superseded`,
  ];

  // Subject-specific distractors
  if (subject === "mathematics") {
    return [
      `A similar equation involving different variables`,
      `A higher-degree polynomial that cannot be solved by the same method`,
      `An expression with different operators that changes the result`,
    ];
  }
  if (subject === "history") {
    return [
      `An event from a different time period that is often confused with this one`,
      `A figure from a related but distinct historical context`,
      `A consequence of a different cause that is commonly misattributed`,
    ];
  }
  if (subject === "biology" || subject === "physics" || subject === "chemistry") {
    return [
      `A similar process that occurs in a different context`,
      `A related concept with a different mechanism`,
      `A common misconception about this topic`,
    ];
  }
  return genericDistractors;
}

/** Get subject-appropriate question formats */
function getQuestionFormats(subject: string, term: string): { short: string; long: string } {
  switch (subject) {
    case "history":
      return {
        short: `What was the significance of ${term}?`,
        long: `Analyze the causes, events, and consequences of ${term}. How did it impact the broader historical context?`,
      };
    case "biology":
      return {
        short: `What is the function or role of ${term}?`,
        long: `Describe the structure, function, and significance of ${term}. Include examples and related processes.`,
      };
    case "physics":
    case "chemistry":
      return {
        short: `Explain the principle behind ${term}.`,
        long: `Derive and explain the mathematical relationship for ${term}. Include conditions, applications, and examples.`,
      };
    case "mathematics":
      return {
        short: `What conditions apply to ${term}?`,
        long: `Derive the mathematical conditions for ${term} and explain the reasoning behind each step.`,
      };
    case "english":
      return {
        short: `How is ${term} used in the text?`,
        long: `Analyze the use of ${term} in the text. What is its significance and how does it contribute to the overall meaning?`,
      };
    default:
      return {
        short: `What is ${term} and why is it important?`,
        long: `Discuss ${term} in detail, including its definition, significance, and relationship to other concepts in the material.`,
      };
  }
}

/** Negate a statement for true/false questions */
function negateStatement(sentence: string): string {
  // Simple negation: add "not" or flip positive/negative
  if (/\bis\s/i.test(sentence)) {
    return sentence.replace(/\bis\s/i, "is not ");
  }
  if (/\bare\s/i.test(sentence)) {
    return sentence.replace(/\bare\s/i, "are not ");
  }
  if (/\bwas\s/i.test(sentence)) {
    return sentence.replace(/\bwas\s/i, "was not ");
  }
  if (/\bwill\s/i.test(sentence)) {
    return sentence.replace(/\bwill\s/i, "will not ");
  }
  if (/\bcan\s/i.test(sentence)) {
    return sentence.replace(/\bcan\s/i, "cannot ");
  }
  // Fallback: prepend "It is incorrect that"
  return `It is incorrect that ${sentence.charAt(0).toLowerCase() + sentence.slice(1)}`;
}

function demoItems(type: string, count: number, text: string, topic?: string | null, knowledge?: MathKnowledge | null): unknown[] {
  const items: unknown[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
  const eqs = knowledge?.equations ?? extractEquations(text);
  const isMath = knowledge?.hasMathContent ?? (eqs.length > 0);
  const subject = knowledge?.subject ?? "general";

  // Filter out metadata-contaminated sentences (ISBN, price, publisher, etc.)
  const metadataReject = /^(?:isbn|price|mrp|copyright|all rights reserved|printed (?:in|on)|published (?:in|by)|edition|version|author|prepared by|grade \d|class \d|total marks|time:|section:|semester|session|academic year|enrollment|roll no|register no|batch:|school of|college of|university|institute of|department of|contact:|email:|phone:|website:|www\.|\d+ marks|\d+ minutes|\d+ questions)/i;
  const cleanSentences = sentences.filter((s) => !metadataReject.test(s) && !/^\d[\d\s\-]{8,}$/.test(s.trim()));

  // Focus sentences on the topic
  const focused = topic
    ? cleanSentences.filter((s) => s.toLowerCase().includes(topic.toLowerCase()))
    : [];
  const sourceSentences = [...focused, ...cleanSentences];

  // Extract meaningful key terms/concepts from the source
  const keyConcepts = knowledge?.concepts.length ? knowledge.concepts : sourceSentences;
  const chapterLabel = knowledge?.chapter || topic || "Source material";

  if (type === "notes" || type === "short_notes") {
    const noteTopics = knowledge?.concepts.length
      ? knowledge.concepts
      : sourceSentences.length
        ? sourceSentences
        : [`Key concept`];

    for (let i = 0; i < Math.min(count, Math.max(1, noteTopics.length)); i++) {
      const noteSource = noteTopics[i] ?? noteTopics[0] ?? "This concept";
      const isFormula = /[_=+\-*/^√∑∫≤≥≠]/.test(noteSource);

      if (isMath && isFormula) {
        items.push({
          heading: `Mathematical relationship ${i + 1}`,
          content: noteSource,
          sourceReference: knowledge?.chapter || "Source material",
        });
      } else {
        items.push({
          heading: topic || noteSource.slice(0, 60),
          content: noteSource.length > 20 ? noteSource : `Understanding of ${noteSource}`,
          sourceReference: knowledge?.chapter || "Source material",
        });
      }
    }
  } else if (type === "mcq") {
    if (isMath && eqs.length > 0) {
      // Generate math-aware MCQ structure with meaningful questions
      for (let i = 0; i < Math.min(count, eqs.length); i++) {
        const eq = eqs[i];
        const vars = eq.variables.length > 0 ? eq.variables : ["x", "y"];
        // Create a question about the equation's type and structure
        const typeLabel = eq.type === "system_of_equations" ? "system of equations"
          : eq.type === "inequality" ? "inequality"
          : eq.type === "equation" ? "equation"
          : "expression";
        items.push({
          question: `What type of mathematical object is: ${eq.expression}?`,
          options: [
            typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1),
            "Inequality",
            "Function definition",
            "Logical statement",
          ],
          correctAnswer: typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1),
          explanation: `The expression ${eq.expression} is a ${typeLabel}${eq.operators.length > 0 ? ` containing operators ${eq.operators.join(", ")}` : ""} and variables ${vars.join(", ")}.`,
          sourceReference: knowledge?.chapter || "Source material",
          topic: topic || "Mathematical analysis",
          difficulty: "easy",
        });
      }
    }
    // Non-math or remaining MCQs: generate genuine concept-testing questions
    const remaining = count - items.length;
    for (let i = 0; i < Math.min(remaining, keyConcepts.length); i++) {
      const concept = keyConcepts[i] ?? sourceSentences[i] ?? text.slice(0, 200);
      // Extract the key term from the concept
      const words = concept.split(/\s+/).filter(w => w.length > 4);
      const keyTerm = words[0] ?? "this concept";
      // Generate meaningful distractors based on the subject
      const distractors = generateDistractors(keyTerm, concept, subject);
      items.push({
        question: `Which statement best describes ${keyTerm}?`,
        options: [
          concept.slice(0, 120),
          ...distractors,
        ],
        correctAnswer: concept.slice(0, 120),
        explanation: `${keyTerm} is described in the source as: ${concept.slice(0, 150)}.`,
        sourceReference: chapterLabel,
        topic: topic || chapterLabel,
        difficulty: "medium",
      });
    }
  } else if (type === "flashcards") {
    for (let i = 0; i < Math.min(count, Math.max(1, keyConcepts.length)); i++) {
      const concept = keyConcepts[i] ?? sourceSentences[i] ?? "Key concept";
      if (isMath && /[_=+\-*/^≤≥≠]/.test(concept)) {
        // For equations: front asks about the equation, back = the equation
        items.push({
          front: `Write the mathematical expression for this relationship`,
          back: concept,
          topic: chapterLabel,
          sourceReference: chapterLabel,
        });
      } else {
        // For concepts: front = specific question, back = concise answer
        const words = concept.split(/\s+/).filter(w => w.length > 3);
        const term = words[0] ?? "this concept";
        // Make the back concise
        const backText = concept.length > 120 ? concept.slice(0, 120) + "..." : concept;
        items.push({
          front: `What is ${term}?`,
          back: backText,
          topic: chapterLabel,
          sourceReference: chapterLabel,
        });
      }
    }
  } else if (type === "short_answer") {
    for (let i = 0; i < Math.min(count, keyConcepts.length); i++) {
      const concept = keyConcepts[i] ?? sourceSentences[i] ?? text.slice(0, 200);
      const words = concept.split(/\s+/).filter(w => w.length > 3);
      const term = words[0] ?? "this concept";
      const questionFormats = getQuestionFormats(subject, term);
      items.push({
        question: questionFormats.short,
        answer: concept.length > 250 ? concept.slice(0, 250) : concept,
        sourceReference: chapterLabel,
        topic: topic || chapterLabel,
      });
    }
  } else if (type === "long_answer") {
    for (let i = 0; i < Math.min(count, keyConcepts.length); i++) {
      const concept = keyConcepts[i] ?? sourceSentences[i] ?? text.slice(0, 200);
      const words = concept.split(/\s+/).filter(w => w.length > 3);
      const term = words[0] ?? "this concept";
      const questionFormats = getQuestionFormats(subject, term);
      items.push({
        question: questionFormats.long,
        answer: concept.length > 300 ? concept.slice(0, 300) : concept,
        keyPoints: [concept.slice(0, 100), `${term} as described in the source`],
        sourceReference: chapterLabel,
        topic: topic || chapterLabel,
      });
    }
  } else if (type === "true_false") {
    // Mix true and false statements for better testing
    for (let i = 0; i < Math.min(count, sourceSentences.length); i++) {
      const sentence = sourceSentences[i] ?? text.slice(0, 200);
      const isTrue = i % 3 !== 0; // roughly 2/3 true, 1/3 false
      const statement = isTrue ? sentence : negateStatement(sentence);
      items.push({
        statement,
        answer: isTrue,
        explanation: isTrue
          ? "This is directly stated in the source material."
          : "The source material indicates otherwise — the correct information differs from this statement.",
        sourceReference: chapterLabel,
      });
    }
  } else if (type === "fill_blank") {
    for (let i = 0; i < Math.min(count, sourceSentences.length); i++) {
      const sentence = sourceSentences[i] ?? text.slice(0, 200);
      // Find a meaningful word to blank out (not articles, prepositions)
      const words = sentence.split(/\s+/);
      const significantWords = words.filter(w => w.length > 5 && !/^(?:the|and|that|this|with|from|which|their|were|been|have|does|will|would|could|should|may|might|must|shall|also|into|over|such|only|than|more|most|very|just|also)$/i.test(w.replace(/[,.!?;:]$/, "")));
      const answer = significantWords[0]?.replace(/[,.!?;:]$/, "") ?? words[words.length - 1]?.replace(/[,.!?;:]$/, "") ?? "concept";
      items.push({
        question: sentence.replace(new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), "_____"),
        answer,
        sourceReference: chapterLabel,
      });
    }
  } else if (type === "quiz") {
    items.push({ type: "short_answer" as const, question: `Summarize the key concepts in this material.`, answer: text.slice(0, 200) });
  } else if (type === "mindmap") {
    const branches = knowledge?.concepts.length ? knowledge.concepts : [topic || "Study material"];
    for (let i = 0; i < Math.min(count, Math.max(1, branches.length)); i++) {
      const branchText = branches[i] ?? `Topic ${i + 1}`;
      // Keep branch labels SHORT (1-3 words max)
      const shortBranch = branchText.split(/\s+/).slice(0, 3).join(" ");
      // Create short child labels from subsequent concepts
      const childStart = (i + 1) * 2;
      const childConcepts = branches.slice(childStart, childStart + 3)
        .map(c => c.split(/\s+/).slice(0, 4).join(" "));
      items.push({
        branch: shortBranch,
        children: childConcepts.length > 0 ? childConcepts : ["sub-topic 1", "sub-topic 2"],
        sourceReference: knowledge?.chapter || "Source material",
      });
    }
  } else if (type === "definitions") {
    for (let i = 0; i < Math.min(count, keyConcepts.length); i++) {
      const concept = keyConcepts[i] ?? sourceSentences[i] ?? "Key term";
      // Extract just the term from the concept
      const words = concept.split(/\s+/).filter(w => w.length > 3);
      const term = words[0] ?? "Key term";
      items.push({
        term: term.length > 60 ? term.slice(0, 60) : term,
        definition: concept.length > 200 ? concept.slice(0, 200) : concept,
        sourceReference: chapterLabel,
      });
    }
  } else if (type === "formulas") {
    if (isMath) {
      for (let i = 0; i < Math.min(count, Math.max(1, eqs.length)); i++) {
        const eq = eqs[i];
        items.push({
          formula: eq.expression,
          name: `${eq.type.replace(/_/g, " ")} involving ${eq.variables.join(", ") || "variables"}`,
          variables: eq.variables.map((v) => ({ symbol: v, meaning: `Variable in the expression` })),
          sourceReference: knowledge?.chapter || "Source material",
        });
      }
    } else {
      items.push({ formula: "No mathematical formulas found in this material", name: "Note", variables: [], sourceReference: "Source material" });
    }
  } else if (type === "difficult_words") {
    for (let i = 0; i < Math.min(count, sourceSentences.length); i++) {
      const sentence = sourceSentences[i] ?? text.slice(0, 200);
      const word = sentence.split(/\s+/).find((w) => w.length > 8 && !metadataReject.test(w))?.replace(/[,.!?;:]$/, "") ?? "concept";
      items.push({ word, meaning: sentence.length > 150 ? sentence.slice(0, 150) : sentence, sourceReference: chapterLabel });
    }
  } else if (type === "mnemonics") {
    // Smart mnemonic generation: only generate when genuinely useful
    if (isMath) {
      if (knowledge?.conditions && knowledge.conditions.length > 0) {
        items.push({
          fact: knowledge.conditions[0],
          trick: "Use ratio comparison to remember conditions",
          whyItWorks: "Visual patterns are easier to memorize than abstract rules",
          sourceReference: knowledge?.chapter || "Source material",
        });
      } else {
        items.push({
          fact: "Mathematical rules and formulas",
          trick: "Understanding the derivation is more reliable than memorizing the formula",
          whyItWorks: "For mathematics, comprehension beats memorization",
          sourceReference: "Source material",
        });
      }
    } else {
      // Only generate mnemonics for genuinely difficult-to-memorize content
      const hasListContent = sourceSentences.some(s => /(?:first|second|third|1\.|2\.|3\.|a\)|b\)|c\))/i.test(s));
      if (hasListContent && sourceSentences.length > 2) {
        items.push({
          fact: sourceSentences[0]?.slice(0, 100) ?? "Key concept",
          trick: `Try connecting this concept to something familiar`,
          sourceReference: chapterLabel,
        });
      } else {
        items.push({
          fact: "This concept",
          trick: "No mnemonic needed — this is better learned through understanding the concept itself",
          sourceReference: chapterLabel,
        });
      }
    }
  } else {
    items.push({ content: sourceSentences[0] ?? text.slice(0, 200) });
  }

  return items.slice(0, count);
}

function demoPack(text: string, types: string[], count: number, topic?: string | null, knowledge?: MathKnowledge | null) {
  const subjectLabel = knowledge?.subject && knowledge.subject !== "general"
    ? ` — ${knowledge.subject.charAt(0).toUpperCase() + knowledge.subject.slice(1)}`
    : "";

  const summaryParts = ["Demo mode is active because GEMINI_API_KEY is not configured."];
  if (knowledge?.hasMathContent) {
    summaryParts.push("Mathematical content detected. Equations and structures are identified in the source.");
  }
  if (knowledge?.questionBank.isQuestionBank) {
    summaryParts.push(`Question bank detected with ${knowledge.questionBank.mcqs.length} existing MCQs.`);
  }
  summaryParts.push("These are structured previews based on your uploaded text.");

  return GenerateStudyPackResponse.parse({
    title: `CRAM AI study pack${subjectLabel}`,
    summary: summaryParts.join(" "),
    topics: demoTopics(text, knowledge),
    sections: types.map((type) => ({
      type,
      title: typeLabels[type] ?? type,
      items: demoItems(type, count, text, topic, knowledge),
    })),
  });
}

function demoChat(text: string, question: string, knowledge?: MathKnowledge | null) {
  // For math subjects, give a more helpful demo response
  if (knowledge?.hasMathContent) {
    const eqs = knowledge.equations;
    if (eqs.length > 0) {
      return `Demo mode: This material contains ${eqs.length} mathematical expression(s). For full AI-powered solving and explanation of mathematical questions, configure GEMINI_API_KEY.`;
    }
  }

  const questionWords = question.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const sentence =
    text.split(/(?<=[.!?])\s+/).find((candidate) => questionWords.some((word) => candidate.toLowerCase().includes(word))) ??
    text.split(/(?<=[.!?])\s+/).find(Boolean) ??
    text.slice(0, 300);
  return `Demo mode answer, grounded in your document: ${sentence}`;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

router.post("/study/extract", uploadFile, async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Choose a PDF, DOCX, TXT, or MD file to upload." });
    return;
  }

  const lowerName = file.originalname.toLowerCase();
  let text = "";
  try {
    if (lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
      text = file.buffer.toString("utf8");
    } else if (lowerName.endsWith(".pdf")) {
      text = (await pdfParse(file.buffer)).text;
    } else if (lowerName.endsWith(".docx")) {
      text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } else {
      res.status(415).json({ error: "Unsupported file type. Use PDF, DOCX, TXT, or MD." });
      return;
    }
  } catch (error) {
    req.log.warn({ error, fileName: file.originalname }, "Study document extraction failed");
    res.status(422).json({ error: "The document could not be read. Scanned PDFs need OCR before upload." });
    return;
  }

  // Step 1: Repair Unicode math symbols before normalization
  const repairedText = repairMathSymbols(text);

  // Step 2: Normalize extracted text (word-boundary reconstruction, paragraph repair)
  const { text: normalizedText, quality } = normalizeExtractedText(repairedText);
  req.log.info({ fileName: file.originalname, quality }, "Text normalization complete");

  // Step 3: Clean the normalized text: strip metadata, noise, repeated headings
  const cleaned = cleanSourceText(normalizedText);
  const stats = cleaningStats(normalizedText, cleaned);
  req.log.info({ fileName: file.originalname, ...stats }, "Source text cleaning complete");

  if (!cleaned) {
    res.status(422).json({ error: "No readable text was found. Scanned PDFs and image-only documents need OCR." });
    return;
  }
  if (cleaned.length > MAX_SOURCE_CHARS) {
    res.status(413).json({ error: "This document is too long for one study pack. Upload one chapter at a time (maximum 220,000 characters)." });
    return;
  }

  // Step 4: Detect subject and build math knowledge
  const knowledge = buildMathKnowledge(cleaned);
  req.log.info({ subject: knowledge.subject, hasMath: knowledge.hasMathContent, eqCount: knowledge.equations.length }, "Subject detection complete");

  const parsedResponse = ExtractStudyMaterialResponse.parse({
    name: file.originalname,
    text: cleaned,
    characters: cleaned.length,
    truncated: false,
  });

  res.json({
    ...parsedResponse,
    qualityMessage: quality.qualityMessage,
    wasCorrupted: quality.wasCorrupted,
    reconstructionApplied: quality.reconstructionApplied,
    subject: knowledge.subject,
    hasMathContent: knowledge.hasMathContent,
    gradeLevel: knowledge.gradeLevel,
    chapter: knowledge.chapter,
    isQuestionBank: knowledge.questionBank.isQuestionBank,
  });
});

router.post("/study/topics", async (req, res): Promise<void> => {
  const parsed = DetectStudyTopicsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add at least 20 characters of study material." });
    return;
  }

  // Build math knowledge for subject-aware topic detection
  const knowledge = buildMathKnowledge(parsed.data.text);

  if (!process.env.GEMINI_API_KEY) {
    res.json(DetectStudyTopicsResponse.parse({ topics: demoTopics(parsed.data.text, knowledge) }));
    return;
  }

  try {
    const model = getModel();

    // Build subject-aware topic detection prompt
    const subjectContext = knowledge.subject !== "general"
      ? `\nThis is a ${knowledge.subject} document. Focus on ${knowledge.subject}-specific topics.`
      : "";
    const mathContext = knowledge.hasMathContent && knowledge.equations.length > 0
      ? `\nThis document contains mathematical equations and expressions. Include mathematical topics in your analysis.`
      : "";
    const questionBankContext = knowledge.questionBank.isQuestionBank
      ? `\nThis is a question bank. Identify topics covered by the questions, not the questions themselves.`
      : "";

    const topicsText = await generateWithRetry(model,
      `You are an expert academic content analyst.${subjectContext}${mathContext}${questionBankContext}

TASK: Analyze the study material below and identify its hierarchical structure.

INSTRUCTIONS:
1. First, identify the overall subject and chapter/document title.
2. Then identify major topics, subtopics, and key concepts.
3. Focus on educational content: concepts, processes, relationships, definitions, formulas.
4. Ignore metadata: author names, school info, page numbers, headers/footers.
5. Preserve the source's own terminology and ordering.
6. For mathematical content, include topics like specific equation types, mathematical conditions, and theorem names.
7. For question banks, focus on the CONCEPTS being tested, not the question format.

OUTPUT: Return JSON only:
{"topics":["topic 1","topic 2", ...]}

Return 3 to 20 concise topics in the order they appear, without duplicates.
Topics should be specific enough to be useful for focused study (e.g. "Pair of Linear Equations - Conditions for Solutions" not just "Mathematics").

STUDY MATERIAL:
${sourceForPrompt(parsed.data.text)}`,
    );
    const raw = parseModelJson(topicsText);
    const rawTopics =
      raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).topics)
        ? ((raw as Record<string, unknown>).topics as unknown[])
        : [];
    const topics = rawTopics.filter((topic: unknown): topic is string => typeof topic === "string").slice(0, 20);
    res.json(DetectStudyTopicsResponse.parse({ topics }));
  } catch (error) {
    req.log.error({ error }, "Topic detection failed");

    if (error instanceof QuotaExceededError) {
      res.status(429).json({ error: error.message, quotaExhausted: true });
      return;
    }

    const errMsg = error instanceof Error ? error.message : "Topic detection failed.";
    if (isRateLimitError(errMsg)) {
      res.status(429).json({ error: "Gemini API rate limit reached. Wait a moment and try again.", retryable: true });
      return;
    }

    res.status(503).json({ error: errMsg });
  }
});

router.post("/study/generate", async (req, res): Promise<void> => {
  const parsed = GenerateStudyPackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check your study material, output formats, language, difficulty, and item count." });
    return;
  }

  const { text, types, count, language, difficulty, topic } = parsed.data;

  // Build math knowledge for subject-aware generation
  const knowledge = buildMathKnowledge(text);

  if (!process.env.GEMINI_API_KEY) {
    res.json(demoPack(text, types, count, topic, knowledge));
    return;
  }

  try {
    // Generate each type with its own focused prompt and validation.
    // Use sequential generation to avoid hammering the API with parallel requests,
    // which triggers cascading 429s.
    const sections: Awaited<ReturnType<typeof generateWithType>>[] = [];
    let quotaExhausted = false;

    for (const type of types) {
      if (quotaExhausted) {
        // Skip remaining types — quota is already exhausted
        sections.push({ type, title: typeLabels[type] ?? type, items: [] });
        continue;
      }
      try {
        const section = await generateWithType(
          type, text, difficulty, language, topic ?? null, count, knowledge,
        );
        sections.push(section);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          quotaExhausted = true;
          sections.push({ type, title: typeLabels[type] ?? type, items: [] });
          // Let remaining types fill in as empty and break
        } else {
          throw err;
        }
      }
    }

    // Build topic list
    let topics: string[] = [];
    try {
      const model = getModel();
      const topicContext = knowledge.hasMathContent
        ? `\nThis is a ${knowledge.subject} document. Focus on ${knowledge.subject}-specific topics.`
        : "";
      const questionBankContext = knowledge.questionBank.isQuestionBank
        ? `\nThis is a question bank. Focus on concepts, not question format.`
        : "";
      const autoTopicsText = await generateWithRetry(model,
        `Identify 5-15 major topics from this study material.${topicContext}${questionBankContext}\nReturn JSON only: {"topics":["topic1","topic2"]}\n\nSTUDY MATERIAL:\n${sourceForPrompt(text.slice(0, 16000))}`,
      );
      const raw = parseModelJson(autoTopicsText);
      if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).topics)) {
        topics = ((raw as Record<string, unknown>).topics as unknown[])
          .filter((t): t is string => typeof t === "string")
          .slice(0, 20);
      }
    } catch {
      // If topic generation fails, continue without topics
    }

    // Build a subject-aware summary
    const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
    const subjectInfo = buildSubjectSummary(knowledge);
    const summaryParts: string[] = [];
    if (subjectInfo) summaryParts.push(subjectInfo);
    if (topic) {
      summaryParts.push(`Focused on "${topic}" with ${totalItems} items across ${types.length} formats.`);
    } else {
      summaryParts.push(`Complete study pack with ${totalItems} source-grounded items across ${types.length} formats.`);
    }
    const summary = summaryParts.join(" — ");

    const subjectLabel = knowledge.subject !== "general" && knowledge.chapter
      ? `${knowledge.chapter} — ${knowledge.subject.charAt(0).toUpperCase() + knowledge.subject.slice(1)}`
      : topic
        ? `Study Pack: ${topic}`
        : "CRAM AI Study Pack";

    res.json(
      GenerateStudyPackResponse.parse({
        title: subjectLabel,
        summary,
        topics,
        sections,
      }),
    );
  } catch (error) {
    req.log.error({ error }, "Study pack generation failed");

    // Quota exhaustion → clear 429 with user-friendly message
    if (error instanceof QuotaExceededError) {
      res.status(429).json({
        error: error.message,
        quotaExhausted: true,
      });
      return;
    }

    // Rate limited (non-daily) → hint to retry
    const errMsg = error instanceof Error ? error.message : "Generation failed.";
    if (isRateLimitError(errMsg)) {
      res.status(429).json({
        error: "Gemini API rate limit reached. Wait a moment and try again.",
        retryable: true,
      });
      return;
    }

    res.status(503).json({
      error: errMsg.length > 300 ? errMsg.slice(0, 300) + "..." : errMsg,
    });
  }
});

router.post("/study/chat", async (req, res): Promise<void> => {
  const parsed = AskStudyDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add study material and a question." });
    return;
  }

  const knowledge = buildMathKnowledge(parsed.data.text);

  if (!process.env.GEMINI_API_KEY) {
    res.json(AskStudyDocumentResponse.parse({ answer: demoChat(parsed.data.text, parsed.data.question, knowledge) }));
    return;
  }

  try {
    const model = getModel();
    const sourceText = knowledge.hasMathContent
      ? buildMathContext(parsed.data.text, knowledge)
      : parsed.data.text;

    // Build subject-aware chat prompt
    const mathInstructions = knowledge.hasMathContent
      ? `\nIMPORTANT: This is a ${knowledge.subject} document.
- When answering mathematical questions, SHOW the mathematical reasoning step by step.
- Preserve equation notation exactly as given.
- For solving problems, show: Given → Required → Substitution → Solution → Answer.
- Do NOT copy the question text as the answer. Actually solve/explain it.
- For parameter-based equations, apply the correct mathematical conditions.`
      : "";

    const chatText = await generateWithRetry(model,
      `You are a source-grounded study tutor.${mathInstructions}

TASK: Answer the student's question using ONLY the uploaded study material below.

RULES:
1. Base your answer entirely on the source material.
2. If the answer is not found in the document, clearly state: "This is not found in the uploaded material."
3. Never invent facts, examples, or details not in the source.
4. Cite the relevant concept or section name when available.
5. Be thorough but concise.
6. If the question is ambiguous, address the most likely interpretation and note the ambiguity.
7. For mathematical questions: show the mathematical working, not just the final answer.

OUTPUT: Return JSON only: {"answer":"..."}

COMPLETE STUDY MATERIAL:
${sourceForPrompt(sourceText)}

QUESTION:
${parsed.data.question}`,
    );
    const parsedResponse = parseModelJson(chatText);
    const answer =
      parsedResponse &&
      typeof parsedResponse === "object" &&
      typeof (parsedResponse as Record<string, unknown>).answer === "string"
        ? (parsedResponse as Record<string, unknown>).answer
        : chatText;
    res.json(AskStudyDocumentResponse.parse({ answer }));
  } catch (error) {
    req.log.error({ error }, "Document chat failed");

    if (error instanceof QuotaExceededError) {
      res.status(429).json({ error: error.message, quotaExhausted: true });
      return;
    }

    const errMsg = error instanceof Error ? error.message : "Document chat failed.";
    if (isRateLimitError(errMsg)) {
      res.status(429).json({ error: "Gemini API rate limit reached. Wait a moment and try again.", retryable: true });
      return;
    }

    res.status(503).json({ error: errMsg });
  }
});

export default router;

import { z } from "zod";

// ── Tolerant primitives ──────────────────────────────────────────────────────
// AI models frequently return semantically-valid values in slightly different
// shapes ("True" instead of true, option objects {A: "..."}, difficulty "hard").
// Strict schemas silently drop every such item, which made whole sections
// (MCQs, True/False, Mind Maps) come back empty. These coercions normalize
// equivalent shapes WITHOUT accepting lower-quality content.

/** Coerce boolean-like values ("true", "True", "T", "F", 1, 0) to boolean. */
const booleanLike = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "t", "yes", "1"].includes(s)) return true;
    if (["false", "f", "no", "0"].includes(s)) return false;
  }
  return v;
}, z.boolean());

/** Flatten an option object ({A: "...", B: "..."} or {text: "..."}) to a string. */
function optionToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const rec = v as Record<string, unknown>;
    for (const key of ["text", "value", "option", "label", "content", "A", "B", "C", "D", "a", "b", "c", "d"]) {
      const val = rec[key];
      if (typeof val === "string" && val.trim()) return val;
    }
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Normalize the options array: objects → strings, numbers → strings, strip "A) " prefixes kept as-is. */
const optionsArray = z.preprocess((v) => {
  if (!Array.isArray(v)) return v;
  return v.map(optionToString).filter((s: string) => s.trim().length > 0);
}, z.array(z.string()).min(2, "MCQ must have at least 2 options").max(8, "MCQ must have at most 8 options"));

/** Accept any difficulty label, normalizing common synonyms to the known enum. */
const difficultyEnum = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (["hard", "difficult", "tough", "deep", "detailed"].includes(s)) return "detailed";
  if (["moderate", "normal", "standard", "mid"].includes(s)) return "medium";
  if (["simple", "gentle", "basic", "beginner"].includes(s)) return "easy";
  return s;
}, z.enum(["easy", "medium", "detailed"]).optional());

/** Flatten mind-map children: nested branch objects → their label string. */
const mindmapChildren = z.preprocess((v) => {
  if (!Array.isArray(v)) return v;
  return v
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object") {
        const rec = c as Record<string, unknown>;
        for (const key of ["branch", "label", "title", "name", "text", "topic", "node"]) {
          const val = rec[key];
          if (typeof val === "string" && val.trim()) return val;
        }
      }
      if (typeof c === "number") return String(c);
      return "";
    })
    .filter((s: string) => s.trim().length > 0);
}, z.array(z.string()).min(1, "Mind map branch must have at least one child"));

// ── MCQ ──────────────────────────────────────────────────────────────────────
export const McqItemSchema = z.object({
  question: z.string().min(1, "MCQ must have a question"),
  options: optionsArray,
  correctAnswer: z.preprocess(
    (v) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : v),
    z.string().min(1, "MCQ must identify the correct answer"),
  ),
  explanation: z.string().optional(),
  sourceReference: z.string().optional(),
  topic: z.string().optional(),
  difficulty: difficultyEnum,
});
export type McqItem = z.infer<typeof McqItemSchema>;

// ── Notes (detailed) ─────────────────────────────────────────────────────────
export const NoteItemSchema = z.object({
  heading: z.string().min(1),
  content: z.string().min(1),
  sourceReference: z.string().optional(),
});
export type NoteItem = z.infer<typeof NoteItemSchema>;

// ── Short answer ─────────────────────────────────────────────────────────────
export const ShortAnswerItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sourceReference: z.string().optional(),
  topic: z.string().optional(),
});
export type ShortAnswerItem = z.infer<typeof ShortAnswerItemSchema>;

// ── Long answer ──────────────────────────────────────────────────────────────
export const LongAnswerItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  keyPoints: z.array(z.string()).optional(),
  sourceReference: z.string().optional(),
  topic: z.string().optional(),
});
export type LongAnswerItem = z.infer<typeof LongAnswerItemSchema>;

// ── True / False ─────────────────────────────────────────────────────────────
export const TrueFalseItemSchema = z.object({
  statement: z.string().min(1),
  answer: booleanLike,
  explanation: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type TrueFalseItem = z.infer<typeof TrueFalseItemSchema>;

// ── Fill in the blank ────────────────────────────────────────────────────────
export const FillBlankItemSchema = z.object({
  question: z.string().min(1),
  answer: z.preprocess(
    (v) => (typeof v === "string" || typeof v === "number" ? String(v) : v),
    z.string().min(1),
  ),
  hint: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type FillBlankItem = z.infer<typeof FillBlankItemSchema>;

// ── Flashcard ────────────────────────────────────────────────────────────────
export const FlashcardItemSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  topic: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type FlashcardItem = z.infer<typeof FlashcardItemSchema>;

// ── Mind map ─────────────────────────────────────────────────────────────────
export const MindmapItemSchema = z.object({
  branch: z.preprocess(
    (v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const rec = v as Record<string, unknown>;
        for (const key of ["label", "title", "name", "text", "topic"]) {
          const val = rec[key];
          if (typeof val === "string" && val.trim()) return val;
        }
      }
      if (typeof v === "number") return String(v);
      return v;
    },
    z.string().min(1),
  ),
  children: mindmapChildren,
  sourceReference: z.string().optional(),
});
export type MindmapItem = z.infer<typeof MindmapItemSchema>;

// ── Definition ───────────────────────────────────────────────────────────────
export const DefinitionItemSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  example: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type DefinitionItem = z.infer<typeof DefinitionItemSchema>;

// ── Formula ──────────────────────────────────────────────────────────────────
export const FormulaItemSchema = z.object({
  formula: z.string().min(1),
  name: z.string().min(1),
  variables: z.preprocess((v) => {
    if (!Array.isArray(v)) return v;
    return v.map((item) => {
      if (item && typeof item === "object") return item;
      if (typeof item === "string" || typeof item === "number") {
        return { symbol: String(item), meaning: "" };
      }
      return item;
    }).filter((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).symbol === "string");
  }, z.array(z.object({ symbol: z.string(), meaning: z.string() }))),
  conditions: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type FormulaItem = z.infer<typeof FormulaItemSchema>;

// ── Difficult words ──────────────────────────────────────────────────────────
export const DifficultWordItemSchema = z.object({
  word: z.string().min(1),
  meaning: z.string().min(1),
  example: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type DifficultWordItem = z.infer<typeof DifficultWordItemSchema>;

// ── Mnemonics ────────────────────────────────────────────────────────────────
export const MnemonicItemSchema = z.object({
  fact: z.string().min(1),
  trick: z.string().min(1),
  whyItWorks: z.string().optional(),
  recallCue: z.string().optional(),
  sourceReference: z.string().optional(),
});
export type MnemonicItem = z.infer<typeof MnemonicItemSchema>;

// ── Quiz (mixed) ─────────────────────────────────────────────────────────────
export const QuizItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mcq"), question: z.string(), options: optionsArray, correctAnswer: z.string(), explanation: z.string() }),
  z.object({ type: z.literal("short_answer"), question: z.string(), answer: z.string() }),
  z.object({ type: z.literal("true_false"), statement: z.string(), answer: booleanLike, explanation: z.string() }),
  z.object({ type: z.literal("fill_blank"), question: z.string(), answer: z.string() }),
]);
export type QuizItem = z.infer<typeof QuizItemSchema>;

// ── Union map: type → schema ─────────────────────────────────────────────────
export const STUDY_ITEM_SCHEMAS = {
  notes: NoteItemSchema,
  short_notes: NoteItemSchema,
  mcq: McqItemSchema,
  short_answer: ShortAnswerItemSchema,
  long_answer: LongAnswerItemSchema,
  true_false: TrueFalseItemSchema,
  fill_blank: FillBlankItemSchema,
  flashcards: FlashcardItemSchema,
  quiz: QuizItemSchema,
  mindmap: MindmapItemSchema,
  definitions: DefinitionItemSchema,
  formulas: FormulaItemSchema,
  difficult_words: DifficultWordItemSchema,
  mnemonics: MnemonicItemSchema,
} as const;

export type StudyItemType = keyof typeof STUDY_ITEM_SCHEMAS;

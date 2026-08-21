import { z } from "zod";

// ── MCQ ──────────────────────────────────────────────────────────────────────
export const McqItemSchema = z.object({
  question: z.string().min(1, "MCQ must have a question"),
  options: z.array(z.string()).length(4, "MCQ must have exactly 4 options"),
  correctAnswer: z.string().min(1, "MCQ must identify the correct answer"),
  explanation: z.string().min(1, "MCQ must explain why the answer is correct"),
  sourceReference: z.string().optional(),
  topic: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "detailed"]).optional(),
});
export type McqItem = z.infer<typeof McqItemSchema>;

// ── Notes (detailed + quick revision) ────────────────────────────────────────
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
  answer: z.boolean(),
  explanation: z.string().min(1),
  sourceReference: z.string().optional(),
});
export type TrueFalseItem = z.infer<typeof TrueFalseItemSchema>;

// ── Fill in the blank ────────────────────────────────────────────────────────
export const FillBlankItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
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
  branch: z.string().min(1),
  children: z.array(z.string()).min(1),
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
  variables: z.array(
    z.object({
      symbol: z.string(),
      meaning: z.string(),
    }),
  ),
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
  z.object({ type: z.literal("mcq"), question: z.string(), options: z.array(z.string()).length(4), correctAnswer: z.string(), explanation: z.string() }),
  z.object({ type: z.literal("short_answer"), question: z.string(), answer: z.string() }),
  z.object({ type: z.literal("true_false"), statement: z.string(), answer: z.boolean(), explanation: z.string() }),
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

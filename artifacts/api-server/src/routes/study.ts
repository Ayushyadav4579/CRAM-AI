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

const router: IRouter = Router();
const MAX_SOURCE_CHARS = 220_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

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

const typeLabels: Record<string, string> = {
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
};

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("CRAM AI needs GEMINI_API_KEY to generate content. Add it in Replit Secrets and try again.");
  }
  return new GoogleGenerativeAI(key).getGenerativeModel({
    model: "gemini-2.5-flash",
  });
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseModelJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Gemini returned an invalid structured response. Please try again.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sourceForPrompt(text: string): string {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 8_000) {
    chunks.push(`[SOURCE SECTION ${chunks.length + 1}]\n${text.slice(index, index + 8_000)}`);
  }
  return chunks.join("\n\n");
}

function demoTopics(text: string): string[] {
  const headings = text
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 90 && !/[.!?]$/.test(line));
  const concepts = text.match(/\b[A-Z][A-Za-z-]{3,}(?:\s+[A-Z][A-Za-z-]{3,}){0,2}\b/g) ?? [];
  return [...new Set([...headings, ...concepts])]
    .filter((topic) => topic.toLowerCase() !== "study material")
    .slice(0, 12)
    .concat(["Core concepts"].filter((topic) => !headings.length))
    .slice(0, 12);
}

function demoItems(type: string, count: number, text: string, topic?: string | null): unknown[] {
  const firstSentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const focus = topic ? firstSentences.filter((sentence) => sentence.toLowerCase().includes(topic.toLowerCase())) : [];
  const sourceSentences = [...focus, ...firstSentences].slice(0, Math.max(1, count));
  const base = sourceSentences[0] ?? text.slice(0, 220);
  const items: unknown[] = [];
  for (let index = 0; index < Math.min(count, Math.max(1, sourceSentences.length)); index += 1) {
    const sentence = sourceSentences[index] ?? base;
    if (type === "notes" || type === "short_notes") {
      items.push({ heading: `${topic || "Key idea"} ${index + 1}`, content: sentence });
    } else if (type === "mcq") {
      items.push({
        question: `Which statement is supported by the document?`,
        options: [sentence, "This detail is not stated in the document.", "This reverses the document's explanation.", "This combines unrelated concepts."],
        answer: sentence,
        explanation: "The first option restates the supplied material.",
      });
    } else if (type === "flashcards") {
      items.push({ front: `What should you remember about ${topic || "this concept"}?`, back: sentence });
    } else if (type === "short_answer") {
      items.push({ question: `Explain one important point from the document.`, answer: sentence });
    } else if (type === "long_answer") {
      items.push({ question: `Write a structured answer about ${topic || "the main idea"}.`, answer: `${sentence}\n\nUse the surrounding document context to expand this point.` });
    } else if (type === "true_false") {
      items.push({ statement: sentence, answer: true, explanation: "This statement is directly supported by the document." });
    } else if (type === "fill_blank") {
      const words = sentence.split(/\s+/);
      const answer = words.find((word) => word.length > 5)?.replace(/[,.!?;:]$/, "") ?? words[0];
      items.push({ question: sentence.replace(answer, "_____"), answer });
    } else if (type === "quiz") {
      items.push({ type: "short_answer", question: `What does the material say about ${topic || "this section"}?`, answer: sentence });
    } else if (type === "mindmap") {
      items.push({ branch: topic || "Study material", children: [sentence] });
    } else if (type === "definitions") {
      items.push({ term: topic || "Key term", definition: sentence });
    } else if (type === "formulas") {
      items.push({ formula: "Formula or relationship from the source", explanation: sentence });
    } else if (type === "difficult_words") {
      items.push({ word: sentence.split(/\s+/).find((word) => word.length > 8)?.replace(/[,.!?;:]$/, "") ?? "concept", meaning: sentence });
    } else {
      items.push({ content: sentence });
    }
  }
  return items;
}

function demoPack(text: string, types: string[], count: number, topic?: string | null) {
  return GenerateStudyPackResponse.parse({
    title: "CRAM AI study pack",
    summary: "Demo mode is active because GEMINI_API_KEY is not configured. These grounded previews are generated from your uploaded text.",
    topics: demoTopics(text),
    sections: types.map((type) => ({
      type,
      title: typeLabels[type] ?? type,
      items: demoItems(type, count, text, topic),
    })),
  });
}

function demoChat(text: string, question: string) {
  const questionWords = question.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const sentence = text.split(/(?<=[.!?])\s+/).find((candidate) =>
    questionWords.some((word) => candidate.toLowerCase().includes(word)),
  ) ?? text.split(/(?<=[.!?])\s+/).find(Boolean) ?? text.slice(0, 300);
  return `Demo mode answer, grounded in your document: ${sentence}`;
}

function dedupeItems(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const record = typeof item === "object" && item !== null
      ? item as Record<string, unknown>
      : null;
    const keyValue = record?.question ?? record?.front ?? record?.term ?? record?.prompt ?? record?.statement ?? item;
    const key = String(keyValue).toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePack(value: unknown, requestedTypes: string[]) {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = requestedTypes.map((type) => {
    const match = rawSections.find((section) => (
      typeof section === "object" &&
      section !== null &&
      (section as Record<string, unknown>).type === type
    ));
    const record = typeof match === "object" && match !== null ? match as Record<string, unknown> : {};
    return {
      type,
      title: typeof record.title === "string" ? record.title : typeLabels[type] ?? type,
      items: dedupeItems(Array.isArray(record.items) ? record.items : []),
    };
  });
  return GenerateStudyPackResponse.parse({
    title: typeof raw.title === "string" ? raw.title : "Study Pack",
    summary: typeof raw.summary === "string" ? raw.summary : "Generated from the supplied study material.",
    topics: Array.isArray(raw.topics) ? raw.topics.filter((topic): topic is string => typeof topic === "string").slice(0, 30) : [],
    sections,
  });
}

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

  const normalized = normalizeText(text);
  if (!normalized) {
    res.status(422).json({ error: "No readable text was found. Scanned PDFs and image-only documents need OCR." });
    return;
  }
  if (normalized.length > MAX_SOURCE_CHARS) {
    res.status(413).json({ error: "This document is too long for one study pack. Upload one chapter at a time (maximum 220,000 characters)." });
    return;
  }

  res.json(ExtractStudyMaterialResponse.parse({
    name: file.originalname,
    text: normalized,
    characters: normalized.length,
    truncated: false,
  }));
});

router.post("/study/topics", async (req, res): Promise<void> => {
  const parsed = DetectStudyTopicsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add at least 20 characters of study material." });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.json(DetectStudyTopicsResponse.parse({ topics: demoTopics(parsed.data.text) }));
    return;
  }
  try {
    const result = await getModel().generateContent(`You are a careful academic indexer.
Identify the chapters, headings, major concepts, and examinable subtopics in the complete study material below.
Use only the supplied material. Preserve the source's terminology. Return JSON only:
{"topics":["topic 1","topic 2"]}
Return 3 to 20 concise topics in the order they appear, without duplicates.

STUDY MATERIAL:
${sourceForPrompt(parsed.data.text)}`);
    const raw = parseModelJson(result.response.text());
    const rawTopics = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).topics)
      ? (raw as Record<string, unknown>).topics as unknown[]
      : [];
    const topics = rawTopics.filter((topic: unknown): topic is string => typeof topic === "string").slice(0, 20);
    res.json(DetectStudyTopicsResponse.parse({ topics }));
  } catch (error) {
    req.log.error({ error }, "Topic detection failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "Topic detection failed. Please try again." });
  }
});

router.post("/study/generate", async (req, res): Promise<void> => {
  const parsed = GenerateStudyPackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check your study material, output formats, language, difficulty, and item count." });
    return;
  }

  const { text, types, count, language, difficulty, topic } = parsed.data;
  const requested = types.map((type) => `${type} = ${typeLabels[type] ?? type}`).join("\n");
  if (!process.env.GEMINI_API_KEY) {
    res.json(demoPack(text, types, count, topic));
    return;
  }
  try {
    const result = await getModel().generateContent(`You are CRAM AI, an expert teacher and exam-question writer.
Create a high-quality study pack using ONLY the supplied study material. Never invent, assume, or import outside facts.
Read and use every source section below; do not over-focus on the beginning. Build a coverage plan across the complete source before writing the outputs.
Avoid duplicate or nearly duplicate items. If a requested format is unsupported by the material, return an empty items array for that section rather than inventing content.
Language: ${language}. Difficulty: ${difficulty}. Focus topic/chapter: ${topic || "all relevant topics"}. ${count === 100 ? "For Maximum mode, prioritize the selected topic and cover all distinct examinable points, subtopics, definitions, examples, relationships, processes, comparisons, and facts that are explicitly supported by the source." : ""}
Generate up to ${count} items for each requested question-oriented format. ${count === 100 ? "MAXIMUM MODE: generate the maximum number of DISTINCT, useful, source-supported questions/items the material can genuinely support, with broad coverage across the entire selected topic. Use the full 100-item allowance when the source supports it; never pad with duplicates, trivial rewordings, guesses, or outside facts. If fewer than 100 genuinely distinct items are possible, return only the maximum defensible number." : "Do not pad with duplicates or trivial rewordings."} Keep notes, definitions, formulas, and mind maps sensible and complete rather than padding them.

Required format rules:
- MCQs: exactly 4 options, one correct answer, and a short explanation.
- Short answers: concise, exam-ready answers.
- Long answers: detailed structured answers with key points.
- True/False and fill-in-the-blanks: include answer fields.
- Flashcards: front and back.
- Mixed quiz: vary question formats while including answers.
- Mind map: clear hierarchy.
- Formulas: preserve formulas accurately and explain every symbol only when supported.
- Definitions and difficult words: use only terms present or directly supported by the source.

Return VALID JSON only, with this exact shape:
{"title":"...","summary":"...","topics":["..."],"sections":[{"type":"one requested type id","title":"...","items":[...]}]}
Include exactly one section for every requested type, in the requested order.

REQUESTED OUTPUTS:
${requested}

COMPLETE STUDY MATERIAL:
${sourceForPrompt(text)}`);
    const pack = normalizePack(parseModelJson(result.response.text()), types);
    res.json(pack);
  } catch (error) {
    req.log.error({ error }, "Study pack generation failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "Generation failed. Please try again." });
  }
});

router.post("/study/chat", async (req, res): Promise<void> => {
  const parsed = AskStudyDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add study material and a question." });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.json(AskStudyDocumentResponse.parse({ answer: demoChat(parsed.data.text, parsed.data.question) }));
    return;
  }
  try {
    const result = await getModel().generateContent(`Answer the student's question using ONLY the complete study material below.
If the answer is not supported by the document, say clearly that it is not found in the uploaded material.
Explain simply, cite the relevant concept or section name when the source provides one, and do not invent facts.
Return JSON only: {"answer":"..."}

COMPLETE STUDY MATERIAL:
${sourceForPrompt(parsed.data.text)}

QUESTION:
${parsed.data.question}`);
    const parsedResponse = parseModelJson(result.response.text());
    const answer = parsedResponse && typeof parsedResponse === "object" && typeof (parsedResponse as Record<string, unknown>).answer === "string"
      ? (parsedResponse as Record<string, unknown>).answer
      : result.response.text();
    res.json(AskStudyDocumentResponse.parse({ answer }));
  } catch (error) {
    req.log.error({ error }, "Document chat failed");
    res.status(503).json({ error: error instanceof Error ? error.message : "Document chat failed. Please try again." });
  }
});

export default router;
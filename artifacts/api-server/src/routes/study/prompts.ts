/**
 * Per-type generation prompts.
 *
 * Each output type gets a focused, pedagogically rigorous prompt that:
 * - Specifies exact JSON schema the response must follow
 * - Enforces source grounding (no invented facts)
 * - Uses difficulty-appropriate question design
 * - Rejects generic/metadata-contaminated content
 * - Includes anti-hallucination rules
 * - Handles mathematical content with dedicated instructions
 */

import type { MathKnowledge } from "./math";

type Difficulty = "easy" | "medium" | "detailed";

// ── Core prompt helpers ─────────────────────────────────────────────────────

function difficultyGuide(difficulty: Difficulty): string {
  switch (difficulty) {
    case "easy":
      return [
        "EASY level — test recall and recognition:",
        "- Basic definitions, direct facts, simple identification",
        "- Single-concept answers, short and precise",
        "- No multi-step reasoning or comparisons",
        "- Students should answer from memory alone",
      ].join("\n");
    case "medium":
      return [
        "MEDIUM level — test understanding and application:",
        "- Comparisons, interpretations, direct applications",
        "- Connecting two related ideas",
        "- Students must demonstrate comprehension, not just recall",
        "- Answers may require brief explanation",
      ].join("\n");
    case "detailed":
      return [
        "DEEP DIVE level — test analysis and multi-step reasoning:",
        "- Case-based questions, 'explain why', 'which best explains' style",
        "- Multi-concept synthesis, competency-based problems",
        "- Students must demonstrate deep understanding and application",
        "- Answers should cite specific details from the source",
        "- Include questions that combine 2+ concepts from different sections",
      ].join("\n");
  }
}

function antiHallucinationRules(): string {
  return [
    "CRITICAL ANTI-HALLUCINATION RULES:",
    "- Every fact, statement, and answer MUST be present in the source material.",
    "- Never invent, assume, or import outside knowledge.",
    "- If a concept is mentioned but not explained, note that it is mentioned without fabricating details.",
    "- NEVER generate questions about document metadata (author names, school info, page numbers, copyright, file names).",
    "  Only generate content about the ACTUAL EDUCATIONAL MATERIAL.",
    "- NEVER ask generic questions like 'What does the material say about X?' or 'Which statement is supported?'",
    "  Every question must be a standalone, specific educational question.",
    "- If you cannot find enough material for the requested count, return FEWER items rather than padding with low-quality content.",
  ].join("\n");
}

function sourceGroundingRules(): string {
  return [
    "SOURCE GROUNDING (apply to ALL outputs):",
    "- Every item MUST be traceable to the source material.",
    "- Each item MUST include a sourceReference field identifying the relevant section, paragraph, or page.",
    "- Do not repeat large chunks verbatim — synthesize while preserving accuracy.",
    "- Questions must be answerable from the source alone. A student without the source should still understand the question.",
  ].join("\n");
}

function metadataGuardrails(): string {
  return [
    "METADATA EXCLUSION:",
    "- Do NOT generate content about: author names, teacher names, school/institute names, contact info,",
    "  page numbers, headers/footers, copyright notices, file names, timestamps, or administrative information.",
    "- Do NOT treat 'Grade X', 'Question Bank', 'BOARD 2023', 'Chapter-N', page numbers, or question numbers as educational content.",
    "- Only generate content about the ACTUAL EDUCATIONAL CONTENT: concepts, definitions, facts, formulas,",
    "  processes, relationships, dates relevant to the subject, and scientific/mathematical information.",
  ].join("\n");
}

// ── Mathematics-specific instruction blocks ──────────────────────────────────

function mathSubjectPrefix(knowledge?: MathKnowledge | null): string {
  if (!knowledge || !knowledge.hasMathContent) return "";
  const parts: string[] = [
    "\n===== MATHEMATICAL CONTENT DETECTED =====",
    "Subject: Mathematics",
  ];
  if (knowledge.gradeLevel) parts.push(`Level: ${knowledge.gradeLevel}`);
  if (knowledge.chapter) parts.push(`Chapter: ${knowledge.chapter}`);
  if (knowledge.equations.length > 0) {
    parts.push(`\nEQUATIONS IN SOURCE (${knowledge.equations.length} found):`);
    for (const eq of knowledge.equations.slice(0, 15)) {
      parts.push(`  [${eq.type}] ${eq.expression}  (variables: ${eq.variables.join(", ")})`);
    }
  }
  if (knowledge.systems.length > 0) {
    parts.push(`\nSYSTEMS OF EQUATIONS:`);
    for (const sys of knowledge.systems.slice(0, 5)) {
      parts.push(`  ${sys.expression}`);
    }
  }
  if (knowledge.conditions.length > 0) {
    parts.push(`\nMATHEMATICAL CONDITIONS/RULES:`);
    for (const cond of knowledge.conditions.slice(0, 10)) {
      parts.push(`  • ${cond}`);
    }
  }
  if (knowledge.questionBank.isQuestionBank) {
    parts.push(`\nSOURCE TYPE: Question Bank with ${knowledge.questionBank.mcqs.length} existing MCQs and ${knowledge.questionBank.questions.length} other questions.`);
    parts.push(`Do NOT copy these questions verbatim. Use them to UNDERSTAND what topics are covered, then generate NEW questions.`);
  }
  parts.push(
    "\nMATHEMATICS-SPECIFIC RULES:",
    "1. Preserve all mathematical notation exactly (equations, variables, operators).",
    "2. NEVER copy the source question as the AI-generated question. Generate NEW questions.",
    "3. For MCQs about equations: test whether the student can SOLVE/ANALYZE the equation.",
    "4. For parameter problems (e.g., 'find k'), actually solve the mathematical problem step by step.",
    "5. MCQ distractors must be plausible mathematical answers (common calculation errors, sign errors).",
    "6. Do NOT generate mnemonics for mathematical formulas — math is understood, not memorized.",
    "   Instead, focus on understanding WHY the formula works.",
    "7. Questions should require MATHEMATICAL REASONING, not just reading comprehension.",
    "8. For True/False: verify the mathematical statement is actually correct before marking true.",
    "9. For Fill-in-the-blank: blank out variables, coefficients, or results — not words.",
    "10. Formulas section must contain ACTUAL formulas from the source, with variable definitions.",
  );
  parts.push("===== END MATHEMATICAL CONTENT =====\n");
  return parts.join("\n");
}

/**
 * Post-processing for math questions: ensures options are plausible.
 */
function mathMCQQualityGuardrails(): string {
  return [
    "MATHEMATICAL MCQ QUALITY RULES:",
    "- Every option must be a NUMERICALLY PLAUSIBLE answer.",
    "- Distractors should reflect common mathematical errors:",
    "  • Sign errors (wrong sign on a coefficient)",
    "  • Arithmetic mistakes (wrong addition/multiplication)",
    "  • Wrong variable (solving for x instead of k)",
    "  • Wrong condition (using 'no solution' formula for 'unique solution')",
    "- Do NOT use generic distractors like 'None of the above' or 'Cannot be determined'.",
    "- Do NOT reproduce the source question with 'Explain:' prepended.",
    "- All 4 options must be distinct values.",
    "- For parameter-based problems, options should be specific values (numbers or simple fractions).",
  ].join("\n");
}

// ── Non-math subject-specific instruction blocks ─────────────────────────────

function subjectSpecificPrefix(knowledge?: MathKnowledge | null): string {
  if (!knowledge || knowledge.hasMathContent) return ""; // math handled separately
  const subject = knowledge.subject;
  if (subject === "general") return "";

  const parts: string[] = [`\n===== SUBJECT-SPECIFIC CONTENT: ${subject.toUpperCase().replace(/_/g, " ")} =====`];
  if (knowledge.gradeLevel) parts.push(`Level: ${knowledge.gradeLevel}`);
  if (knowledge.chapter) parts.push(`Chapter: ${knowledge.chapter}`);
  if (knowledge.concepts.length > 0) {
    parts.push(`\nKEY CONCEPTS IDENTIFIED (${knowledge.concepts.length}):`);
    for (const c of knowledge.concepts.slice(0, 15)) {
      parts.push(`  • ${c}`);
    }
  }
  if (knowledge.questionBank.isQuestionBank) {
    parts.push(`\nSOURCE TYPE: Question bank with ${knowledge.questionBank.questions.length} questions.`);
    parts.push(`Use extracted concepts to generate NEW questions — do NOT copy existing ones.`);
  }

  switch (subject) {
    case "history":
      parts.push(
        "\nHISTORY-SPECIFIC GENERATION RULES:",
        "1. Every MCQ must test a SPECIFIC fact: a date, person, place, event, cause, or effect.",
        "   ✗ BAD: 'What does the material say about the revolution?'",
        "   ✓ GOOD: 'On what date was the Tennis Court Oath taken?'",
        "   ✓ GOOD: 'Who led the storming of the Bastille?'",
        "2. Prioritize: dates, chronological order, cause-effect chains, key figures, turning points.",
        "3. True/False: use historical facts that require knowledge to verify.",
        "4. Flashcards: one event/person/date per card — atomic.",
        "5. Notes: organize chronologically with cause→event→consequence structure.",
        "6. Avoid: vague questions about 'the material' or 'this section'.",
        "7. Include questions about: significance, comparison between events, reasons for outcomes.",
      );
      break;
    case "physics":
    case "chemistry":
    case "biology":
      parts.push(
        `\n${subject.toUpperCase()}-SPECIFIC GENERATION RULES:`,
        "1. Preserve all formulas, equations, units, and numerical values exactly.",
        "2. MCQs should test: definitions, processes, relationships, applications, calculations.",
        "3. For calculations: distractors must be plausible numerical answers.",
        "4. Flashcards: one definition or one process step per card.",
        "5. Notes: definition → structure → process → function → example.",
        "6. Include questions about: experimental methods, laws, theories, exceptions.",
        "7. Formulas: include variable definitions and applicable conditions.",
      );
      break;
    case "geography":
      parts.push(
        "\nGEOGRAPHY-SPECIFIC GENERATION RULES:",
        "1. Prioritize: processes, spatial relationships, cause-effect, classification.",
        "2. MCQs: test specific geographical features, processes, classifications.",
        "3. Notes: cause → process → effect → examples → case studies.",
        "4. Include: maps/diagrams references, data interpretation, comparisons.",
        "5. Flashcards: one term/process per card.",
      );
      break;
    case "english":
      parts.push(
        "\nENGLISH/LITERATURE-SPECIFIC GENERATION RULES:",
        "1. Prioritize: literary devices, themes, character analysis, plot structure.",
        "2. MCQs: test comprehension of specific passages, identify techniques, analyze meaning.",
        "3. Notes: theme → textual evidence → analysis → significance.",
        "4. Include: quotations, context, historical background, author's purpose.",
        "5. Long answers should require textual evidence and analytical reasoning.",
      );
      break;
  }

  parts.push("===== END SUBJECT-SPECIFIC CONTENT =====\n");
  return parts.join("\n");
}

// ── Per-type prompt builders ─────────────────────────────────────────────────

export function buildNotesPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
): string {
  return `You are an expert academic study-notes writer. Generate detailed, well-structured study notes.

TASK: Create comprehensive study notes from the source material below.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "heading": "specific topic or concept name",
    "content": "detailed explanation with key facts, relationships, and examples from the source",
    "sourceReference": "section name or paragraph reference"
  }
]

NOTES QUALITY RULES:
1. Each note must cover ONE distinct concept or topic — not multiple ideas crammed together.
2. Organize notes in logical learning order (foundational → advanced).
3. Structure content with internal bullet points, numbered steps, or comparison tables where appropriate.
4. Adapt structure to the subject:
   - Mathematics: formula → meaning of variables → worked example → common mistake
   - Science: definition → structure → process → function → example
   - History: chronology → causes → events → consequences → comparisons
   - Theory: definition → key points → relationships → examples
5. Include formulas, equations, examples, and relationships FROM the source.
6. Content should be detailed enough to study from directly — not just a list of headings.
7. DO NOT reproduce the source as walls of text. Synthesize and restructure.
8. ${difficulty === "detailed" ? "For detailed mode, include analysis, comparisons, and multi-step explanations." : ""}
9. ${difficulty === "easy" ? "For easy mode, focus on definitions and key facts with clear, simple language." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all topics in the material with balanced depth."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array. No markdown fences, no explanation outside the array.`;
}

export function buildQuickRevisionPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
): string {
  return `You are creating high-yield quick-revision notes for exam preparation.

TASK: Extract the most important, exam-critical points from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "heading": "topic or concept name",
    "content": "concise summary of key facts (2-4 sentences, each a distinct important fact)",
    "sourceReference": "section name or paragraph reference"
  }
]

QUICK REVISION RULES:
1. Each item must contain genuinely important, high-yield content — not filler.
2. Prioritize: definitions, key relationships, formulas, rules, processes, exceptions, common exam targets.
3. Content must be concise but complete enough for rapid revision.
4. Do NOT include: trivia, anecdotes, low-value details, or metadata.
5. Group related facts under a single heading when they belong together.
6. ${difficulty === "detailed" ? "Include higher-order connections between concepts." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all high-yield points across the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildMcqPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are an expert exam-question writer. Generate high-quality multiple-choice questions.

TASK: Create exactly ${count} MCQs from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "question": "A specific, standalone question about educational content",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correctAnswer": "The EXACT text of the correct option (including the letter prefix like 'A) ')",
    "explanation": "Why this answer is correct AND why the other options are wrong — cite the source",
    "sourceReference": "section name or paragraph reference from the source",
    "topic": "the specific topic this question covers",
    "difficulty": "easy|medium|detailed"
  }
]

MCQ QUALITY RULES — CRITICAL:
1. Every question must be STANDALONE and SPECIFIC about educational content.
   ✗ BAD: "What does the material say about photosynthesis?"
   ✗ BAD: "Which of the following is mentioned in the text?"
   ✓ GOOD: "What is the primary pigment responsible for absorbing light energy in Photosystem II?"
   ✓ GOOD: "At what pH does the enzyme pepsin achieve maximum activity?"

2. Each question must test a SPECIFIC fact, concept, relationship, or process.
   The student must understand what is being asked WITHOUT reading the answer.

3. ALL 4 OPTIONS must be plausible. Generate distractors based on:
   - Common misconceptions students have about this topic
   - Related but incorrect concepts
   - Common calculation or reasoning errors
   - Closely related but subtly wrong statements
   - Do NOT use obviously wrong options like "This is unrelated"
   - Do NOT use "All of the above" or "None of the above" unless the source explicitly lists only 3 correct items

4. OPTIONS QUALITY CHECK (apply to every MCQ):
   - Exactly 4 options (no more, no less)
   - Only ONE correct answer
   - No duplicate options
   - No option that is dramatically more detailed than the others
   - No obvious giveaway clues (different grammar/punctuation/length patterns)
   - Options should be roughly similar in length and complexity
   - Correct option must be supported by the source

5. EXPLANATION must:
   - Explain WHY the correct answer is correct (with source reference)
   - Briefly note why each distractor is wrong
   - Be 2-4 sentences, not a full paragraph

6. DISTRIBUTION: Questions must cover DIFFERENT topics/sections, not cluster in one paragraph.

${difficultyGuide(difficulty)}
${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Distribute questions across all topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array of exactly ${count} MCQ objects.`;
}

export function buildShortAnswerPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are an exam-prep specialist creating short-answer questions.

TASK: Create exactly ${count} short-answer questions from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "question": "A specific question requiring a 2-4 sentence answer",
    "answer": "A concise, accurate answer grounded in the source",
    "sourceReference": "section name or paragraph reference",
    "topic": "the topic this covers"
  }
]

SHORT ANSWER RULES:
1. Each question must test a SPECIFIC concept, fact, or relationship — not a vague topic.
   ✗ BAD: "Explain the topic of this chapter."
   ✓ GOOD: "Explain the difference between mitosis and meiosis in terms of chromosome number."
2. Answers must be 2-4 sentences: concise but substantive.
3. Never ask questions that can be answered with a single word or a paragraph.
4. Answers must be directly supportable from the source material.
5. Include the expected key concepts in the answer.
6. Distribute questions across different topics.
7. ${difficulty === "easy" ? "Questions should be definitional: 'What is X?' or 'Define Y'." : ""}
8. ${difficulty === "medium" ? "Questions should require understanding: 'Compare X and Y' or 'Explain how X leads to Y'." : ""}
9. ${difficulty === "detailed" ? "Questions should require analysis: 'Why does X occur despite Y?' or 'Analyze the relationship between X, Y, and Z'." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildLongAnswerPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are an academic writing specialist creating detailed answer questions.

TASK: Create exactly ${count} long-answer/essay questions from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "question": "A question requiring a structured, detailed response (100-300 words)",
    "answer": "A comprehensive answer with clear structure, citing specific source details",
    "keyPoints": ["key point 1", "key point 2", "key point 3", "key point 4", "key point 5"],
    "sourceReference": "section name or paragraph reference",
    "topic": "the topic this covers"
  }
]

LONG ANSWER RULES:
1. Questions should require structured, essay-style answers — not simple fact recall.
   ✗ BAD: "Write about photosynthesis."
   ✓ GOOD: "Describe the light-dependent reactions of photosynthesis, including the role of chlorophyll, the electron transport chain, and the products formed."
2. Answers must include:
   - Clear thesis or central argument
   - Specific details, examples, and relationships from the source
   - Logical structure with cause-effect, chronological, or comparative organization
3. keyPoints must list 3-7 essential elements a complete answer must include.
4. Answers should demonstrate deep understanding, not just list facts.
5. ${difficulty === "easy" ? "Focus on 'Describe' and 'Explain' questions at the definitional level." : ""}
6. ${difficulty === "medium" ? "Focus on 'Compare', 'Analyze', and 'Discuss' questions." : ""}
7. ${difficulty === "detailed" ? "Focus on 'Evaluate', 'Assess', and 'Critically analyze' questions with multi-concept integration." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all major topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildTrueFalsePrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are creating true/false questions from study material.

TASK: Create exactly ${count} true/false statements from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "statement": "A specific factual statement derived from the source",
    "answer": true,
    "explanation": "Why this is true or false, referencing specific source content",
    "sourceReference": "section name or paragraph reference"
  }
]

TRUE/FALSE RULES:
1. Each statement must be about a specific educational fact.
   ✗ BAD: "The material discusses several important topics."
   ✓ GOOD: "Mitochondria are known as the powerhouse of the cell because they produce ATP through oxidative phosphorylation."
2. Mix true and false roughly evenly (within 1-2 of each other).
3. True statements must be VERIFIABLY supported by the source.
4. False statements must be:
   - Close enough to be plausible (not obviously absurd)
   - Clearly contradicted by the source
   - Based on common misconceptions or subtle errors
5. The explanation must cite specific source content.
6. Do NOT use trivially obvious statements ("The sky is blue").
7. ${difficulty === "easy" ? "Simple factual statements with clear true/false answers." : ""}
8. ${difficulty === "medium" ? "Statements requiring understanding of relationships and processes." : ""}
9. ${difficulty === "detailed" ? "Subtle statements requiring careful analysis to evaluate — based on common misconceptions." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildFillBlankPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are creating fill-in-the-blank questions from study material.

TASK: Create exactly ${count} fill-in-the-blank questions from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "question": "A sentence with a key term or phrase replaced by _____",
    "answer": "The term or phrase that fills the blank",
    "hint": "A brief hint to guide the student (optional — omit if the blank is self-evident from context)",
    "sourceReference": "section name or paragraph reference"
  }
]

FILL-IN-THE-BLANK RULES:
1. The blank must test a KEY CONCEPT, TERM, NUMBER, or RELATIONSHIP.
   ✗ BAD: "The chapter was written by _____."
   ✓ GOOD: "The powerhouse of the cell is the _____."
   ✓ GOOD: "In the equation F = ma, F represents _____ and a represents _____."
2. The surrounding sentence must provide enough context to identify the answer.
3. Never blank out articles, prepositions, or trivial words.
4. The answer must be a meaningful term (typically 1-4 words).
5. Each blank should test a different concept — no two blanks about the same fact.
6. Hints should guide without giving away the answer (omit hint if unnecessary).
7. ${difficulty === "easy" ? "Blank out basic definitions and key terms." : ""}
8. ${difficulty === "medium" ? "Blank out relationships and process steps." : ""}
9. ${difficulty === "detailed" ? "Blank out critical details that require deep understanding to identify." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildFlashcardPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are creating flashcards for efficient study and recall.

TASK: Create exactly ${count} flashcards from the source material.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "front": "A clear question or prompt that tests ONE specific concept",
    "back": "A concise, accurate answer grounded in the source (1-3 sentences)",
    "topic": "the topic this covers",
    "sourceReference": "section name or paragraph reference"
  }
]

FLASHCARD RULES — THE RULE OF ATOMICITY:
1. Each flashcard must test EXACTLY ONE concept, fact, or relationship.
   ✗ BAD: "Explain photosynthesis, its equation, factors, importance, and experiments."
   ✓ GOOD: "Where does photosynthesis occur?" → "In the chloroplasts, specifically in the thylakoid membranes."
   ✓ GOOD: "What is the chemical equation for photosynthesis?" → "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂"

2. The front must be a SPECIFIC question, not a vague topic label.
   ✗ BAD: "Photosynthesis"
   ✓ GOOD: "What is the primary pigment in Photosystem II?"
   ✓ GOOD: "Name the enzyme that fixes CO₂ in C4 plants."

3. The back must be:
   - Concise (1-3 sentences, ideally under 25 words)
   - Complete enough to stand alone as an answer
   - Precise and unambiguous

4. Include specific terms, numbers, formulas, and relationships.
5. NO compound cards — split into multiple cards if needed.
6. Cards should be ordered from foundational to advanced.
7. ${difficulty === "easy" ? "Focus on definitions, names, and basic facts." : ""}
8. ${difficulty === "medium" ? "Focus on processes, comparisons, and applications." : ""}
9. ${difficulty === "detailed" ? "Focus on multi-step reasoning, exceptions, and nuanced understanding." : ""}

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all key concepts in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildMindmapPrompt(
  text: string,
  language: string,
  topic: string | null,
): string {
  return `You are creating a structured mind map from study material.

TASK: Identify the hierarchical structure of the source material and create a mind map.

OUTPUT SCHEMA (return a JSON array of objects, each representing a main branch):
[
  {
    "branch": "Main topic or concept (1-3 words)",
    "children": ["sub-concept 1 (1-3 words)", "sub-concept 2 (1-3 words)", "sub-concept 3 (1-3 words)"],
    "sourceReference": "section name or paragraph reference"
  }
]

MIND MAP RULES:
1. Each branch represents a MAJOR TOPIC or CONCEPT from the material.
   Branch names must be SHORT (1-3 words maximum).
2. Children are sub-concepts, key facts, or related ideas under that branch.
   Each child must also be SHORT (1-5 words maximum).
3. The hierarchy must reflect the LOGICAL STRUCTURE of the material:
   - Central concept → main branches → sub-branches
   - Cause → effect relationships
   - Classification → categories → examples
   - Process → steps → outcomes
4. Include 4-8 main branches covering the breadth of the material.
5. Children should be SPECIFIC and EDUCATIONAL, not vague labels.
   ✗ BAD branch: "Important Information"
   ✗ BAD children: ["Facts", "Details", "More info"]
   ✓ GOOD branch: "Photosynthesis"
   ✓ GOOD children: ["Light reactions", "Calvin cycle", "Chloroplasts", "ATP production"]
6. Use relationship labels in child text where useful:
   "requires", "produces", "leads to", "contains", "differs from"
7. Do NOT create a flat list — use genuine hierarchical relationships.

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Map the entire material's structure."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildDefinitionPrompt(
  text: string,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are extracting key definitions from study material.

TASK: Identify and extract ${count} important terms and their definitions.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "term": "the key term or concept name",
    "definition": "a clear, accurate definition grounded in the source",
    "example": "a brief example or illustration from the source (if available — omit if not in source)",
    "sourceReference": "section name or paragraph reference"
  }
]

DEFINITION RULES:
1. Only extract terms that are genuinely DEFINED or EXPLAINED in the source.
   Do NOT invent definitions for terms not present in the material.
2. Definitions must accurately reflect how the source defines them.
3. Focus on DOMAIN-SPECIFIC terminology — not common English words.
   ✗ BAD: "Run: To move quickly on foot"
   ✓ GOOD: "Osmosis: The net movement of water molecules across a semi-permeable membrane from a region of higher water potential to lower water potential"
4. Examples must come from the source when available.
5. Prioritize terms that are essential for understanding the material.
6. Include related or easily confused terms separately.

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Extract all key terms from the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildFormulaPrompt(
  text: string,
  language: string,
  topic: string | null,
): string {
  return `You are extracting genuine formulas and equations from study material.

TASK: Identify ALL actual formulas, equations, and mathematical relationships present in the source.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "formula": "the formula or equation written clearly",
    "name": "the name or meaning of this formula",
    "variables": [
      { "symbol": "variable symbol", "meaning": "what this variable represents" }
    ],
    "conditions": "when or under what conditions this formula applies (if stated in source)",
    "sourceReference": "section name or paragraph reference"
  }
]

FORMULA RULES — CRITICAL:
1. ONLY extract formulas that GENUINELY APPEAR in the source material.
2. NEVER classify the following as formulas:
   - Author names, teacher names, or any person's name
   - Chapter headings or section titles
   - Copyright notices, page numbers, or administrative text
   - Ordinary sentences or descriptions
   - File names or metadata
3. If NO genuine formulas exist in the source, return an empty array: []
   Do NOT invent formulas to fill the section.
4. Each formula must include ALL variables defined in the source.
5. Preserve mathematical notation as accurately as possible.
6. Include the physical/mathematical meaning of the formula.
7. Include units where the source specifies them.
8. "conditions" should explain when the formula applies (e.g., "only for ideal gases", "valid near Earth's surface").

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Extract all formulas from the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildDifficultWordsPrompt(
  text: string,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are identifying difficult or specialized vocabulary from study material.

TASK: Find ${count} difficult or domain-specific words that a student should understand.

OUTPUT SCHEMA (return a JSON array of objects):
[
  {
    "word": "the difficult or specialized word",
    "meaning": "clear explanation of what this word means in this specific context",
    "example": "an example sentence or usage from the source (if available — omit if not in source)",
    "sourceReference": "section name or paragraph reference"
  }
]

DIFFICULT WORDS RULES:
1. Focus on DOMAIN-SPECIFIC TERMINOLOGY — not common English words.
   ✗ BAD: "significant", "important", "analysis"
   ✓ GOOD: "photosynthesis", "stoichiometry", "mitochondria", "oscillation"
2. Include technical terms, jargon, and words specific to the subject.
3. Meanings must reflect how the source uses the word in context.
4. Examples must come from the source when available.
5. Prioritize words that are ESSENTIAL for understanding the material.
6. Do NOT include words that any educated person would know.

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover difficult words across all topics."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildMnemonicPrompt(
  text: string,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are creating memory tricks (mnemonics) for study material.

TASK: Create up to ${count} mnemonics to help students remember key facts that are genuinely difficult to memorize.

OUTPUT SCHEMA (return a JSON array of objects — return FEWER than ${count} if not all concepts need mnemonics):
[
  {
    "fact": "the specific fact or list that needs to be memorized",
    "trick": "the mnemonic or memory technique",
    "whyItWorks": "brief explanation of why this mnemonic is effective",
    "recallCue": "a short phrase to trigger recall during revision",
    "sourceReference": "section name or paragraph reference"
  }
]

MNEMONIC RULES — CRITICAL:
1. Mnemonics must be SELECTIVE. Do NOT create a mnemonic for every fact.
   Only create mnemonics for concepts that are GENUINELY DIFFICULT to memorize.

2. PRIORITIZE mnemonics for:
   - Long lists or ordered sequences (e.g., planets, steps in a process)
   - Multiple similar items that are easily confused
   - Classifications or categories with arbitrary groupings
   - Difficult terminology or foreign words
   - Exceptions to rules
   - Stages, phases, or components
   - Information with no intuitive connection (arbitrary names, dates)

3. DO NOT create mnemonics for:
   - Obvious facts that are easy to remember
   - Simple definitions
   - Intuitive concepts
   - Every sentence or paragraph
   - Facts that are better understood than memorized

4. Evaluate each potential mnemonic on:
   - memorization difficulty: Is this genuinely hard to remember?
   - likelihood of confusion: Could students confuse this with something else?
   - mnemonic usefulness: Would a memory trick actually help here?

5. If no concept in the material needs a mnemonic, return an empty array: []
   Do NOT invent bad mnemonics just to fill the section.

6. MNEMONIC QUALITY:
   - Use vivid imagery, bizarre associations, or mini-stories
   - Natural acronyms (only when letters map to real words)
   - Rhymes, visual associations, or emotional hooks
   - The trick must make the information EASIER to remember
   - Do NOT create forced, meaningless letter combinations

${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Identify the most mnemonic-worthy facts in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

export function buildQuizPrompt(
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
): string {
  return `You are creating a mixed-format quiz from study material.

TASK: Create a quiz with ${count} questions mixing different formats.

OUTPUT SCHEMA (return a JSON array of objects, each with a "type" field):
[
  {
    "type": "mcq",
    "question": "specific question",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correctAnswer": "the correct option",
    "explanation": "why this is correct"
  },
  {
    "type": "short_answer",
    "question": "specific question",
    "answer": "concise answer"
  },
  {
    "type": "true_false",
    "statement": "a specific factual statement",
    "answer": true,
    "explanation": "why true or false"
  },
  {
    "type": "fill_blank",
    "question": "sentence with _____ blank",
    "answer": "the missing term"
  }
]

QUIZ RULES:
1. Mix question types roughly evenly across the count.
2. Every question must test SPECIFIC educational content.
3. No generic questions — each must be answerable from the source.
4. MCQs: all 4 options must be plausible, only one correct.
5. True/False: statements must be specific and educational.
6. Fill-in-the-blank: the blank must test a key concept.
7. Questions should be distributed across different topics.
8. All answers must be verifiable from the source.

${difficultyGuide(difficulty)}
${metadataGuardrails()}
${antiHallucinationRules()}
${sourceGroundingRules()}

TOPIC FOCUS: ${topic || "Cover all topics in the material."}
LANGUAGE: ${language}

SOURCE MATERIAL:
${text}

Return ONLY a valid JSON array.`;
}

// ── Prompt dispatch ──────────────────────────────────────────────────────────

export function buildPrompt(
  type: string,
  text: string,
  difficulty: Difficulty,
  language: string,
  topic: string | null,
  count: number,
  knowledge?: MathKnowledge | null,
): string {
  // Add subject-specific instructions to every prompt
  const mathPrefix = mathSubjectPrefix(knowledge);
  const subjectPrefix = subjectSpecificPrefix(knowledge);
  const allPrefix = mathPrefix || subjectPrefix; // only one applies
  const mathGuard = knowledge?.hasMathContent ? mathMCQQualityGuardrails() : "";

  switch (type) {
    case "notes":
      return `${allPrefix}${buildNotesPrompt(text, difficulty, language, topic)}`;
    case "short_notes":
      return `${allPrefix}${buildQuickRevisionPrompt(text, difficulty, language, topic)}`;
    case "mcq":
      return `${allPrefix}${mathGuard}${buildMcqPrompt(text, difficulty, language, topic, count)}`;
    case "short_answer":
      return `${allPrefix}${buildShortAnswerPrompt(text, difficulty, language, topic, count)}`;
    case "long_answer":
      return `${allPrefix}${buildLongAnswerPrompt(text, difficulty, language, topic, count)}`;
    case "true_false":
      return `${allPrefix}${buildTrueFalsePrompt(text, difficulty, language, topic, count)}`;
    case "fill_blank":
      return `${allPrefix}${buildFillBlankPrompt(text, difficulty, language, topic, count)}`;
    case "flashcards":
      return `${allPrefix}${buildFlashcardPrompt(text, difficulty, language, topic, count)}`;
    case "mindmap":
      return `${allPrefix}${buildMindmapPrompt(text, language, topic)}`;
    case "definitions":
      return `${allPrefix}${buildDefinitionPrompt(text, language, topic, count)}`;
    case "formulas":
      return `${allPrefix}${buildFormulaPrompt(text, language, topic)}`;
    case "difficult_words":
      return `${allPrefix}${buildDifficultWordsPrompt(text, language, topic, count)}`;
    case "mnemonics":
      return `${allPrefix}${buildMnemonicPrompt(text, language, topic, count)}`;
    case "quiz":
      return `${allPrefix}${mathGuard}${buildQuizPrompt(text, difficulty, language, topic, count)}`;
    default:
      return `${allPrefix}${buildNotesPrompt(text, difficulty, language, topic)}`;
  }
}

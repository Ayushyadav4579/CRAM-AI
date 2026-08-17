export const TYPES:Record<string,string>={
notes:'Detailed chapter notes',
short_notes:'Very short revision notes',
mcq:'Multiple choice questions with 4 options, answer and explanation',
short_answer:'Short answer questions with exam-ready answers',
long_answer:'Long answer questions with structured answers',
true_false:'True/False questions with answers and explanations',
fill_blank:'Fill-in-the-blank questions with answer keys',
flashcards:'Flashcards with front and back',
quiz:'Mixed quiz questions with answers',
mindmap:'Text hierarchy mind map',
definitions:'Important definitions',
formulas:'Important formulas and what each symbol means',
difficult_words:'Difficult words with simple meanings'
};

export function buildPrompt(input:{text:string;types:string[];count:number;language:string;difficulty:string;topic?:string}){
 const requested=input.types.map(x=>TYPES[x]||x).join('; ');
 return `You are CRAM AI, an expert teacher and exam-question writer.
Use ONLY the supplied study material. Never invent unsupported facts.
Language: ${input.language}. Difficulty: ${input.difficulty}. Requested topic: ${input.topic||'all relevant topics'}.
Generate up to ${input.count} items PER requested question-oriented type, but keep notes/formulas/definitions sensible.
Requested outputs: ${requested}.

Quality rules:
- Cover the whole source, not just the first paragraph.
- Avoid duplicate or nearly duplicate questions.
- Vary difficulty where appropriate.
- MCQs must have exactly 4 options, one correct answer, and a short explanation.
- Short answers should be concise and exam-ready.
- Long answers should contain a clear answer plus key points.
- Fill blanks must include answer keys.
- True/False must include the correct answer.
- Flashcards must have front/back.
- If the source contains formulas, preserve them accurately.
- If a requested type is not supported by the source, return an empty items array rather than inventing content.

Return VALID JSON ONLY:
{"title":"...","summary":"...","topics":["..."],"sections":[{"type":"mcq","title":"...","items":[...]}]}

SOURCE:
${input.text}`;
}
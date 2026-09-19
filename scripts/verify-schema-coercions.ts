import {
  McqItemSchema,
  TrueFalseItemSchema,
  MindmapItemSchema,
  FillBlankItemSchema,
} from "../lib/api-zod/src/study-items";

let failures = 0;
function check(label: string, result: { success: boolean }, extra?: string) {
  if (result.success) console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  else { failures++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// 1. MCQ with option objects + "hard" difficulty + letter answer
check("MCQ option objects/hard difficulty", McqItemSchema.safeParse({
  question: "What causes rainfall?",
  options: [{ A: "Evaporation" }, { B: "Condensation" }, "Gravity", { text: "Photosynthesis" }],
  correctAnswer: "B) Condensation",
  explanation: "Condensation forms clouds.",
  difficulty: "hard",
}));

// 2. True/False with string "True"
const tf = TrueFalseItemSchema.safeParse({ statement: "The sun rises in the east.", answer: "True" });
check("True/False string answer", tf, tf.success ? `answer=${JSON.stringify((tf as any).data.answer)}` : undefined);

// 3. Mindmap with nested children objects
check("Mindmap nested children", MindmapItemSchema.safeParse({
  branch: "Water Cycle",
  children: [{ branch: "Evaporation" }, { label: "Condensation" }, "Precipitation"],
}));

// 4. Fill blank with numeric answer
check("Fill blank numeric answer", FillBlankItemSchema.safeParse({ question: "2 + 2 = ____", answer: 4 }));

// 5. Still rejects genuinely broken MCQ (1 option)
check("MCQ still rejects 1 option", { success: !McqItemSchema.safeParse({ question: "Q", options: ["only"], correctAnswer: "only" }).success });

process.exit(failures > 0 ? 1 : 0);

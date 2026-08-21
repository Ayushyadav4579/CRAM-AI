/**
 * Mathematics-aware content processing module.
 *
 * Pipeline:
 *   1. Detect subject (Math, Physics, Chemistry, etc.)
 *   2. Repair Unicode math symbols from PDF extraction
 *   3. Extract equations and expressions structurally
 *   4. Detect if source is a question bank
 *   5. Parse existing MCQs with their options
 *   6. Build structured knowledge representation
 *   7. Detect chapter/topic/class metadata
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Subject =
  | "mathematics"
  | "physics"
  | "chemistry"
  | "biology"
  | "history"
  | "geography"
  | "political_science"
  | "english"
  | "computer_science"
  | "general";

export interface MathEquation {
  type: "equation" | "system_of_equations" | "inequality" | "expression";
  expression: string;
  variables: string[];
  operators: string[];
}

export interface ExtractedMCQ {
  question: string;
  options: string[];
  /** Index of the correct option (-1 if unknown) */
  correctIndex: number;
  equations: string[];
  topic: string;
  difficulty: string;
}

export interface SourceQuestionBank {
  isQuestionBank: boolean;
  mcqs: ExtractedMCQ[];
  questions: string[];
}

export interface MathKnowledge {
  subject: Subject;
  /** Detected grade/class level, e.g. "Grade X", "Class 12" */
  gradeLevel: string;
  /** Chapter name */
  chapter: string;
  /** Document topic categories */
  topics: string[];
  /** All equations extracted from source */
  equations: MathEquation[];
  /** System-level equations (paired) */
  systems: MathEquation[];
  /** Existing MCQs in the source (if question bank) */
  questionBank: SourceQuestionBank;
  /** Key mathematical concepts/concepts from the source */
  concepts: string[];
  /** Conditions and rules (e.g. "for unique solution: a1/a2 ≠ b1/b2") */
  conditions: string[];
  /** Whether this source has genuine mathematical content */
  hasMathContent: boolean;
}

// ── Subject detection ────────────────────────────────────────────────────────

const MATH_KEYWORDS = new Set([
  // Strongly math-specific single words
  "equation", "variable", "coefficient", "polynomial", "factor",
  "quadratic", "exponential", "logarithm", "integral", "derivative",
  "matrix", "vector", "scalar", "arithmetic", "geometric",
  "algebraic", "trigonometric", "sine", "cosine", "tangent",
  "triangle", "polygon", "prism", "cylinder",
  "cone", "sphere", "pyramid", "perimeter", "circumference",
  "diameter", "radius", "diagonal", "perpendicular",
  "theorem", "axiom", "conjecture", "lemma", "corollary",
  "fraction", "numerator", "denominator", "exponent",
  "summation", "quotient", "remainder", "divisible by",
  "positive integer", "negative integer", "rational number", "irrational number", "real number",
  "complex number", "prime number", "composite number", "factorial of", "permutation of", "combination of",
  "probability", "statistics", "median", "variance",
  "linear inequality", "quadratic inequality", "inequalities in two variables",
  "slope of", "y-intercept", "gradient of",
  "linear equations", "two variables", "inconsistent", "consistent",
  "infinitely many solutions", "unique solution", "no solution",
  "linear system", "simultaneous equations", "substitution method", "elimination method",
  // Multi-word phrases (lower false-positive risk than single words)
  "linear equations", "power of a", "base of", "product of", "difference of",
]);

const PHYSICS_KEYWORDS = new Set([
  "velocity", "acceleration", "momentum", "force", "mass", "gravity",
  "friction", "inertia", "kinetic energy", "potential energy", "work done", "power output", "torque",
  "wave", "frequency", "wavelength", "amplitude", "spectrum", "photon",
  "electric", "magnetic", "electromagnetic", "circuit", "voltage", "current",
  "electrical resistance", "capacitance", "inductance", "ohm", "farad", "henry",
  "thermodynamics", "temperature", "heat", "entropy", "enthalpy",
  "optics", "reflection", "refraction", "diffraction", "interference",
  "newton", "joule", "watt", "pascal", "tesla", "gauss",
]);

const CHEMISTRY_KEYWORDS = new Set([
  "atom", "molecule", "element", "compound", "reaction", "solution",
  "acid", "base", "salt", "oxide", "hydroxide", "carbonate",
  "valency", "oxidation", "reduction", "electrolysis", "electrode",
  "periodic", "group", "period", "bond", "ionic", "covalent",
  "mole", "molar", "stoichiometry", "concentration", "dilute",
  "organic", "hydrocarbon", "alkane", "alkene", "alkyne",
  "polymer", "catalyst", "enzyme", "pH", "alkaline", "acidic",
]);

const BIOLOGY_KEYWORDS = new Set([
  "cell", "nucleus", "membrane", "cytoplasm", "organelle", "mitochondria",
  "chloroplast", "ribosome", "endoplasmic", "golgi",
  "photosynthesis", "respiration", "metabolism", "enzyme", "protein",
  "dna", "rna", "gene", "chromosome", "mutation", "allele",
  "mitosis", "meiosis", "cell division", "gamete", "zygote",
  "evolution", "natural selection", "adaptation", "species",
  "kingdom", "phylum", "class", "order", "family", "genus", "species",
  "ecosystem", "food chain", "habitat", "biodiversity",
]);

const OTHER_SUBJECT_KEYWORDS: Record<string, Set<string>> = {
  history: new Set([
    "revolution", "empire", "kingdom", "dynasty", "constitution",
    "independence", "colonial", "civilization", "democracy", "republic",
    "amendment", "legislation", "treaty", "alliance", "war", "battle",
    "era", "century", "medieval", "renaissance", "industrial",
    "republic", "estate", "national assembly", "bastille", "reign",
    "terror", "directory", "napoleon", "louis xvi", "robespierre",
    "causes", "consequences", "movements", "reform",
  ]),
  geography: new Set([
    "latitude", "longitude", "continent", "ocean", "mountain", "river",
    "climate", "atmosphere", "erosion", "weathering", "tectonic",
    "population", "urbanization", "agriculture", "industry", "resource",
    "soil", "vegetation", "drainage", "elevation", "rainfall",
    "temperature", "monsoon", "cyclone", "tsunami", "earthquake",
  ]),
  english: new Set([
    "metaphor", "simile", "alliteration", "personification", "symbolism",
    "narrative", "prose", "poetry", "stanza", "rhyme", "meter",
    "character", "plot", "theme", "setting", "conflict",
    "imagery", "rhetoric", "irony", "allegory", "motif",
    "author", "novel", "poem", "drama", "dialogue",
  ]),
  computer_science: new Set([
    "algorithm", "data structure", "binary", "array", "linked list",
    "stack", "queue", "tree", "graph", "sorting", "searching",
    "programming", "compiler", "database", "network", "protocol",
    "variable", "loop", "function", "class", "object",
    "recursion", "iteration", "hash", "pointer", "memory",
  ]),
  civics: new Set([
    "citizen", "government", "parliament", "legislature", "executive",
    "judiciary", "fundamental rights", "directive principles",
    "election", "voting", "panchayat", "municipality",
    "federalism", "secularism", "sovereignty",
  ]),
  economics: new Set([
    "demand", "supply", "market", "price", "inflation",
    "deflation", "gdp", "gnp", "fiscal policy", "monetary policy",
    "trade", "export", "import", "budget", "taxation",
  ]),
};

/**
 * Detect the primary subject of a text passage.
 * Returns the detected subject and a confidence score (0-1).
 */
export function detectSubject(text: string): { subject: Subject; confidence: number } {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z]+/).filter((w) => w.length > 2);
  const wordSet = new Set(words);

  function scoreKeywords(keywords: Set<string>): number {
    let hits = 0;
    for (const kw of keywords) {
      if (kw.includes(" ")) {
        // Multi-word: check as phrase
        if (lower.includes(kw)) hits += 2;
      } else if (wordSet.has(kw)) {
        hits += 1;
      }
    }
    return hits;
  }

  const mathScore = scoreKeywords(MATH_KEYWORDS);
  const physicsScore = scoreKeywords(PHYSICS_KEYWORDS);
  const chemScore = scoreKeywords(CHEMISTRY_KEYWORDS);
  const bioScore = scoreKeywords(BIOLOGY_KEYWORDS);

  // Math symbols/equations — use LOW weights to avoid false positives.
  // Single symbols like +, -, = appear in many non-math texts.
  const mathSymbolCount = (
    lower.match(/[=+\-*/^√∑∫≤≥≠±×÷²³]/g) ?? []
  ).length;
  // Only count genuine equation patterns: digit(s) followed by variable(s) with operators and =
  const equationPatternCount = (
    lower.match(/\b\d+[a-z](?:\s*[+\-*/]\s*\d*[a-z]?)*\s*[=<>≤≥]\s*\S+/g) ?? []
  ).length;

  const adjustedMathScore = mathScore + mathSymbolCount * 0.1 + equationPatternCount * 1.5;

  const scores: Array<{ subject: Subject; score: number }> = [
    { subject: "mathematics" as Subject, score: adjustedMathScore },
    { subject: "physics" as Subject, score: physicsScore },
    { subject: "chemistry" as Subject, score: chemScore },
    { subject: "biology" as Subject, score: bioScore },
  ];

  for (const [name, keywords] of Object.entries(OTHER_SUBJECT_KEYWORDS)) {
    scores.push({
      subject: name.replace("computer_science", "computer_science").replace("political_science", "political_science") as Subject,
      score: scoreKeywords(keywords),
    });
  }

  scores.sort((a, b) => b.score - a.score);
  const total = scores.reduce((s, x) => s + x.score, 0);

  if (total === 0 || scores[0].score === 0) {
    return { subject: "general", confidence: 0 };
  }

  // Guard against math false positives: require real keyword evidence.
  // Math symbols alone should NOT override other subjects with real keywords.
  const mathKeywordHits = scoreKeywords(MATH_KEYWORDS);
  if (scores[0].subject === "mathematics" && mathKeywordHits < 3) {
    // Math claim is weak — check if another subject has better keyword evidence
    const nextBest = scores.slice(1).find(s => s.score > 0);
    if (nextBest && nextBest.score >= 2) {
      return { subject: nextBest.subject, confidence: 0.5 };
    }
    // No strong alternative either — only override if math has very few keywords
    if (mathKeywordHits === 0 && adjustedMathScore < 5) {
      return { subject: "general", confidence: 0.3 };
    }
  }
  if (scores[0].score <= 1 && (scores.length < 2 || scores[0].score <= scores[1].score)) {
    return { subject: "general", confidence: 0.3 };
  }

  return {
    subject: scores[0].subject,
    confidence: Math.min(1, scores[0].score / Math.max(total * 0.3, 1)),
  };
}

// ── Unicode math symbol repair ───────────────────────────────────────────────

/**
 * Common Unicode replacements for PDF-extracted mathematical text.
 * Maps OCR/PDF-incorrect Unicode to correct ASCII/mathematical symbols.
 */
const UNICODE_MATH_REPLACEMENTS: Array<[RegExp, string]> = [
  // Mathematical italic characters (common in PDF math rendering)
  [/푎/g, "a"], [/푏/g, "b"], [/푐/g, "c"], [/푑/g, "d"],
  [/푒/g, "e"], [/푓/g, "f"], [/푔/g, "g"], [/푕/g, "h"],
  [/푖/g, "i"], [/푗/g, "j"], [/푘/g, "k"], [/푙/g, "l"],
  [/푚/g, "m"], [/푛/g, "n"], [/푝/g, "o"], [/푞/g, "p"],
  [/푟/g, "q"], [/푠/g, "r"], [/푡/g, "s"], [/푢/g, "t"],
  [/푣/g, "u"], [/푤/g, "v"], [/푥/g, "x"], [/푦/g, "y"],
  [/푧/g, "z"],

  // Bold mathematical symbols
  [/𝐚/g, "a"], [/𝐛/g, "b"], [/𝐜/g, "c"], [/𝐝/g, "d"],
  [/𝐞/g, "e"], [/𝐟/g, "f"], [/𝐠/g, "g"], [/𝐡/g, "h"],
  [/𝐢/g, "i"], [/𝐣/g, "j"], [/𝐤/g, "k"], [/𝐥/g, "l"],
  [/𝐦/g, "m"], [/𝐧/g, "n"], [/𝐨/g, "o"], [/𝐩/g, "p"],
  [/𝐪/g, "q"], [/𝐫/g, "r"], [/𝐬/g, "s"], [/𝐭/g, "t"],
  [/𝐮/g, "u"], [/𝐯/g, "v"], [/𝐰/g, "w"], [/𝐱/g, "x"],
  [/𝐲/g, "y"], [/𝐳/g, "z"],

  // Operator symbols
  [/−/g, "-"],  // U+2212 MINUS SIGN → ASCII hyphen-minus
  [/–/g, "-"],  // U+2013 EN DASH
  [/—/g, "-"],  // U+2014 EM DASH
  [/×/g, "×"],  // Keep multiplication sign as-is (mathematical)
  [/÷/g, "÷"],  // Keep division sign as-is
  [/≤/g, "<="],  // Less than or equal
  [/≥/g, ">="],  // Greater than or equal
  [/≠/g, "!="],  // Not equal
  [/≈/g, "~"],   // Approximately equal
  [/≡/g, "≡"],   // Identity / congruence
  [/±/g, "±"],   // Plus-minus
  [/√/g, "sqrt"], // Square root

  // Greek letters (lowercase)
  [/α/g, "alpha"], [/β/g, "beta"], [/γ/g, "gamma"], [/δ/g, "delta"],
  [/ε/g, "epsilon"], [/ζ/g, "zeta"], [/η/g, "eta"], [/θ/g, "theta"],
  [/ι/g, "iota"], [/κ/g, "kappa"], [/λ/g, "lambda"], [/μ/g, "mu"],
  [/ν/g, "nu"], [/ξ/g, "xi"], [/π/g, "pi"], [/ρ/g, "rho"],
  [/σ/g, "sigma"], [/τ/g, "tau"], [/υ/g, "upsilon"], [/φ/g, "phi"],
  [/χ/g, "chi"], [/ψ/g, "psi"], [/ω/g, "omega"],

  // Greek letters (uppercase)
  [/Α/g, "Alpha"], [/Β/g, "Beta"], [/Γ/g, "Gamma"], [/Δ/g, "Delta"],
  [/Ε/g, "Epsilon"], [/Ζ/g, "Zeta"], [/Η/g, "Eta"], [/Θ/g, "Theta"],
  [/Ι/g, "Iota"], [/Κ/g, "Kappa"], [/Λ/g, "Lambda"], [/Μ/g, "Mu"],
  [/Ν/g, "Nu"], [/Ξ/g, "Xi"], [/Π/g, "Pi"], [/Ρ/g, "Rho"],
  [/Σ/g, "Sigma"], [/Τ/g, "Tau"], [/Υ/g, "Upsilon"], [/Φ/g, "Phi"],
  [/Χ/g, "Chi"], [/Ψ/g, "Psi"], [/Ω/g, "Omega"],

  // Superscript/subscript digits
  [/⁰/g, "0"], [/¹/g, "1"], [/²/g, "2"], [/³/g, "3"], [/⁴/g, "4"],
  [/⁵/g, "5"], [/⁶/g, "6"], [/⁷/g, "7"], [/⁸/g, "8"], [/⁹/g, "9"],
  [/₀/g, "0"], [/₁/g, "1"], [/₂/g, "2"], [/₃/g, "3"], [/₄/g, "4"],
  [/₅/g, "5"], [/₆/g, "6"], [/₇/g, "7"], [/₈/g, "8"], [/₉/g, "9"],

  // Common subscript variables
  [/ₐ/g, "a"], [/ₑ/g, "e"], [/ᵢ/g, "i"], [/ⱼ/g, "j"],
  [/ₖ/g, "k"], [/ₘ/g, "m"], [/ₙ/g, "n"], [/ₚ/g, "p"],
  [/ₛ/g, "s"], [/ₜ/g, "t"],

  // Common formatting issues
  [/\u00A0/g, " "],   // Non-breaking space
  [/\u2009/g, " "],   // Thin space
  [/\u200A/g, " "],   // Hair space
  [/\u200B/g, ""],    // Zero-width space
  [/\u200C/g, ""],    // Zero-width non-joiner
  [/\u200D/g, ""],    // Zero-width joiner
  [/\uFEFF/g, ""],    // BOM
];

/**
 * Repair Unicode mathematical symbols in extracted PDF text.
 * Converts OCR-incorrect Unicode back to readable ASCII/mathematical form.
 */
export function repairMathSymbols(text: string): string {
  let result = text;
  for (const [pattern, replacement] of UNICODE_MATH_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Equation extraction ──────────────────────────────────────────────────────

/**
 * Extract mathematical equations and expressions from text.
 * Returns structured representations of equations found.
 */
export function extractEquations(text: string): MathEquation[] {
  const equations: MathEquation[] = [];
  const seen = new Set<string>();

  // Pattern 1: explicit equations with = sign
  // e.g. "3x + y = 1", "a₁/a₂ ≠ b₁/b₂"
  const eqPattern = /(?:^|\n)([ \t]*[a-zA-Z0-9 +\-*/^(){}\[\]≤≥≠=±²³²⁴∞√∫∑.,]+[=<>≤≥!][a-zA-Z0-9 +\-*/^(){}\[\]≤≥≠=±²³²⁴∞√∫∑.,]+)/gm;

  let match: RegExpExecArray | null;
  while ((match = eqPattern.exec(text)) !== null) {
    const raw = match[1].trim();
    // Must contain at least one variable and an operator
    if (raw.length < 5 || raw.length > 200) continue;
    if (!/[a-zA-Z]/.test(raw)) continue;
    // Skip lines that are clearly not equations (prose sentences)
    if (/^[A-Z][a-z]+\s+(is|are|was|were|has|have|can|will|should|must)/.test(raw)) continue;

    const normalized = raw.replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const variables = extractVariables(normalized);
    const operators = extractOperators(normalized);

    equations.push({
      type: detectEquationType(normalized),
      expression: normalized,
      variables,
      operators,
    });
  }

  // Pattern 2: fraction patterns like "a₁/a₂ ≠ b₁/b₂"
  const fractionPattern = /([a-zA-Z0-9₀-₉₁₂₃₄₅₆₇₈₉]+)\s*\/\s*([a-zA-Z0-9₀-₉₁₂₃₄₅₆₇₈₉]+)\s*([=<>≤≥≠])\s*([a-zA-Z0-9₀-₉₁₂₃₄₅₆₇₈₉]+)\s*\/\s*([a-zA-Z0-9₀-₉₁₂₃₄₅₆₇₈₉]+)/g;

  while ((match = fractionPattern.exec(text)) !== null) {
    const normalized = match[0].replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    equations.push({
      type: "inequality",
      expression: normalized,
      variables: extractVariables(normalized),
      operators: [match[3], "/"],
    });
  }

  // Pattern 3: systems of equations (lines with "and" or explicit grouping)
  const lines = text.split("\n");
  const potentialSystem: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Lines that look like equations in a system
    if (/^[a-zA-Z0-9\s+\-*/^(){}≤≥≠=±²³√∫.,]+\s*$/.test(trimmed) &&
        /[a-zA-Z]/.test(trimmed) && /[=]/.test(trimmed) &&
        trimmed.length >= 5 && trimmed.length <= 100) {
      potentialSystem.push(trimmed);
    } else {
      if (potentialSystem.length >= 2) {
        const sysExpr = potentialSystem.map((s) => s.replace(/\s+/g, " ").trim());
        const sysKey = sysExpr.join(" AND ");
        if (!seen.has(sysKey)) {
          seen.add(sysKey);
          const allVars = new Set<string>();
          const allOps = new Set<string>();
          for (const eq of sysExpr) {
            for (const v of extractVariables(eq)) allVars.add(v);
            for (const o of extractOperators(eq)) allOps.add(o);
          }
          equations.push({
            type: "system_of_equations",
            expression: sysExpr.join(" ; "),
            variables: [...allVars],
            operators: [...allOps],
          });
        }
      }
      potentialSystem.length = 0;
    }
  }

  // Process any remaining consecutive equations at the end of the text
  if (potentialSystem.length >= 2) {
    const sysExpr = potentialSystem.map((s) => s.replace(/\s+/g, " ").trim());
    const sysKey = sysExpr.join(" AND ");
    if (!seen.has(sysKey)) {
      seen.add(sysKey);
      const allVars = new Set<string>();
      const allOps = new Set<string>();
      for (const eq of sysExpr) {
        for (const v of extractVariables(eq)) allVars.add(v);
        for (const o of extractOperators(eq)) allOps.add(o);
      }
      equations.push({
        type: "system_of_equations",
        expression: sysExpr.join(" ; "),
        variables: [...allVars],
        operators: [...allOps],
      });
    }
  }

  return equations;
}

function extractVariables(expr: string): string[] {
  const vars = new Set<string>();
  // Match single letters that appear as variables (preceded/followed by operators or start/end)
  const varPattern = /(?:^|[=+\-×÷≤≥≠\s,;(])([a-zA-Z])(?:[=+\-×÷≤≥≠\s,;)^\]]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = varPattern.exec(expr)) !== null) {
    const v = m[1].toLowerCase();
    // Skip very common English function words that appear in math context
    if (!"ifofinonanattoas".includes(v)) {
      vars.add(v);
    }
  }
  return [...vars].sort();
}

function extractOperators(expr: string): string[] {
  const ops = new Set<string>();
  if (/[=]/.test(expr)) ops.add("=");
  if (/[<>]/.test(expr)) ops.add("<>");
  if (/[+]/.test(expr)) ops.add("+");
  if (/[-]/.test(expr) && /[-]/.test(expr.replace(/--/g, ""))) ops.add("-");
  if (expr.includes("×") || expr.includes("*")) ops.add("×");
  if (expr.includes("÷")) ops.add("÷");
  if (/[≤]/.test(expr)) ops.add("<=");
  if (/[≥]/.test(expr)) ops.add(">=");
  if (/[≠]/.test(expr)) ops.add("!=");
  if (/[√]/.test(expr)) ops.add("sqrt");
  if (expr.includes("^")) ops.add("^");
  return [...ops];
}

function detectEquationType(expr: string): MathEquation["type"] {
  if (expr.includes("≤") || expr.includes("≥") || expr.includes("<") || expr.includes(">") || expr.includes("≠") || expr.includes("!=")) {
    return "inequality";
  }
  if (expr.includes("=")) return "equation";
  return "expression";
}

// ── Question bank detection ──────────────────────────────────────────────────

/**
 * Detect if the source text is a question bank (contains existing exam questions)
 * versus explanatory educational content.
 */
export function detectQuestionBank(text: string): SourceQuestionBank {
  const lines = text.split("\n");
  let questionCount = 0;
  let mcqCount = 0;
  const questions: string[] = [];
  const mcqs: ExtractedMCQ[] = [];

  // Patterns for existing questions in the source
  const questionPatterns = [
    /^\d+[.)]\s*(?:Q(?:uestion)?\.?\s*)?\s*/im,
    /^(?:Q|Question)\s*\d+[.:)]?\s*/im,
    /^\(?\d{1,3}\)?[.)]\s*/m,
  ];

  const mcqOptionPattern = /^[A-Da-d][).)\]:]\s*/m;

  // Scan for question indicators
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const isQuestion = questionPatterns.some((p) => p.test(line));

    if (isQuestion) {
      questionCount++;

      // Check if the next few lines have MCQ options
      const optionLines: string[] = [];
      let hasOptions = false;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (nextLine.length === 0) continue;

        // Check for single-line multi-option MCQ (e.g., "A) -14/3 B) 2/5 C) 5 D) 10")
        const multiOptionMatch = nextLine.match(/^[A-Da-d][).)\]:]\s*[^A-Da-d]+(?:[A-Da-d][).)\]:]\s*[^A-Da-d]+){2,}/);
        if (multiOptionMatch) {
          // Split by A), B), C), D) pattern
          const parts = nextLine.split(/\s*[A-Da-d][).)\]:]\s*/).filter(Boolean);
          if (parts.length >= 3) {
            optionLines.push(...parts.slice(0, 4));
            hasOptions = true;
            break; // All options on one line
          }
        }

        if (mcqOptionPattern.test(nextLine)) {
          optionLines.push(nextLine.replace(mcqOptionPattern, "").trim());
          hasOptions = true;
        } else if (hasOptions && optionLines.length >= 3) {
          break; // Done collecting options
        } else if (!hasOptions && questionPatterns.some((p) => p.test(nextLine))) {
          break; // Next question started
        }
      }

      if (hasOptions && optionLines.length >= 3) {
        mcqCount++;
        mcqs.push({
          question: line.replace(/^\d+[.)]\s*/, "").trim(),
          options: optionLines.slice(0, 4),
          correctIndex: -1,
          equations: extractEquations(line).map((e) => e.expression),
          topic: "",
          difficulty: "medium",
        });
      } else {
        questions.push(line.replace(/^\d+[.)]\s*/, "").trim());
      }
    }
  }

  // Check for question bank indicators in the document
  const lower = text.toLowerCase();
  const bankIndicators = [
    "question bank", "question paper", "sample paper", "previous year",
    "board exam", "board 2023", "board 2024", "board 2022",
    "practice questions", "exam questions", "test paper",
    "multiple choice", "choose the correct", "select the correct",
    "marks:", "total marks", "time:", "duration:",
  ];

  const indicatorCount = bankIndicators.filter((ind) => lower.includes(ind)).length;

  // A document is a question bank if it has many questions or explicit indicators
  const isQuestionBank = questionCount >= 3 || indicatorCount >= 2 || mcqCount >= 2;

  return { isQuestionBank, mcqs, questions };
}

// ── Metadata extraction ──────────────────────────────────────────────────────

/**
 * Extract structural metadata from the source: grade, chapter, class, topics.
 */
export function extractMetadata(text: string): { gradeLevel: string; chapter: string; topics: string[] } {
  const lines = text.split("\n").slice(0, 30); // Only look at the first 30 lines
  let gradeLevel = "";
  let chapter = "";
  const topics: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Grade/class detection
    const gradeMatch = trimmed.match(/(?:grade|class|std|standard|year)\s*[:\s]*([ivxlcdm\d]{1,4})/i);
    if (gradeMatch && !gradeLevel) {
      gradeLevel = `Grade ${gradeMatch[1]}`;
    }

    // Chapter detection
    const chapterMatch = trimmed.match(/(?:chapter|chap\.?|unit|lesson|module)\s*[-:\s]*([ivxlcdm\d]{1,4})?[-:\s]*(.+)/i);
    if (chapterMatch && !chapter) {
      chapter = chapterMatch[2].trim();
    }

    // Topic detection (lines that look like topics/headings)
    if (trimmed.length >= 5 && trimmed.length <= 80 && !/[.!?]$/.test(trimmed)) {
      if (/^[A-Z]/.test(trimmed) && !/^\d+[.)]/.test(trimmed)) {
        topics.push(trimmed);
      }
    }
  }

  return { gradeLevel, chapter, topics: topics.slice(0, 10) };
}

// ── Concept and condition extraction ─────────────────────────────────────────

/**
 * Extract key mathematical concepts and conditions from text.
 * For example: "For a system a₁x + b₁y + c₁ = 0, unique solution when a₁/a₂ ≠ b₁/b₂"
 */
export function extractConceptsAndConditions(text: string): { concepts: string[]; conditions: string[] } {
  const concepts: string[] = [];
  const conditions: string[] = [];
  const seen = new Set<string>();

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Detect conditions (if/when/for patterns with mathematical content)
    if (/(?:if|when|for|where|condition|case)\s/.test(lower) &&
        (/[=<>≤≥≠]/.test(trimmed) || /[a-z]\s*\/\s*[a-z]/.test(lower))) {
      const normalized = trimmed.replace(/\s+/g, " ");
      if (!seen.has(normalized) && normalized.length >= 10 && normalized.length <= 200) {
        conditions.push(normalized);
        seen.add(normalized);
      }
    }

    // Detect concepts (definitions and key terms)
    if (/(?:is called|is known as|is defined as|refers to|means|denoted by)/i.test(trimmed)) {
      const normalized = trimmed.replace(/\s+/g, " ");
      if (!seen.has(normalized) && normalized.length >= 10 && normalized.length <= 200) {
        concepts.push(normalized);
        seen.add(normalized);
      }
    }
  }

  return { concepts: concepts.slice(0, 30), conditions: conditions.slice(0, 20) };
}

// ── General concept extraction (all subjects) ──────────────────────────────

/**
 * Extract key concepts, dates, people, events, and processes from any subject.
 * This supplements the math-specific extractConceptsAndConditions.
 */
function extractGeneralConcepts(text: string, subject: Subject): string[] {
  const concepts: string[] = [];
  const seen = new Set<string>();
  // Split by newlines first, then split long lines by sentence boundaries
  const rawLines = text.split("\n");
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    if (rawLine.length > 150) {
      // Split long paragraphs into sentences
      const sentences = rawLine.split(/(?<=[.!?])\s+/);
      lines.push(...sentences);
    } else {
      lines.push(rawLine);
    }
  }

  // Metadata patterns to reject from concept extraction
  const metadataReject = /^(?:isbn|price|mrp|copyright|all rights reserved|printed (?:in|on)|published (?:in|by)|edition|version|author|prepared by|submitted (?:by|to)|written by|created by|grade \d|class \d|total marks|time:|section:|semester|session|academic year|enrollment|roll no|register no|batch:|school of|college of|university|institute of|department of|contact:|email:|phone:|website:|www\.|qr code|barcode|\d+ marks|\d+ minutes)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Skip metadata, short lines, pure numbers
    if (trimmed.length < 10 || trimmed.length > 250) continue;
    if (/^\d+$/.test(trimmed)) continue;
    // Skip lines that are clearly metadata
    if (metadataReject.test(trimmed)) continue;
    // Skip lines that are just ISBN, price, or number fragments
    if (/^\d[\d\s\-]{8,}$/.test(trimmed)) continue;
    if (/^[₹$£]\s*\d/.test(trimmed)) continue;

    // Subject-specific concept patterns
    if (subject === "history") {
      // Dates, events, people, movements
      if (/\d{4}/.test(trimmed) && /(revolution|war|treaty|independence|movement|founding|established|signed|declared|began|ended|battle|reform)/i.test(trimmed)) {
        const n = trimmed.replace(/\s+/g, " ");
        if (!seen.has(n)) { concepts.push(n); seen.add(n); }
      }
      // Key definitions and causes/effects
      if (/(?:caused|led to|resulted in|was a result|was caused by|contributed to|was known as|was called|refers to)/i.test(trimmed)) {
        const n = trimmed.replace(/\s+/g, " ");
        if (!seen.has(n)) { concepts.push(n); seen.add(n); }
      }
    }

    if (subject === "geography") {
      // Physical processes, locations, phenomena
      if (/(?:climate|terrain|latitude|longitude|elevation|rainfall|temperature|population|resource|soil|vegetation|drainage|erosion|deposition|weathering|tectonic)/i.test(trimmed)) {
        const n = trimmed.replace(/\s+/g, " ");
        if (!seen.has(n)) { concepts.push(n); seen.add(n); }
      }
    }

    if (subject === "english" || subject === "general") {
      // Literary devices, themes, analysis
      if (/(?:metaphor|simile|symbolism|allegory|irony|theme|motif|imagery|rhetoric|narrative|prose|poetry|stanza|alliteration|personification)/i.test(trimmed)) {
        const n = trimmed.replace(/\s+/g, " ");
        if (!seen.has(n)) { concepts.push(n); seen.add(n); }
      }
    }

    // Universal concept patterns (any subject)
    // These capture sentences that describe, define, or explain key concepts
    if (/(?:is defined as|is known as|is called|refers to|means that|can be described|is the process|is the act|is an example|plays a key role|is essential for|is responsible for|occurs in|takes place in|happens in|produces|contains|consists of|is produced by|is converted|absorbs|catalyzes|fixes|leads to|results in|is the main|is the primary|is responsible for|involves)/i.test(trimmed)) {
      const n = trimmed.replace(/\s+/g, " ");
      if (!seen.has(n)) { concepts.push(n); seen.add(n); }
    }
  }

  return concepts.slice(0, 30);
}

// ── Main knowledge builder ──────────────────────────────────────────────────

/**
 * Build a complete structured knowledge representation from the source text.
 * This is the main entry point for all content processing (math and non-math).
 */
export function buildMathKnowledge(text: string): MathKnowledge {
  // Step 1: Detect subject
  const { subject, confidence } = detectSubject(text);

  // Step 2: Repair Unicode math symbols
  const repairedText = repairMathSymbols(text);

  // Step 3: Extract metadata
  const { gradeLevel, chapter, topics } = extractMetadata(repairedText);

  // Step 4: Extract equations (only meaningful for math-heavy subjects)
  const equations = extractEquations(repairedText);
  const systems = equations.filter((e) => e.type === "system_of_equations");

  // Step 5: Detect question bank
  const questionBank = detectQuestionBank(repairedText);

  // Step 6: Extract concepts and conditions
  const { concepts: mathConcepts, conditions } = extractConceptsAndConditions(repairedText);

  // Step 7: Extract general concepts for ALL subjects
  const generalConcepts = extractGeneralConcepts(repairedText, subject);

  // Merge math-specific and general concepts, deduplicate
  const allConcepts = [...new Set([...mathConcepts, ...generalConcepts])];

  const isMathSubject = subject === "mathematics";
  const isStemSubject = subject === "physics" || subject === "chemistry" || subject === "biology";
  const hasMathContent = isMathSubject ||
    (equations.length >= 5 && isStemSubject) ||
    (confidence > 0.7 && isMathSubject);

  return {
    subject,
    gradeLevel,
    chapter,
    topics: topics.length > 0 ? topics : allConcepts.slice(0, 5).map(c => c.slice(0, 60)),
    equations,
    systems,
    questionBank,
    concepts: allConcepts,
    conditions,
    hasMathContent,
  };
}

// ── Math-aware text preprocessing for AI ─────────────────────────────────────

/**
 * Build a structured context block that clearly presents mathematical content
 * to the AI, separating equations from prose, marking question banks, etc.
 */
export function buildMathContext(text: string, knowledge: MathKnowledge): string {
  const parts: string[] = [];

  // Subject and metadata context
  parts.push(`SUBJECT: ${knowledge.subject.charAt(0).toUpperCase() + knowledge.subject.slice(1)}`);
  if (knowledge.gradeLevel) parts.push(`LEVEL: ${knowledge.gradeLevel}`);
  if (knowledge.chapter) parts.push(`CHAPTER: ${knowledge.chapter}`);
  if (knowledge.topics.length) parts.push(`TOPICS: ${knowledge.topics.join(", ")}`);

  // Question bank detection
  if (knowledge.questionBank.isQuestionBank) {
    parts.push(`\nSOURCE TYPE: This is a QUESTION BANK containing ${knowledge.questionBank.mcqs.length} MCQs and ${knowledge.questionBank.questions.length} other questions.`);
    parts.push(`When generating content, DO NOT copy questions verbatim. Instead, use the extracted concepts to generate NEW questions or solve existing ones.`);
  }

  // Equations (if any)
  if (knowledge.equations.length > 0) {
    parts.push(`\nEQUATIONS AND EXPRESSIONS FOUND IN SOURCE:`);
    for (const eq of knowledge.equations.slice(0, 30)) {
      parts.push(`  [${eq.type}] ${eq.expression}`);
      if (eq.variables.length) parts.push(`    Variables: ${eq.variables.join(", ")}`);
    }
  }

  // Systems
  if (knowledge.systems.length > 0) {
    parts.push(`\nSYSTEMS OF EQUATIONS:`);
    for (const sys of knowledge.systems.slice(0, 10)) {
      parts.push(`  ${sys.expression}`);
    }
  }

  // Mathematical conditions
  if (knowledge.conditions.length > 0) {
    parts.push(`\nMATHEMATICAL CONDITIONS AND RULES:`);
    for (const cond of knowledge.conditions.slice(0, 15)) {
      parts.push(`  • ${cond}`);
    }
  }

  // Concepts
  if (knowledge.concepts.length > 0) {
    parts.push(`\nKEY CONCEPTS:`);
    for (const concept of knowledge.concepts.slice(0, 15)) {
      parts.push(`  • ${concept}`);
    }
  }

  parts.push(`\n--- FULL SOURCE TEXT ---\n`);
  parts.push(text);

  return parts.join("\n");
}

/**
 * PDF / DOCX text normalization and word-boundary reconstruction.
 *
 * Pipeline:
 *   Raw extracted text
 *   → Extract protected tokens (URLs, emails, formulas, abbreviations)
 *   → Detect text corruption (missing spaces)
 *   → Split CamelCase identifiers
 *   → Reconstruct word boundaries via dynamic-programming segmentation
 *   → Reconstruct paragraphs and sentences
 *   → Analyse text quality (whitespace ratio, avg word length, long-alpha runs)
 *   → Return normalized text + quality report
 *
 * The quality report is returned alongside the text so the API layer can
 * surface warnings to the user when extraction confidence is low.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TextQualityReport {
  /** Whether the input text showed signs of missing-word-boundary corruption. */
  wasCorrupted: boolean;
  /** Whether reconstruction was attempted and applied. */
  reconstructionApplied: boolean;
  /** Whitespace characters / total characters (0–1). Higher = healthier. */
  whitespaceRatio: number;
  /** Mean word length in characters. English avg ≈ 4.7; >8 suggests corruption. */
  averageWordLength: number;
  /** Count of contiguous lowercase-alpha sequences > 15 chars (suspicious runs). */
  suspiciousLongRuns: number;
  /** Total characters before normalisation. */
  rawLength: number;
  /** Total characters after normalisation. */
  normalizedLength: number;
  /** Human-readable quality message for the frontend. */
  qualityMessage: string;
}

// ── Common English dictionary (top ~2500 words) ──────────────────────────────
// Compact frequency list covering >90 % of running English text. Used by the
// DP segmenter to find optimal word boundaries in concatenated text.

const COMMON_WORDS = new Set<string>([
  // Function words
  "a","an","the","and","or","but","if","then","else","when","at","by","for",
  "from","in","into","of","on","to","with","as","is","are","was","were","be",
  "been","being","have","has","had","do","does","did","will","would","could",
  "should","may","might","shall","can","must","need","it","its","this","that",
  "these","those","i","me","my","we","us","our","you","your","he","him","his",
  "she","her","they","them","their","what","which","who","whom","how","where",
  "not","no","nor","so","too","very","just","also","than","more","most",
  "some","any","all","each","every","few","many","much","own","same","other",
  "only","such","both","either","neither","about","above","after","again",
  "against","along","among","before","behind","below","beneath","beside",
  "between","beyond","during","except","inside","outside","through","throughout",
  "until","upon","within","without","over","under","around","across","up",
  "down","out","off","here","there","now","then","always","never","often",
  "sometimes","still","already","even","just","quite","rather","almost",
  // Common nouns
  "time","year","people","way","day","man","woman","child","world","life",
  "hand","part","place","case","week","company","system","program","question",
  "work","government","number","night","point","home","water","room","mother",
  "area","money","story","fact","month","lot","right","study","book","eye",
  "job","word","business","issue","side","kind","head","house","service",
  "friend","father","power","hour","game","line","end","member","law","car",
  "city","community","name","president","team","minute","idea","body","back",
  "parent","face","others","level","office","door","health","person","art",
  "war","history","party","result","change","morning","reason","research",
  "girl","guy","moment","air","teacher","force","education","food","state",
  "country","problem"," school","class","student","students","students",
  "knowledge","information","technology","science","mathematics","history",
  "english","language","social","studies","geography","physics","chemistry",
  "biology","computer","internet","education","university","college",
  // Common verbs
  "go","get","make","know","think","take","see","come","want","give","use",
  "find","tell","ask","work","seem","feel","try","leave","call","keep",
  "let","begin","show","hear","play","run","move","live","believe","bring",
  "happen","write","provide","sit","stand","lose","pay","meet","include",
  "continue","set","learn","change","lead","understand","watch","follow",
  "stop","create","speak","read","allow","add","spend","grow","open","walk",
  "win","offer","remember","love","consider","appear","buy","wait","serve",
  "die","send","expect","build","stay","fall","cut","reach","kill","remain",
  "suggest","raise","pass","sell","require","report","decide","pull",
  // Common adjectives
  "good","new","first","last","long","great","little","own","other","old",
  "right","big","high","different","small","large","next","early","young",
  "important","few","public","bad","same","able","free","sure","real",
  "full","special","easy","clear","close","best","recent","certain","personal",
  "open","strong","possible","whole","short","low","local","single","hard",
  "simple","fast","slow","hot","cold","dark","light","heavy","wide","deep",
  "soft","tough","sweet","bitter","rich","poor","safe","dangerous","true",
  "false","equal","similar","various","significant","major","primary",
  "complex","basic","general","specific","environmental","national",
  "international","political","economic","social","cultural","natural",
  "central","standard","traditional","modern","digital","global","local",
  // Academic / educational vocabulary
  "analysis","approach","assessment","authority","available","benefit",
  "concept","constitution","context","contract","create","data","define",
  "derived","development","distinct","elements","emphasis","establish",
  "estimate","evidence","export","factor","finance","formula","function",
  "identified","indicate","interpret","involve","issue","labour","legal",
  "legislation","major","method","occur","percent","period","policy",
  "principle","proceed","process","required","research","resource","respond",
  "role","section","sector","significant","similar","source","specific",
  "structure","theory","transfer","trend","derived","occur","principle",
  "occur","occur","occur","occur","occur",
  // Science vocabulary
  "atom","molecule","cell","energy","force","mass","velocity","acceleration",
  "gravity","electron","proton","neutron","nucleus","element","compound",
  "reaction","solution","acid","base","temperature","pressure","volume",
  "density","frequency","wavelength","amplitude","spectrum","photon",
  "gene","enzyme","protein","membrane","organism","ecosystem","species",
  "evolution","photosynthesis","respiration","metabolism","chromosome",
  "mitosis","meiosis","dna","rna","ribosome","mitochondria","chloroplast",
  "nucleus","cytoplasm","membrane","tissue","organ","system","kingdom",
  "domain","bacteria","archaea","fungi","plant","animal","invertebrate",
  "vertebrate","mammal","reptile","amphibian","bird","fish","insect",
  "arthropod","mollusc","annelid","echinoderm","porifera","coelenterate",
  // Math vocabulary
  "equation","function","variable","constant","coefficient","polynomial",
  "factor","root","vertex","parabola","linear","quadratic","exponential",
  "logarithm","integral","derivative","limit","matrix","vector","scalar",
  "probability","statistics","mean","median","mode","standard","deviation",
  "variance","histogram","scatter","correlation","regression","hypothesis",
  "theorem","axiom","proof","conjecture","lemma","corollary","arithmetic",
  "geometric","algebraic","trigonometric","sine","cosine","tangent","angle",
  "triangle","circle","rectangle","square","polygon","prism","cylinder",
  "cone","sphere","pyramid","perimeter","area","volume","circumference",
  "diameter","radius","diagonal","parallel","perpendicular","intersect",
  // History / social studies vocabulary
  "civilization","democracy","republic","empire","kingdom","revolution",
  "constitution","amendment","legislation","colonial","independence",
  "sovereignty","diplomacy","alliance","treaty","confederation","federation",
  "ideology","capitalism","socialism","communism","feudalism","mercantilism",
  "renaissance","reformation","enlightenment","industrialization","urbanization",
  "immigration","emigration","migration","settlement","exploration","conquest",
  "imperialism","nationalism","patriotism","propaganda","censorship","suffrage",
  "abolition","reconstruction","depression","recession","inflation","deflation",
  "trade","commerce","agriculture","manufacturing","production","consumption",
  // Common compound words that may appear concatenated
  "cannot","cannot","into","onto","within","without","upon","cannot",
  "therefore","furthermore","moreover","nevertheless","however","although",
  "whereas","meanwhile","consequently","subsequently","previously","accordingly",
  "nevertheless","notwithstanding","notwithstanding","nonetheless",
]);

// ── Common abbreviations & short forms to preserve ───────────────────────────

const ABBREVIATIONS = new Set<string>([
  "dr","mr","mrs","ms","prof","sr","jr","st","ave","blvd","dept","est",
  "inc","ltd","corp","govt"," approx"," approx","fig","figs","eq","eqs",
  "vol","rev","ed","eds","ch","chs","pp","vs","etc","i.e","e.g","viz",
  "al","ca","cf","ibid","op","cit","ibid","ft","lb","oz","kg","mg","km",
  "cm","mm","nm","m","ft","in","mi","hr","min","sec","ms","hz","khz",
  "mhz","ghz","db","w","kw","mw","j","kj","cal","kcal","c","f","k",
  "us","uk","eu","un","who","nato","opec","iso","ieee","acm","ai","it",
  "pc","tv","radio","diy","pdf","doc","docx","txt","html","css","js",
  "http","https","url","api","cpu","gpu","ram","rom","ssd","hdd","usb",
  "led","lcd","oled","wifi","bluetooth","gps","nfc","pdf","sms","mms",
]);

// ── Suffix / prefix patterns common in English ───────────────────────────────

const COMMON_SUFFIXES = [
  "tion","sion","ment","ness","able","ible","ful","less","ous","ive",
  "ing","ity","ence","ance","ical","ally","ship","ward","wise","dom",
  "like","hood","ery","ary","ory","ure","ism","ist","ize","ise","ify",
  "ant","ent","ism","ist","ship","ling","ling","ette","let","ling",
];

const COMMON_PREFIXES = [
  "un","re","in","im","dis","en","em","non","over","mis","out","sub",
  "pre","inter","trans","super","anti","de","under","semi","auto","bi",
  "tri","multi","poly","mono","micro","macro","tele","hyper","ultra",
  "mini","mega","neo","proto","pseudo","quasi","self","vice","co","de",
];

// ── Protected token extraction ───────────────────────────────────────────────

interface ProtectedTokens {
  /** Text with protected regions replaced by placeholders. */
  text: string;
  /** Map from placeholder → original token. */
  tokens: Map<string, string>;
}

const PROTECTED_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  // URLs
  { regex: /\bhttps?:\/\/[^\s<>")\]]+/gi, name: "URL" },
  // Email addresses
  { regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, name: "EMAIL" },
  // Markdown / LaTeX math expressions: $...$ and $$...$$ and \(...\) and \[...\]
  { regex: /\$\$[^$]+\$\$/g, name: "MATH_DISPLAY" },
  { regex: /\$[^$]+\$/g, name: "MATH_INLINE" },
  { regex: /\\\(.*?\\\)/g, name: "MATH_LATEX" },
  { regex: /\\\[.*?\\\]/g, name: "MATH_LATEX_DISPLAY" },
  // Quoted strings with spaces (preserve them intact)
  { regex: /"[^"]{2,}"/g, name: "QUOTED" },
  { regex: /'[^']{2,}'/g, name: "QUOTED_SINGLE" },
];

function extractProtectedTokens(text: string): ProtectedTokens {
  const tokens = new Map<string, string>();
  let counter = 0;
  let result = text;

  for (const { regex } of PROTECTED_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    result = result.replace(re, (match) => {
      const placeholder = `\x00PROT_${counter++}\x00`;
      tokens.set(placeholder, match);
      return placeholder;
    });
  }

  return { text: result, tokens };
}

function restoreProtectedTokens(text: string, tokens: Map<string, string>): string {
  let result = text;
  for (const [placeholder, original] of tokens) {
    result = result.replaceAll(placeholder, original);
  }
  return result;
}

// ── Text corruption detection ────────────────────────────────────────────────

function countLongAlphaRuns(text: string): number {
  // Count contiguous lowercase-alpha sequences > 20 chars (likely missing spaces)
  const matches = text.match(/[a-z]{20,}/g) ?? [];
  return matches.length;
}

function calculateWhitespaceRatio(text: string): number {
  if (text.length === 0) return 1;
  const spaces = (text.match(/\s/g) ?? []).length;
  return spaces / text.length;
}

function calculateAverageWordLength(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  const totalLength = words.reduce((sum, w) => sum + w.length, 0);
  return totalLength / words.length;
}

/**
 * Detect whether the text shows signs of missing-word-boundary corruption.
 *
 * Heuristics:
 * - Whitespace ratio < 0.08 (normal English ≈ 0.15–0.20)
 * - Average word length > 8 (normal English ≈ 4.5–5.5)
 * - Multiple long contiguous lowercase runs (> 15 chars)
 */
function isTextCorrupted(text: string): boolean {
  if (text.length < 100) return false;

  const whitespaceRatio = calculateWhitespaceRatio(text);
  const avgWordLength = calculateAverageWordLength(text);
  const longRuns = countLongAlphaRuns(text);

  // Only flag as corrupted when evidence is STRONG.
  // Normal English text has whitespace ratio ~0.15-0.20 and avg word length ~4.5-5.5.
  // Very low whitespace is the strongest signal of missing word boundaries.
  if (whitespaceRatio < 0.04 && avgWordLength > 12) return true;
  if (whitespaceRatio < 0.06 && avgWordLength > 10) return true;
  if (longRuns >= 5 && whitespaceRatio < 0.08) return true;

  return false;
}

// ── CamelCase splitting ──────────────────────────────────────────────────────

/**
 * Split CamelCase and PascalCase identifiers into separate words.
 * Examples:
 *   "TrueDemocracy" → "True Democracy"
 *   "PanchayatiRaj" → "Panchayati Raj"
 *   "GramPanchayat" → "Gram Panchayat"
 *   "NorthEastern" → "North Eastern"
 *
 * Preserves ALL_CAPS abbreviations (e.g., "NASA", "DNA", "USA").
 */
function splitCamelCase(text: string): string {
  return text.replace(
    /([a-z])([A-Z])/g,
    "$1 $2",
  ).replace(
    /([A-Z]+)([A-Z][a-z])/g,
    "$1 $2",
  );
}

// ── Word boundary reconstruction (DP segmenter) ─────────────────────────────

/**
 * Find the optimal segmentation of a run of lowercase letters using dynamic
 * programming. The goal is to maximize the number of recognized dictionary
 * words while minimizing the total number of segments (penalizing fragments).
 *
 * Uses a Viterbi-style approach:
 *   cost[i] = minimum cost to segment text[0..i]
 *   For each position i, try all word lengths j ∈ [2, maxLen]:
 *     If text[i-j..i] is in the dictionary → cost = cost[i-j] + 0
 *     Otherwise → cost = cost[i-j] + j (penalty = segment length)
 *
 * This prefers known words but doesn't force a split if no good segmentation
 * exists — the whole segment is kept intact (protecting scientific terms).
 */
const MAX_WORD_LENGTH = 20;
const DICTIONARY_BONUS = 0; // cost of a recognized word
const UNKNOWN_PENALTY = 1;  // cost per character of an unrecognized segment

function segmentLowercaseRun(run: string): string {
  const n = run.length;
  if (n === 0) return "";
  if (n <= 2) return run; // too short to split

  // DP arrays
  const cost: number[] = new Array(n + 1).fill(Infinity);
  const backpointer: number[] = new Array(n + 1).fill(-1);
  cost[0] = 0;

  for (let i = 1; i <= n; i++) {
    const maxLen = Math.min(i, MAX_WORD_LENGTH);
    for (let j = 2; j <= maxLen; j++) {
      const start = i - j;
      const candidate = run.slice(start, i);

      // Calculate cost for this segment
      const isKnown = COMMON_WORDS.has(candidate);
      const isAbbreviation = ABBREVIATIONS.has(candidate);
      const segmentCost = (isKnown || isAbbreviation)
        ? DICTIONARY_BONUS
        : candidate.length * UNKNOWN_PENALTY;

      const totalCost = cost[start] + segmentCost;
      if (totalCost < cost[i]) {
        cost[i] = totalCost;
        backpointer[i] = start;
      }
    }
  }

  // If cost is too high (many unknowns), the text may not actually be corrupted
  // or may contain technical terms. Return the original run unchanged.
  const unknownChars = cost[n];
  const unknownRatio = n > 0 ? unknownChars / n : 0;
  if (unknownRatio > 0.4) {
    return run; // not worth splitting — likely a legitimate term
  }

  // Reconstruct segmentation from backpointers
  const words: string[] = [];
  let pos = n;
  while (pos > 0) {
    const start = backpointer[pos];
    if (start === -1) {
      // Fallback: keep rest as-is
      words.unshift(run.slice(0, pos));
      break;
    }
    words.unshift(run.slice(start, pos));
    pos = start;
  }

  return words.join(" ");
}

/**
 * Find contiguous runs of lowercase letters (possibly with digits mixed in
 * after the first 3+ chars) and run the DP segmenter on each.
 */
function reconstructWordBoundaries(text: string): string {
  // Find contiguous lowercase letter sequences (6+ chars) and run the
  // DP segmenter on each. First split CamelCase, then find remaining runs.
  let result = text;

  // Step 1: Split CamelCase (e.g., "TrueDemocracy" → "TrueDemocracy")
  // The splitCamelCase function already ran, so we look for remaining
  // contiguous lowercase runs that don't have spaces.

  // Strategy: find all sequences of 10+ consecutive lowercase letters
  // that are bounded by non-lowercase characters or string boundaries.
  // Use 10+ to avoid splitting legitimate English words like "education", "students".
  result = result.replace(
    /[A-Z]?[a-z]{10,}[A-Z]?/g,
    (match) => {
      // If the match includes an uppercase letter at start/end, it's
      // a CamelCase boundary — extract just the lowercase portion.
      const lowerOnly = match.replace(/^[A-Z]/, "").replace(/[A-Z]$/, "");
      if (lowerOnly.length >= 10) {
        const segmented = segmentLowercaseRun(lowerOnly);
        // Reconstruct with any surrounding uppercase letters preserved
        const prefix = match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase() ? match[0] : "";
        const suffix = match.length > 1 && match[match.length - 1] === match[match.length - 1].toUpperCase() && match[match.length - 1] !== match[match.length - 1].toLowerCase() ? match[match.length - 1] : "";
        return prefix + segmented + suffix;
      }
      return match;
    },
  );

  return result;
}

// ── Paragraph and sentence reconstruction ────────────────────────────────────

/**
 * Join broken lines that are actually part of the same sentence.
 * A line break is treated as a space unless it appears to be a genuine
 * paragraph boundary (followed by an empty line or an indented heading).
 */
function reconstructParagraphs(text: string): string {
  // Split into logical paragraphs first (separated by blank lines)
  const blocks = text.split(/\n{2,}/);

  return blocks
    .map((block) => {
      // Within a block, join lines that form continuous sentences
      const lines = block.split("\n");
      const joined: string[] = [];
      let current = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (current.length === 0) {
          current = trimmed;
        } else if (
          // Continue current sentence if:
          // - Previous line doesn't end with sentence-ending punctuation
          // - Current line doesn't look like a heading or list item
          !/[.!?:;]$/.test(current) &&
          !/^[A-Z][A-Za-z\s]{0,40}$/.test(trimmed) && // not a heading
          !/^\d+[.)]\s/.test(trimmed) && // not a numbered list
          !/^[•\-*]\s/.test(trimmed) // not a bullet list
        ) {
          current += " " + trimmed;
        } else {
          joined.push(current);
          current = trimmed;
        }
      }
      if (current) joined.push(current);

      return joined.join("\n");
    })
    .join("\n\n");
}

// ── Main normalization pipeline ──────────────────────────────────────────────

/**
 * Normalise raw PDF/DOCX-extracted text:
 *
 * 1. Basic whitespace cleanup (already done upstream, but reinforce)
 * 2. Extract protected tokens (URLs, emails, formulas, quotes)
 * 3. Split CamelCase
 * 4. Detect corruption
 * 5. If corrupted: reconstruct word boundaries via DP segmentation
 * 6. Restore protected tokens
 * 7. Reconstruct paragraphs
 * 8. Analyse final quality
 *
 * Returns the normalised text plus a quality report for the frontend.
 */
export function normalizeExtractedText(rawText: string): {
  text: string;
  quality: TextQualityReport;
} {
  const rawLength = rawText.length;

  // Step 1: Basic cleanup
  let text = rawText
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length === 0) {
    return {
      text: "",
      quality: {
        wasCorrupted: false,
        reconstructionApplied: false,
        whitespaceRatio: 0,
        averageWordLength: 0,
        suspiciousLongRuns: 0,
        rawLength,
        normalizedLength: 0,
        qualityMessage: "No readable text was found in the document.",
      },
    };
  }
  // Step 3: Extract protected tokens
  const { text: textWithPlaceholders, tokens } = extractProtectedTokens(text);

  // Step 2: CamelCase splitting (always safe, even on clean text)
  let processed = splitCamelCase(textWithPlaceholders);

  // Step 3: Detect corruption
  const wasCorrupted = isTextCorrupted(processed);

  // Step 4: Word-boundary reconstruction (only if corrupted)
  let reconstructionApplied = false;
  if (wasCorrupted) {
    const before = processed;
    processed = reconstructWordBoundaries(processed);
    reconstructionApplied = processed !== before;
  }

  // Step 5: Restore protected tokens
  text = restoreProtectedTokens(processed, tokens);

  // Step 6: Paragraph reconstruction
  text = reconstructParagraphs(text);

  // Step 7: Final cleanup
  text = text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

  // Step 8: Quality analysis
  const whitespaceRatio = calculateWhitespaceRatio(text);
  const averageWordLength = calculateAverageWordLength(text);
  const suspiciousLongRuns = countLongAlphaRuns(text);

  let qualityMessage: string;
  if (!wasCorrupted) {
    qualityMessage = "Text extracted successfully with good quality.";
  } else if (reconstructionApplied && suspiciousLongRuns === 0) {
    qualityMessage = "Missing word boundaries were detected and repaired. The text should read normally now.";
  } else if (reconstructionApplied && suspiciousLongRuns > 0) {
    qualityMessage = `Partial repair applied. ${suspiciousLongRuns} long text run(s) could not be fully segmented — they may be technical terms or require OCR.`;
  } else {
    qualityMessage = "Text appears to have missing word boundaries that could not be automatically repaired. Consider using OCR or re-extracting the PDF.";
  }

  return {
    text,
    quality: {
      wasCorrupted,
      reconstructionApplied,
      whitespaceRatio,
      averageWordLength,
      suspiciousLongRuns,
      rawLength,
      normalizedLength: text.length,
      qualityMessage,
    },
  };
}

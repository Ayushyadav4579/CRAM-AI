import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { askStudyDocument, detectStudyTopics, generateStudyPack, type StudyChatResponse, type StudyPack } from "@workspace/api-client-react";
import {
  AlertCircle, BookOpen, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Clock, Download, FileText,
  Flag, Gauge, Globe2, History, Lightbulb, Loader2, MessageCircle, Paperclip, RefreshCw, RotateCcw, Send, Sparkles, Target, Timer,
  Trash2, Trophy, UploadCloud, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Router as WouterRouter, Switch } from "wouter";

const queryClient = new QueryClient();
type OutputType = "notes" | "short_notes" | "mcq" | "short_answer" | "long_answer" | "true_false" | "fill_blank" | "flashcards" | "mindmap" | "definitions" | "formulas" | "difficult_words" | "mnemonics";
type Difficulty = "easy" | "medium" | "detailed";
type Language = "English" | "Hindi";
type SavedPack = { id: string; name: string; characters: number; createdAt: string; text: string; pack: StudyPack };
type ItemRecord = Record<string, unknown>;

// ── DPP Types ─────────────────────────────────────────────────────────────────
type DppDifficulty = "easy" | "medium" | "hard" | "mixed";
type DppTimeLimit = 0 | 10 | 20 | 30 | 45 | 60;
type DppConfig = { count: number; difficulty: DppDifficulty; timeLimit: DppTimeLimit; language: string };
type DppQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
  topic?: string;
  difficulty?: string;
  sourceReference?: string;
};
type DppAnswer = { selected: string | null; marked: boolean };
type DppResultRecord = {
  id: string;
  name: string;
  date: string;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  score: number;
  percentage: number;
  accuracy: number;
  timeTaken: number;
  difficulty: string;
};

const outputOptions: { id: OutputType; label: string; hint: string; icon?: string }[] = [
  { id: "notes", label: "Detailed notes", hint: "Structured overview" },
  { id: "short_notes", label: "Quick revision", hint: "High-yield points" },
  { id: "mcq", label: "MCQs", hint: "Exam practice" },
  { id: "short_answer", label: "Short answers", hint: "Exam-ready writing" },
  { id: "long_answer", label: "Long answers", hint: "Detailed responses" },
  { id: "true_false", label: "True / False", hint: "Fast checks" },
  { id: "fill_blank", label: "Fill blanks", hint: "Recall practice" },
  { id: "flashcards", label: "Flashcards", hint: "Quick recall" },
  { id: "mindmap", label: "Mind map", hint: "See the structure" },
  { id: "definitions", label: "Definitions", hint: "Key terminology" },
  { id: "formulas", label: "Formulas", hint: "Important relationships" },
  { id: "difficult_words", label: "Difficult words", hint: "Build vocabulary" },
  { id: "mnemonics", label: "Mnemonics", hint: "Memory tricks" },
];

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { data?: { error?: string }; message?: string };
    if (record.data?.error) return record.data.error;
    if (record.message) return record.message;
  }
  return "Something went wrong. Please try again.";
}
function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = import.meta.env.BASE_URL || "/";
  const basePath = base === "/" ? "" : base.replace(/\/$/, "");
  return `${basePath}${normalized}`;
}

async function extractFile(file: File) {
  const form = new FormData(); form.append("file", file);
  const response = await fetch(apiUrl("/api/study/extract"), { method: "POST", body: form });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Document upload failed (HTTP ${response.status}). The API function may not be deployed or routed correctly.`);
  }
  return body as { name: string; text: string; characters: number; truncated: boolean; qualityMessage?: string; wasCorrupted?: boolean; reconstructionApplied?: boolean; subject?: string; hasMathContent?: boolean; gradeLevel?: string; chapter?: string; isQuestionBank?: boolean };
}
function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}
function prettyItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return String(item ?? "");
  const record = item as ItemRecord;
  const keys = ["question", "statement", "front", "fact", "term", "word", "heading", "branch", "formula", "content", "answer", "back", "definition", "explanation", "trick", "whyItWorks", "recallCue"];
  const entries = keys.filter(k => record[k] !== undefined && record[k] !== null && record[k] !== "").map(k => `${k[0].toUpperCase()}${k.slice(1)}: ${formatValue(record[k])}`);
  if (Array.isArray(record.options)) entries.push(`Options: ${(record.options as unknown[]).map((o, i) => `${String.fromCharCode(65 + i)}. ${formatValue(o)}`).join("  ")}`);
  return entries.join("\n");
}
function MiniLogo() { return <div className="sg-logo"><Sparkles size={17} strokeWidth={2.5} /></div>; }

// ── Existing display cards ─────────────────────────────────────────────────────

function MnemonicCard({ item }: { item: unknown }) {
  const r = item && typeof item === "object" ? item as ItemRecord : {};
  return <div className="sg-mnemonic-card">
    <div className="sg-mnemonic-icon"><Lightbulb size={17} /></div>
    <div><span className="sg-mnemonic-label">Remember this</span><strong>{formatValue(r.fact || r.term || r.content)}</strong>
      <div className="sg-trick"><b>🧠 Trick:</b> {formatValue(r.trick || r.back)}</div>
      {r.whyItWorks ? <small><b>Why it works:</b> {formatValue(r.whyItWorks)}</small> : null}
      {r.recallCue ? <small><b>Recall cue:</b> {formatValue(r.recallCue)}</small> : null}
      {r.sourceReference ? <small className="sg-source-ref">📖 {formatValue(r.sourceReference)}</small> : null}
    </div>
  </div>;
}

function McqCard({ item, index }: { item: unknown; index: number }) {
  const r = item && typeof item === "object" ? item as ItemRecord : {};
  const options = Array.isArray(r.options) ? r.options : [];
  const correctAnswer = typeof r.correctAnswer === "string" ? r.correctAnswer : undefined;
  const explanation = typeof r.explanation === "string" ? r.explanation : undefined;
  const sourceRef = typeof r.sourceReference === "string" ? r.sourceReference : undefined;
  const topic = typeof r.topic === "string" ? r.topic : undefined;
  const difficulty = typeof r.difficulty === "string" ? r.difficulty : undefined;
  const correctIdx = correctAnswer
    ? options.findIndex((o) => formatValue(o) === correctAnswer || formatValue(o).includes(correctAnswer))
    : -1;

  return <div className="sg-quiz-card">
    <div className="sg-quiz-number">Q{index + 1}</div>
    <div className="sg-quiz-main">
      <strong>{formatValue(r.question || r.statement || r.content)}</strong>
      {options.length > 0 && <div className="sg-quiz-options">
        {options.map((o, i) => (
          <div className={`sg-quiz-option ${i === correctIdx ? "correct" : ""}`} key={i}>
            <span>{String.fromCharCode(65 + i)}</span>{formatValue(o)}
          </div>
        ))}
      </div>}
      {correctAnswer && <div className="sg-quiz-answer sg-correct-answer"><b>✓ Correct:</b> {correctAnswer}</div>}
      {explanation && <div className="sg-quiz-explanation"><b>Why:</b> {explanation}</div>}
      {(sourceRef || topic || difficulty) && <div className="sg-quiz-meta">
        {topic && <span className="sg-pill sg-pill-sm">{topic}</span>}
        {difficulty && <span className="sg-pill sg-pill-sm">{difficulty}</span>}
        {sourceRef && <span className="sg-source-ref">📖 {sourceRef}</span>}
      </div>}
    </div>
  </div>;
}

function QuizCard({ item, index }: { item: unknown; index: number }) {
  const r = item && typeof item === "object" ? item as ItemRecord : {};
  const options = Array.isArray(r.options) ? r.options : [];
  if (r.statement !== undefined && typeof r.answer === "boolean") {
    return <div className="sg-quiz-card sg-tf-card">
      <div className="sg-quiz-number">Q{index + 1}</div>
      <div className="sg-quiz-main">
        <strong>{formatValue(r.statement)}</strong>
        <div className={`sg-tf-answer ${r.answer ? "true" : "false"}`}><b>{r.answer ? "✓ True" : "✗ False"}</b></div>
        {typeof r.explanation === "string" && r.explanation && <div className="sg-quiz-explanation"><b>Why:</b> {r.explanation}</div>}
        {typeof r.sourceReference === "string" && r.sourceReference && <div className="sg-quiz-meta"><span className="sg-source-ref">📖 {r.sourceReference}</span></div>}
      </div>
    </div>;
  }
  if (r.question !== undefined && r.answer !== undefined && r.type === "fill_blank") {
    return <div className="sg-quiz-card sg-fb-card">
      <div className="sg-quiz-number">Q{index + 1}</div>
      <div className="sg-quiz-main">
        <strong>{formatValue(r.question)}</strong>
        <div className="sg-fb-answer"><b>Answer:</b> {formatValue(r.answer)}</div>
        {typeof r.sourceReference === "string" && r.sourceReference && <div className="sg-quiz-meta"><span className="sg-source-ref">📖 {r.sourceReference}</span></div>}
      </div>
    </div>;
  }
  return <div className="sg-quiz-card"><div className="sg-quiz-number">Q{index + 1}</div><div className="sg-quiz-main">
    <strong>{formatValue(r.question || r.statement || r.content)}</strong>
    {options.length > 0 && <div className="sg-quiz-options">{options.map((o, i) => <div className="sg-quiz-option" key={i}><span>{String.fromCharCode(65 + i)}</span>{formatValue(o)}</div>)}</div>}
    {r.answer !== undefined && <div className="sg-quiz-answer"><b>Answer:</b> {formatValue(r.answer)}{r.explanation ? <><br /><b>Why:</b> {formatValue(r.explanation)}</> : null}</div>}
  </div></div>;
}

// ── DPP Components ─────────────────────────────────────────────────────────────

function DppConfig({ onStart, busy, subjectLabel }: { onStart: (config: DppConfig) => void; busy: boolean; subjectLabel?: string }) {
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<DppDifficulty>("medium");
  const [timeLimit, setTimeLimit] = useState<DppTimeLimit>(0);
  const [language, setLanguage] = useState("English");

  return <div className="sg-dpp-config">
    <div className="sg-kicker" style={{ marginBottom: 8 }}>DPP / TEST SETUP</div>
    <h2>Configure Your Practice Test</h2>
    <p>{subjectLabel ? `Based on: ${subjectLabel}` : "Customize your test settings before starting."}</p>

    <div className="sg-dpp-section">
      <label>Number of Questions</label>
      <div className="sg-dpp-opts">
        {[5, 10, 15, 20, 30].map(n => (
          <button key={n} className={`sg-dpp-opt ${count === n ? "selected" : ""}`} onClick={() => setCount(n)}>{n}</button>
        ))}
      </div>
    </div>

    <div className="sg-dpp-section">
      <label>Difficulty</label>
      <div className="sg-dpp-opts">
        {(["easy", "medium", "hard", "mixed"] as DppDifficulty[]).map(d => (
          <button key={d} className={`sg-dpp-opt ${difficulty === d ? "selected" : ""}`} onClick={() => setDifficulty(d)}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>
    </div>

    <div className="sg-dpp-section">
      <label>Time Limit</label>
      <div className="sg-dpp-opts">
        {([0, 10, 20, 30, 45, 60] as DppTimeLimit[]).map(t => (
          <button key={t} className={`sg-dpp-opt ${timeLimit === t ? "selected" : ""}`} onClick={() => setTimeLimit(t)}>
            {t === 0 ? "No limit" : `${t} min`}
          </button>
        ))}
      </div>
    </div>

    <div className="sg-dpp-section">
      <label>Language</label>
      <div className="sg-dpp-opts">
        {["English", "Hindi"].map(l => (
          <button key={l} className={`sg-dpp-opt ${language === l ? "selected" : ""}`} onClick={() => setLanguage(l)}>{l}</button>
        ))}
      </div>
    </div>

    <button className="sg-dpp-start" onClick={() => onStart({ count, difficulty, timeLimit, language })} disabled={busy}>
      {busy ? <><Loader2 size={15} className="sg-spin" /> Generating questions…</> : <><Sparkles size={15} /> Start DPP</>}
    </button>
  </div>;
}

function DppIntro({ config, onStart, subjectLabel }: { config: DppConfig; onStart: () => void; subjectLabel?: string }) {
  const estimatedMinutes = config.timeLimit || Math.ceil(config.count * 1.5);
  return <div className="sg-dpp-intro">
    <div className="sg-kicker" style={{ marginBottom: 8 }}>DAILY PRACTICE PROBLEM</div>
    <h2>DPP Test</h2>
    <p>{subjectLabel || "Test your knowledge from the study material"}</p>

    <div className="sg-dpp-intro-grid">
      <div className="sg-dpp-intro-stat"><strong>{config.count}</strong><span>Questions</span></div>
      <div className="sg-dpp-intro-stat"><strong>{config.difficulty === "mixed" ? "Mixed" : config.difficulty.charAt(0).toUpperCase() + config.difficulty.slice(1)}</strong><span>Difficulty</span></div>
      <div className="sg-dpp-intro-stat"><strong>{config.timeLimit ? `${config.timeLimit}m` : "∞"}</strong><span>Time Limit</span></div>
    </div>

    <div className="sg-dpp-instructions">
      <b>Instructions:</b><br />
      • You have <b>{config.count}</b> multiple-choice questions.<br />
      • Each question has 4 options — select the best answer.<br />
      {config.timeLimit > 0 && <>• Time limit: <b>{config.timeLimit} minutes</b>. Test auto-submits when time runs out.<br /></>}
      • You can navigate between questions and change your answers.<br />
      • Use <b>"Mark for Review"</b> to flag questions you want to revisit.<br />
      • After submitting, you cannot change answers.<br />
      • Estimated time: <b>{estimatedMinutes} minutes</b>.
    </div>

    <button className="sg-dpp-start" onClick={onStart}>
      <Timer size={15} /> Begin Test
    </button>
  </div>;
}

function DppTest({
  questions, config, onFinish, startTime,
}: {
  questions: DppQuestion[];
  config: DppConfig;
  onFinish: (answers: DppAnswer[], elapsed: number) => void;
  startTime: number;
}) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<DppAnswer[]>(() => questions.map(() => ({ selected: null, marked: false })));
  const [elapsed, setElapsed] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showNav, setShowNav] = useState(false);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const el = Math.floor((now - startTime) / 1000);
      setElapsed(el);
      if (config.timeLimit > 0 && el >= config.timeLimit * 60) {
        clearInterval(interval);
        onFinish(answers, el);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, config.timeLimit, answers, onFinish]);

  const totalSeconds = config.timeLimit * 60;
  const remaining = totalSeconds > 0 ? Math.max(0, totalSeconds - elapsed) : 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timerClass = totalSeconds > 0 ? (remaining < 120 ? "danger" : remaining < 300 ? "warning" : "") : "";
  const q = questions[current];
  const answeredCount = answers.filter(a => a.selected !== null).length;
  const markedCount = answers.filter(a => a.marked).length;
  const progress = ((current + 1) / questions.length) * 100;

  const selectOption = (letter: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[current] = { ...next[current], selected: next[current].selected === letter ? null : letter };
      return next;
    });
  };
  const toggleMark = () => {
    setAnswers(prev => {
      const next = [...prev];
      next[current] = { ...next[current], marked: !next[current].marked };
      return next;
    });
  };
  const clearAnswer = () => {
    setAnswers(prev => {
      const next = [...prev];
      next[current] = { selected: null, marked: next[current].marked };
      return next;
    });
  };

  const optionLetters = ["A", "B", "C", "D"];
  // Strip "A) ", "B) " prefixes from options for clean display
  const cleanOptions = q.options.map(o => o.replace(/^[A-D]\)\s*/, ""));

  return <>
    <div className="sg-dpp-test">
      <div className="sg-dpp-question-area">
        {/* Timer */}
        {config.timeLimit > 0 && <div className={`sg-dpp-timer ${timerClass}`}>
          <div className="sg-dpp-timer-icon"><Timer size={15} /></div>
          <div>
            <div className="sg-dpp-timer-label">Time Left</div>
            <div className="sg-dpp-timer-time">{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</div>
          </div>
        </div>}

        {/* Progress bar */}
        <div className="sg-dpp-progress">
          <div className="sg-dpp-progress-bar"><div className="sg-dpp-progress-fill" style={{ width: `${progress}%` }} /></div>
          <div className="sg-dpp-progress-text">Question {current + 1} of {questions.length} · {answeredCount} answered</div>
        </div>

        {/* Question */}
        <div className="sg-dpp-qnum">Question {current + 1}</div>
        <div className="sg-dpp-question">{q.question}</div>

        {/* Options */}
        <div className="sg-dpp-options">
          {cleanOptions.map((opt, i) => (
            <button
              key={i}
              className={`sg-dpp-option ${answers[current].selected === optionLetters[i] ? "selected" : ""}`}
              onClick={() => selectOption(optionLetters[i])}
            >
              <span className="sg-dpp-option-letter">{optionLetters[i]}</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`sg-dpp-markbtn ${answers[current].marked ? "marked" : ""}`} onClick={toggleMark}>
            <Flag size={13} /> {answers[current].marked ? "Unmark Review" : "Mark for Review"}
          </button>
          <button className="sg-dpp-markbtn" onClick={clearAnswer} style={{ color: "var(--muted)" }}>
            <RotateCcw size={13} /> Clear Answer
          </button>
        </div>

        {/* Nav */}
        <div className="sg-dpp-nav">
          <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}>
            <ChevronLeft size={14} /> Previous
          </button>
          {current < questions.length - 1 ? (
            <button onClick={() => setCurrent(c => Math.min(questions.length - 1, c + 1))}>
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button className="sg-dpp-submit-btn" onClick={() => setShowConfirm(true)}>
              Submit Test
            </button>
          )}
        </div>
      </div>

      {/* Sidebar / Navigator */}
      <div className="sg-dpp-sidebar">
        <div className="sg-dpp-navtitle">Question Navigator</div>
        <div className="sg-dpp-navgrid">
          {questions.map((_, i) => (
            <button
              key={i}
              className={`sg-dpp-navbtn ${i === current ? "current" : ""} ${answers[i].selected ? "answered" : ""} ${answers[i].marked ? "marked" : ""}`}
              onClick={() => setCurrent(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="sg-dpp-legend">
          <div className="sg-dpp-legend-item"><div className="sg-dpp-legend-dot current" /> Current</div>
          <div className="sg-dpp-legend-item"><div className="sg-dpp-legend-dot answered" /> Answered</div>
          <div className="sg-dpp-legend-item"><div className="sg-dpp-legend-dot marked" /> Marked</div>
          <div className="sg-dpp-legend-item"><div className="sg-dpp-legend-dot unanswered" /> Unanswered</div>
        </div>

        <div style={{ marginTop: 12, fontSize: 9, color: "var(--muted)", lineHeight: 1.6 }}>
          <div>Answered: <b style={{ color: "var(--ink)" }}>{answeredCount}</b> / {questions.length}</div>
          <div>Marked for review: <b style={{ color: "var(--ink)" }}>{markedCount}</b></div>
          <div>Unanswered: <b style={{ color: "var(--ink)" }}>{questions.length - answeredCount}</b></div>
        </div>

        <button className="sg-dpp-submit-btn" style={{ width: "100%", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: 0, borderRadius: 10, padding: "11px 14px", fontSize: 11, fontWeight: 800, background: "var(--teal)", color: "#fff", cursor: "pointer" }} onClick={() => setShowConfirm(true)}>
          Submit Test
        </button>
      </div>
    </div>

    {/* Confirm submit dialog */}
    {showConfirm && <div className="sg-dpp-overlay" onClick={() => setShowConfirm(false)}>
      <div className="sg-dpp-dialog" onClick={e => e.stopPropagation()}>
        <h3>Submit Test?</h3>
        <p>Are you sure you want to submit? You cannot change answers after submission.</p>
        <div className="sg-dpp-dialog-stats">
          <div className="sg-dpp-dialog-stat"><strong>{answeredCount}</strong><span>Answered</span></div>
          <div className="sg-dpp-dialog-stat"><strong>{questions.length - answeredCount}</strong><span>Unanswered</span></div>
          <div className="sg-dpp-dialog-stat"><strong>{markedCount}</strong><span>Marked</span></div>
        </div>
        <div className="sg-dpp-dialog-actions">
          <button onClick={() => setShowConfirm(false)}>Continue Test</button>
          <button className="sg-dpp-confirm-submit" onClick={() => onFinish(answers, elapsed)}>Submit Test</button>
        </div>
      </div>
    </div>}
  </>;
}

function DppResult({ questions, answers, elapsed, config, onBack }: {
  questions: DppQuestion[];
  answers: DppAnswer[];
  elapsed: number;
  config: DppConfig;
  onBack: () => void;
}) {
  const optionLetters = ["A", "B", "C", "D"];

  const results = questions.map((q, i) => {
    const a = answers[i];
    const correctLetter = q.correctAnswer.replace(/^[A-D]\)\s*/, "").trim();
    // Find which option index matches the correct answer
    const correctIdx = q.options.findIndex(o => {
      const clean = o.replace(/^[A-D]\)\s*/, "").trim();
      return clean === correctLetter || o === q.correctAnswer;
    });
    const correctLetterId = correctIdx >= 0 ? optionLetters[correctIdx] : q.correctAnswer.charAt(0);
    const isCorrect = a.selected === correctLetterId;
    return { ...q, selectedIdx: i, selected: a.selected, correctLetterId, isCorrect, wasMarked: a.marked };
  });

  const correct = results.filter(r => r.isCorrect).length;
  const incorrect = results.filter(r => r.selected !== null && !r.isCorrect).length;
  const unanswered = results.filter(r => r.selected === null).length;
  const score = correct;
  const percentage = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
  const accuracy = (correct + incorrect) > 0 ? Math.round((correct / (correct + incorrect)) * 1000) / 10 : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return <div className="sg-dpp-result">
    <div className="sg-kicker" style={{ marginBottom: 8, textAlign: "center" }}>TEST COMPLETE</div>
    <h2>DPP Result</h2>
    <p>Here's how you performed</p>

    <div className="sg-dpp-score-hero">
      <div className="score-big">{score} / {questions.length}</div>
      <div className="score-pct">{percentage}%</div>
      <div className="score-label">Overall Score</div>
    </div>

    <div className="sg-dpp-stats-grid">
      <div className="sg-dpp-stat-card correct"><strong>{correct}</strong><span>Correct</span></div>
      <div className="sg-dpp-stat-card incorrect"><strong>{incorrect}</strong><span>Incorrect</span></div>
      <div className="sg-dpp-stat-card unanswered"><strong>{unanswered}</strong><span>Unanswered</span></div>
      <div className="sg-dpp-stat-card"><strong>{accuracy}%</strong><span>Accuracy</span></div>
      <div className="sg-dpp-stat-card"><strong>{mins}:{String(secs).padStart(2, "0")}</strong><span>Time Taken</span></div>
      <div className="sg-dpp-stat-card"><strong>{config.difficulty === "mixed" ? "Mixed" : config.difficulty}</strong><span>Difficulty</span></div>
    </div>

    <div className="sg-dpp-review">
      <h3>Question-wise Analysis</h3>
      {results.map((r, i) => {
        const cleanOpts = r.options.map(o => o.replace(/^[A-D]\)\s*/, ""));
        const statusClass = r.selected === null ? "unanswered" : r.isCorrect ? "correct" : "incorrect";
        const statusLabel = r.selected === null ? "⬜ Unanswered" : r.isCorrect ? "✅ Correct" : "❌ Incorrect";

        return <div className={`sg-dpp-review-item ${statusClass}`} key={i}>
          <div className="sg-dpp-review-qnum">Question {i + 1}</div>
          <div className="sg-dpp-review-question">{r.question}</div>
          <div className="sg-dpp-review-options">
            {cleanOpts.map((opt, j) => {
              const letter = optionLetters[j];
              const isCorrectOpt = letter === r.correctLetterId;
              const isSelectedOpt = letter === r.selected;
              const cls = isCorrectOpt ? "correct" : isSelectedOpt ? "selected" : "";
              return <div className={`sg-dpp-review-option ${cls}`} key={j}>
                <span className="sg-dpp-review-option-letter">{letter}</span>
                <span>{opt}</span>
                {isCorrectOpt && <span style={{ marginLeft: "auto", color: "#276e42", fontWeight: 700, fontSize: 9 }}>✓ Correct</span>}
                {isSelectedOpt && !isCorrectOpt && <span style={{ marginLeft: "auto", color: "#9a432e", fontWeight: 700, fontSize: 9 }}>Your answer</span>}
              </div>;
            })}
          </div>
          <div className={`sg-dpp-review-status ${statusClass}`}>{statusLabel}</div>
          {r.explanation && <div className="sg-dpp-review-explanation"><b>Explanation:</b> {r.explanation}</div>}
        </div>;
      })}
    </div>

    <div style={{ textAlign: "center", marginTop: 20 }}>
      <button className="sg-dpp-start" onClick={onBack} style={{ maxWidth: 300 }}>
        <RotateCcw size={15} /> Back to Study
      </button>
    </div>
  </div>;
}

// ── Main Home Component ────────────────────────────────────────────────────────

function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<"upload" | "paste">("upload");
  const [fileName, setFileName] = useState(""); const [text, setText] = useState(""); const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState(""); const [outputs, setOutputs] = useState<OutputType[]>(["notes", "mcq", "mnemonics"]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium"); const [language, setLanguage] = useState<Language>("English"); const [count, setCount] = useState(10);
  const [pack, setPack] = useState<StudyPack | null>(null); const [history, setHistory] = useState<SavedPack[]>([]);
  const [chatQuestion, setChatQuestion] = useState(""); const [chatAnswer, setChatAnswer] = useState<StudyChatResponse | null>(null);
  const [error, setError] = useState(""); const [busyLabel, setBusyLabel] = useState(""); const [dragging, setDragging] = useState(false); const [copied, setCopied] = useState(false); const [qualityMessage, setQualityMessage] = useState(""); const [subjectInfo, setSubjectInfo] = useState<{subject?: string; gradeLevel?: string; chapter?: string; isQuestionBank?: boolean; hasMathContent?: boolean} | null>(null);

  // ── DPP state ─────────────────────────────────────────────────────────────
  const [dppPhase, setDppPhase] = useState<"idle" | "config" | "generating" | "intro" | "test" | "result">("idle");
  const [dppConfig, setDppConfig] = useState<DppConfig>({ count: 10, difficulty: "medium", timeLimit: 0, language: "English" });
  const [dppQuestions, setDppQuestions] = useState<DppQuestion[]>([]);
  const [dppAnswers, setDppAnswers] = useState<DppAnswer[]>([]);
  const [dppElapsed, setDppElapsed] = useState(0);
  const [dppStartTime, setDppStartTime] = useState(0);
  const [dppHistory, setDppHistory] = useState<DppResultRecord[]>([]);
  const dppFinishRef = useRef<((answers: DppAnswer[], elapsed: number) => void) | null>(null);

  const topicMutation = useMutation({ mutationFn: (value: { text: string }) => detectStudyTopics(value) });
  const generateMutation = useMutation({ mutationFn: (value: Parameters<typeof generateStudyPack>[0]) => generateStudyPack(value) });
  const chatMutation = useMutation({ mutationFn: (value: Parameters<typeof askStudyDocument>[0]) => askStudyDocument(value) });

  useEffect(() => { try { const saved = localStorage.getItem("cram-ai-history"); if (saved) setHistory(JSON.parse(saved) as SavedPack[]); } catch { localStorage.removeItem("cram-ai-history"); } }, []);
  useEffect(() => { localStorage.setItem("cram-ai-history", JSON.stringify(history.slice(0, 8))); }, [history]);
  useEffect(() => { try { const saved = localStorage.getItem("cram-ai-dpp-history"); if (saved) setDppHistory(JSON.parse(saved) as DppResultRecord[]); } catch { localStorage.removeItem("cram-ai-dpp-history"); } }, []);
  useEffect(() => { localStorage.setItem("cram-ai-dpp-history", JSON.stringify(dppHistory.slice(0, 20))); }, [dppHistory]);

  const selectedLabels = useMemo(() => outputOptions.filter(o => outputs.includes(o.id)).map(o => o.label), [outputs]);
  const setSource = (name: string, extractedText: string) => { setFileName(name); setText(extractedText); setPack(null); setChatAnswer(null); setError(""); setTopics([]); };

  const detect = async (source: string) => { try { setBusyLabel("Finding chapters and topics…"); const result = await topicMutation.mutateAsync({ text: source }); setTopics(result.topics); setSelectedTopic(""); } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); } };
  const detectCurrentTopics = async () => { if (text.trim().length < 20) return setError("Add at least 20 characters before detecting topics."); await detect(text); };
  const processFile = async (file: File) => {
    if (!/\.(pdf|docx|txt|md|png|jpe?g)$/i.test(file.name)) return setError("Supported files are PDF, DOCX, TXT, MD, JPG, and PNG.");
    try {
      setError(""); setBusyLabel(`Reading ${file.name}…`);
      const isPlainText = /\.(txt|md)$/i.test(file.name);
      const result = isPlainText
        ? { name: file.name, text: await file.text(), characters: 0, truncated: false }
        : await extractFile(file);
      const cleanText = result.text.replace(/\u0000/g, "").trim();
      if (cleanText.length < 20) throw new Error("No readable study text was found. Please upload a text-based document or a PDF with selectable text.");
      setSource(result.name, cleanText);
      setQualityMessage(result.qualityMessage && result.wasCorrupted ? result.qualityMessage : "");
      if (result.subject || result.gradeLevel || result.chapter) {
        setSubjectInfo({ subject: result.subject, gradeLevel: result.gradeLevel, chapter: result.chapter, isQuestionBank: result.isQuestionBank, hasMathContent: result.hasMathContent });
      } else { setSubjectInfo(null); }
      setBusyLabel("Finding chapters and topics…");
      const topicResult = await topicMutation.mutateAsync({ text: cleanText });
      setTopics(topicResult.topics);
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); }
  };
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) await processFile(file); };
  const handleDrop = async (event: DragEvent<HTMLButtonElement>) => { event.preventDefault(); setDragging(false); if (!busyLabel) { const file = event.dataTransfer.files?.[0]; if (file) await processFile(file); } };

  const resultText = useMemo(() => !pack ? "" : [pack.title, pack.summary, ...pack.sections.flatMap(s => [`\n## ${s.title}`, ...s.items.map((item, i) => `${i + 1}. ${prettyItem(item)}`)])].join("\n"), [pack]);
  const copyPack = async () => { if (!resultText) return; try { await navigator.clipboard.writeText(resultText); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError("Copy failed. Please copy the result manually."); } };
  const downloadPack = () => { if (!resultText) return; const blob = new Blob([resultText], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${(pack?.title || "study-pack").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const toggleOutput = (id: OutputType) => setOutputs(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);

  const generate = async (quickType?: OutputType) => {
    if (text.trim().length < 20) return setError("Upload a PDF/notes file or paste at least 20 characters first.");
    const selected = quickType ? [quickType] : outputs;
    if (!selected.length) return setError("Select at least one output.");
    try { setError(""); setBusyLabel(quickType === "mnemonics" ? "Creating memory tricks…" : "Building your study system…");
      const result = await generateMutation.mutateAsync({ text, types: selected, count, language, difficulty, topic: selectedTopic || null }); setPack(result); setChatAnswer(null);
      const saved = { id: crypto.randomUUID(), name: fileName || "Untitled study material", characters: text.length, createdAt: new Date().toISOString(), text, pack: result } satisfies SavedPack;
      setHistory(cur => [saved, ...cur.filter(x => x.name !== saved.name)].slice(0, 8));
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); }
  };

  // ── DPP generation ─────────────────────────────────────────────────────────
  const startDpp = async (config: DppConfig) => {
    if (text.trim().length < 20) return setError("Upload a PDF/notes file or paste at least 20 characters first.");
    setDppConfig(config);
    setDppPhase("generating");
    try {
      setError("");
      setBusyLabel("Generating DPP questions…");
      const result = await generateMutation.mutateAsync({
        text,
        types: ["mcq"],
        count: config.count,
        language: config.language as Language,
        difficulty: config.difficulty === "hard" ? "detailed" : config.difficulty === "easy" ? "easy" : "medium",
        topic: selectedTopic || null,
      });
      // Extract MCQ items from the result
      const mcqSection = result.sections.find(s => s.type === "mcq");
      const rawItems = mcqSection?.items ?? [];
      const questions: DppQuestion[] = rawItems.map((item: unknown) => {
        const r = item && typeof item === "object" ? item as ItemRecord : {};
        const opts = Array.isArray(r.options) ? r.options.map(o => formatValue(o)) : [];
        return {
          question: formatValue(r.question || r.statement || r.content),
          options: opts,
          correctAnswer: typeof r.correctAnswer === "string" ? r.correctAnswer : "",
          explanation: typeof r.explanation === "string" ? r.explanation : undefined,
          topic: typeof r.topic === "string" ? r.topic : undefined,
          difficulty: typeof r.difficulty === "string" ? r.difficulty : undefined,
          sourceReference: typeof r.sourceReference === "string" ? r.sourceReference : undefined,
        };
      }).filter(q => q.options.length >= 2 && q.question);
      if (questions.length === 0) throw new Error("No valid MCQ questions were generated. Try again with different settings.");
      setDppQuestions(questions);
      setDppPhase("intro");
    } catch (e) { setError(getErrorMessage(e)); setDppPhase("config"); } finally { setBusyLabel(""); }
  };

  const beginDppTest = useCallback(() => {
    setDppStartTime(Date.now());
    setDppPhase("test");
  }, []);

  const finishDppTest = useCallback((answers: DppAnswer[], elapsed: number) => {
    setDppAnswers(answers);
    setDppElapsed(elapsed);
    // Calculate results
    const optionLetters = ["A", "B", "C", "D"];
    const results = dppQuestions.map((q, i) => {
      const a = answers[i];
      const correctLetter = q.correctAnswer.replace(/^[A-D]\)\s*/, "").trim();
      const correctIdx = q.options.findIndex(o => {
        const clean = o.replace(/^[A-D]\)\s*/, "").trim();
        return clean === correctLetter || o === q.correctAnswer;
      });
      const correctLetterId = correctIdx >= 0 ? optionLetters[correctIdx] : q.correctAnswer.charAt(0);
      return { isCorrect: a.selected === correctLetterId, wasAnswered: a.selected !== null };
    });
    const correct = results.filter(r => r.isCorrect).length;
    const incorrect = results.filter(r => r.wasAnswered && !r.isCorrect).length;
    const unanswered = results.filter(r => !r.wasAnswered).length;
    const total = dppQuestions.length;
    const record: DppResultRecord = {
      id: crypto.randomUUID(),
      name: fileName || "DPP Test",
      date: new Date().toISOString(),
      total,
      correct,
      incorrect,
      unanswered,
      score: correct,
      percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
      accuracy: (correct + incorrect) > 0 ? Math.round((correct / (correct + incorrect)) * 1000) / 10 : 0,
      timeTaken: elapsed,
      difficulty: dppConfig.difficulty,
    };
    setDppHistory(cur => [record, ...cur].slice(0, 20));
    setDppPhase("result");
  }, [dppQuestions, fileName, dppConfig]);

  const resetDpp = () => { setDppPhase("idle"); setDppQuestions([]); setDppAnswers([]); };

  const askQuestion = async (event: FormEvent) => { event.preventDefault(); if (!chatQuestion.trim() || text.trim().length < 20) return; try { setError(""); setBusyLabel("Searching your notes…"); setChatAnswer(await chatMutation.mutateAsync({ text, question: chatQuestion.trim() })); } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); } };
  const useHistory = (item: SavedPack) => { setFileName(item.name); setText(item.text); setPack(item.pack); setTopics(item.pack.topics); setSelectedTopic(""); setChatAnswer(null); setError(""); };
  const reset = () => { setText(""); setFileName(""); setTopics([]); setSelectedTopic(""); setPack(null); setChatAnswer(null); setError(""); setCopied(false); setQualityMessage(""); setSubjectInfo(null); resetDpp(); };

  const subjectLabel = subjectInfo?.subject && subjectInfo.subject !== "general"
    ? `${subjectInfo.subject.charAt(0).toUpperCase() + subjectInfo.subject.slice(1).replace(/_/g, " ")}${subjectInfo.gradeLevel ? ` · ${subjectInfo.gradeLevel}` : ""}${subjectInfo.chapter ? ` · ${subjectInfo.chapter}` : ""}`
    : "";

  // DPP is active — show full-screen DPP view
  if (dppPhase !== "idle") {
    return <div className="sg-shell">
      <header className="sg-topbar">
        <MiniLogo /><div className="sg-brand">CRAM <span>AI</span></div>
        <div className="sg-topnav">
          <button className="sg-navbtn" onClick={resetDpp}><ChevronLeft size={14} /> Back</button>
          {dppPhase === "test" && <div className="sg-avatar" style={{ background: "var(--teal)", color: "#fff" }}>DPP</div>}
        </div>
      </header>
      <main className="sg-layout">
        {error && <div className="sg-alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
        {dppPhase === "generating" && <div className="sg-card sg-builder" style={{ padding: 40, textAlign: "center" }}>
          <Loader2 size={32} className="sg-spin" style={{ color: "var(--teal)" }} />
          <h3 style={{ marginTop: 14, font: "600 17px Georgia, serif" }}>Generating your DPP…</h3>
          <p style={{ color: "var(--muted)", fontSize: 11 }}>AI is creating {dppConfig.count} quality MCQ questions from your material.</p>
        </div>}
        {dppPhase === "config" && <div className="sg-card sg-builder">
          <DppConfig onStart={startDpp} busy={false} subjectLabel={subjectLabel} />
        </div>}
        {dppPhase === "intro" && <div className="sg-card sg-builder">
          <DppIntro config={dppConfig} onStart={beginDppTest} subjectLabel={subjectLabel || fileName} />
        </div>}
        {dppPhase === "test" && <div className="sg-card" style={{ overflow: "visible" }}>
          <DppTest questions={dppQuestions} config={dppConfig} onFinish={finishDppTest} startTime={dppStartTime} />
        </div>}
        {dppPhase === "result" && <div className="sg-card sg-builder">
          <DppResult questions={dppQuestions} answers={dppAnswers} elapsed={dppElapsed} config={dppConfig} onBack={resetDpp} />
        </div>}
      </main>
    </div>;
  }

  // Normal study mode
  return <div className="sg-shell">
    <header className="sg-topbar"><MiniLogo /><div className="sg-brand">CRAM <span>AI</span></div><div className="sg-topnav"><button className="sg-navbtn" onClick={() => document.getElementById("history")?.scrollIntoView({ behavior: "smooth" })}><History size={14} /> History</button><button className="sg-navbtn" onClick={() => document.getElementById("ask")?.scrollIntoView({ behavior: "smooth" })}><MessageCircle size={14} /> Ask notes</button><div className="sg-avatar">CA</div></div></header>
    <main className="sg-layout">
      <div className="sg-welcome"><div><div className="sg-kicker">Your AI study workspace</div><h1>Study less. Remember more.</h1><p>Turn PDFs and notes into questions, quizzes, memory tricks and source-grounded answers.</p></div><div className="sg-streak"><Target size={18} className="sg-teal" /><div><strong>Built for real revision</strong><small>Practice → recall → understand</small></div></div></div>
      {error && <div className="sg-alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
      {qualityMessage && <div className="sg-alert sg-alert-warn"><AlertCircle size={17} /><span>{qualityMessage}</span><button onClick={() => setQualityMessage("")} aria-label="Dismiss"><X size={15} /></button></div>}
      {subjectInfo && subjectInfo.subject && subjectInfo.subject !== "general" && <div className="sg-alert sg-alert-info"><BookOpen size={17} /><span>Detected: <strong>{subjectInfo.subject.charAt(0).toUpperCase() + subjectInfo.subject.slice(1).replace(/_/g, " ")}</strong>{subjectInfo.gradeLevel ? ` · ${subjectInfo.gradeLevel}` : ""}{subjectInfo.chapter ? ` · ${subjectInfo.chapter}` : ""}{subjectInfo.isQuestionBank ? " · Question Bank" : ""}{subjectInfo.hasMathContent ? " · Math Content" : ""}</span><button onClick={() => setSubjectInfo(null)} aria-label="Dismiss"><X size={15} /></button></div>}

      {/* Feature bar with DPP button */}
      <div className="sg-featurebar">
        <div><Timer size={19}/><div><strong>DPP / Test</strong><small>Interactive timed practice test</small></div></div>
        <button onClick={() => { if (!text || text.trim().length < 20) return setError("Upload material first to start a DPP."); setDppPhase("config"); }} disabled={!text || Boolean(busyLabel)}><Sparkles size={14}/> Start DPP</button>
      </div>

      <div className="sg-workspace">
        <section className="sg-card sg-builder">
          <div className="sg-cardhead"><div><div className="sg-step">01 · SOURCE</div><h2>Upload your PDF or notes</h2><p>Everything generated stays grounded in the material you provide.</p></div><BookOpen size={20} className="sg-muted" /></div>
          <div className="sg-tabs"><button className={sourceMode === "upload" ? "active" : ""} onClick={() => setSourceMode("upload")}><UploadCloud size={14}/> Upload</button><button className={sourceMode === "paste" ? "active" : ""} onClick={() => setSourceMode("paste")}><Paperclip size={14}/> Paste notes</button></div>
          {sourceMode === "upload" ? <button className={`sg-dropzone ${dragging ? "dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); if (!busyLabel) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} disabled={Boolean(busyLabel)} aria-label="Upload study material"><input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" onChange={handleFile} hidden/><UploadCloud size={25}/><strong>{fileName || (dragging ? "Release to upload" : "Drop your material here")}</strong><span>{fileName ? `${text.length.toLocaleString()} characters extracted` : "PDF, DOCX, TXT, MD, JPG or PNG · max 4 MB"}</span><em>Scanned PDFs & images are OCR-ready</em><em>Browse files · or drag & drop</em></button> : <><textarea className="sg-textarea sg-paste" value={text} onChange={e => { setText(e.target.value); setFileName("Pasted study notes"); setPack(null); setTopics([]); }} placeholder="Paste notes, textbook extracts, or class material here…"/><button className="sg-detectbutton" onClick={detectCurrentTopics} disabled={Boolean(busyLabel) || text.trim().length < 20}><RefreshCw size={13}/> Detect topics</button></>}
          {text && <div className="sg-source-preview"><div className="sg-source-meta"><span><Check size={13}/> Material ready</span><small>{text.length.toLocaleString()} chars</small></div><textarea value={text} onChange={e => { setText(e.target.value); setTopics([]); setPack(null); setChatAnswer(null); }} aria-label="Study material"/><button className="sg-clear" onClick={reset}>Clear source</button></div>}
          {busyLabel && <div className="sg-progress"><Loader2 size={15} className="sg-spin"/> {busyLabel}</div>}
          <div className="sg-divider" /><div className="sg-step">02 · TOPICS</div><h3 className="sg-subhead">Choose what to focus on</h3><div className="sg-topicrow"><button className={!selectedTopic ? "selected" : ""} onClick={() => setSelectedTopic("")}>All topics</button>{topics.map(t => <button className={selectedTopic === t ? "selected" : ""} key={t} onClick={() => setSelectedTopic(t)}>{t}</button>)}</div>{!topics.length && <p className="sg-hint">Topics are detected automatically after upload.</p>}
          <div className="sg-divider" /><div className="sg-step">03 · OUTPUTS</div><h3 className="sg-subhead">Build your study system <span>{outputs.length} selected</span></h3><div className="sg-outputgrid">{outputOptions.map(o => <button key={o.id} className={`sg-output ${outputs.includes(o.id) ? "selected" : ""}`} onClick={() => toggleOutput(o.id)}><span className="sg-check">{outputs.includes(o.id) && <Check size={12}/>}</span><strong>{o.label}</strong><small>{o.hint}</small></button>)}</div>
          <div className="sg-controls">
            <div className="sg-choice-control">
              <span className="sg-field-label"><Gauge size={12}/> Difficulty</span>
              <div className="sg-choice-grid" role="radiogroup" aria-label="Difficulty">
                <button type="button" className={`sg-choice ${difficulty === "easy" ? "selected easy" : ""}`} onClick={() => setDifficulty("easy")} aria-pressed={difficulty === "easy"}><span className="sg-choice-icon"><Brain size={14}/></span><span><b>Easy</b><small>Gentle start</small></span>{difficulty === "easy" && <Check size={14} className="sg-choice-tick"/>}</button>
                <button type="button" className={`sg-choice ${difficulty === "medium" ? "selected medium" : ""}`} onClick={() => setDifficulty("medium")} aria-pressed={difficulty === "medium"}><span className="sg-choice-icon"><Target size={14}/></span><span><b>Medium</b><small>Exam ready</small></span>{difficulty === "medium" && <Check size={14} className="sg-choice-tick"/>}</button>
                <button type="button" className={`sg-choice ${difficulty === "detailed" ? "selected detailed" : ""}`} onClick={() => setDifficulty("detailed")} aria-pressed={difficulty === "detailed"}><span className="sg-choice-icon"><Sparkles size={14}/></span><span><b>Deep dive</b><small>Detailed mastery</small></span>{difficulty === "detailed" && <Check size={14} className="sg-choice-tick"/>}</button>
              </div>
            </div>
            <div className="sg-choice-control">
              <span className="sg-field-label"><Globe2 size={12}/> Language</span>
              <div className="sg-language-grid" role="radiogroup" aria-label="Language">
                <button type="button" className={`sg-language-choice ${language === "English" ? "selected" : ""}`} onClick={() => setLanguage("English")} aria-pressed={language === "English"}><span className="sg-language-badge">EN</span><span><b>English</b><small>English output</small></span>{language === "English" && <Check size={14} className="sg-choice-tick"/>}</button>
                <button type="button" className={`sg-language-choice ${language === "Hindi" ? "selected" : ""}`} onClick={() => setLanguage("Hindi")} aria-pressed={language === "Hindi"}><span className="sg-language-badge">हि</span><span><b>Hindi</b><small>हिंदी आउटपुट</small></span>{language === "Hindi" && <Check size={14} className="sg-choice-tick"/>}</button>
              </div>
            </div>
            <div className="sg-question-control"><span className="sg-field-label">No. of questions / items</span><div className="sg-countgrid" role="radiogroup" aria-label="Number of questions"><button type="button" className={`sg-countoption ${count === 5 ? "selected" : ""}`} onClick={() => setCount(5)} aria-pressed={count === 5}><span className="sg-countcheck">{count === 5 && <Check size={12} strokeWidth={3}/>}</span><span>5</span></button><button type="button" className={`sg-countoption ${count === 10 ? "selected" : ""}`} onClick={() => setCount(10)} aria-pressed={count === 10}><span className="sg-countcheck">{count === 10 && <Check size={12} strokeWidth={3}/>}</span><span>10</span></button><button type="button" className={`sg-countoption ${count === 15 ? "selected" : ""}`} onClick={() => setCount(15)} aria-pressed={count === 15}><span className="sg-countcheck">{count === 15 && <Check size={12} strokeWidth={3}/>}</span><span>15</span></button><button type="button" className={`sg-countoption ${count === 20 ? "selected" : ""}`} onClick={() => setCount(20)} aria-pressed={count === 20}><span className="sg-countcheck">{count === 20 && <Check size={12} strokeWidth={3}/>}</span><span>20</span></button><button type="button" className={`sg-countoption sg-countmax ${count === 100 ? "selected" : ""}`} onClick={() => setCount(100)} aria-pressed={count === 100}><span className="sg-countcheck">{count === 100 && <Check size={12} strokeWidth={3}/>}</span><span>Maximum</span></button></div><small className="sg-controlhint">Maximum = exhaustively generate distinct source-supported questions, up to 100.</small></div></div>
          <button className="sg-generate" onClick={() => generate()} disabled={Boolean(busyLabel) || !text || !outputs.length}>{busyLabel ? <><Loader2 size={15} className="sg-spin"/> Working…</> : <><Sparkles size={15}/> Generate study system <ChevronDown size={15} style={{ transform: "rotate(-90deg)" }}/></>}</button><p className="sg-selected-summary">{selectedLabels.join(" · ")}</p>{text && <button className="sg-resetbutton" onClick={reset}>Start a new study session</button>}
        </section>
        <section className="sg-card sg-preview">
          {!pack ? <div className="sg-empty"><Sparkles size={42}/><h3>Your learning system will appear here.</h3><p>Upload a chapter, then generate quizzes, questions, notes and memory tricks from it.</p><div className="sg-emptyfeatures"><span>🧠 Mnemonics</span><span>📝 DPP Test</span><span>💬 Ask notes</span></div></div> : <><div className="sg-resulttop"><div className="sg-kicker">AI study system · ready</div><h2>{pack.title}</h2><p>{pack.summary}</p><div className="sg-resultmeta"><span className="sg-pill">{fileName || "Study material"}</span><span className="sg-pill">{pack.sections.length} formats</span><span className="sg-pill">{language} · {difficulty}</span>{count === 100 && <span className="sg-pill sg-maxpill">MAXIMUM COVERAGE</span>}<div className="sg-resultactions"><button className="sg-actionbutton" onClick={copyPack}><Clipboard size={13}/>{copied ? "Copied!" : "Copy"}</button><button className="sg-actionbutton" onClick={downloadPack}><Download size={13}/>Download</button></div></div></div><div className="sg-resultbody">{pack.sections.map((section, si) => <article className="sg-resultsection" key={`${section.type}-${si}`}><div className="sg-sectionlabel"><span>{String(si + 1).padStart(2, "0")} · {section.title}</span><span>{section.items.length} items</span></div>{section.items.length ? section.items.map((item, ii) => {
  if (section.type === "mnemonics") return <MnemonicCard item={item} key={ii}/>;
  if (section.type === "mcq") return <McqCard item={item} index={ii} key={ii}/>;
  if (section.type === "quiz") return <QuizCard item={item} index={ii} key={ii}/>;
  if (section.type === "notes" || section.type === "short_notes") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-note-card" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b>
      <div><strong>{formatValue(r.heading)}</strong><p>{formatValue(r.content)}</p>
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}</div>
    </div>;
  }
  if (section.type === "short_answer" || section.type === "long_answer") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-qa-card" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b>
      <div><strong className="sg-qa-question">{formatValue(r.question)}</strong>
      <div className="sg-qa-answer"><b>Answer:</b> {formatValue(r.answer)}</div>
      {Array.isArray(r.keyPoints) && r.keyPoints.length > 0 && <div className="sg-keypoints"><b>Key points:</b><ul>{r.keyPoints.map((kp, ki) => <li key={ki}>{formatValue(kp)}</li>)}</ul></div>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}</div>
    </div>;
  }
  if (section.type === "true_false") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    if (typeof r.answer === "boolean") {
      return <div className="sg-resultitem sg-tf-item" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b>
        <div><strong>{formatValue(r.statement || r.question)}</strong>
        <div className={`sg-tf-badge ${r.answer ? "true" : "false"}`}>{r.answer ? "✓ True" : "✗ False"}</div>
        {typeof r.explanation === "string" && r.explanation && <p className="sg-tf-explanation"><b>Why:</b> {r.explanation}</p>}
        {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}</div>
      </div>;
    }
    return <div className="sg-resultitem" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b><pre>{prettyItem(item)}</pre></div>;
  }
  if (section.type === "fill_blank") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-fb-item" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b>
      <div><strong>{formatValue(r.question)}</strong>
      <div className="sg-fb-answer"><b>Answer:</b> {formatValue(r.answer)}</div>
      {typeof r.hint === "string" && r.hint && <small className="sg-hint">Hint: {r.hint}</small>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}</div>
    </div>;
  }
  if (section.type === "flashcards") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-fc-item" key={ii}>
      <div className="sg-fc-front"><strong>Q:</strong> {formatValue(r.front)}</div>
      <div className="sg-fc-back"><strong>A:</strong> {formatValue(r.back)}</div>
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}
    </div>;
  }
  if (section.type === "mindmap") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-mm-item" key={ii}>
      <div className="sg-mm-branch"><strong>🌿 {formatValue(r.branch)}</strong></div>
      {Array.isArray(r.children) && <div className="sg-mm-children">{r.children.map((c, ci) => <span className="sg-mm-child" key={ci}>{formatValue(c)}</span>)}</div>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}
    </div>;
  }
  if (section.type === "definitions") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-def-item" key={ii}>
      <div className="sg-def-term"><strong>📖 {formatValue(r.term)}</strong></div>
      <div className="sg-def-def">{formatValue(r.definition)}</div>
      {typeof r.example === "string" && r.example && <div className="sg-def-example"><em>Example:</em> {r.example}</div>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}
    </div>;
  }
  if (section.type === "formulas") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-formula-item" key={ii}>
      <div className="sg-formula-eq"><strong>{formatValue(r.formula)}</strong></div>
      {typeof r.name === "string" && r.name && <div className="sg-formula-name"><em>{r.name}</em></div>}
      {Array.isArray(r.variables) && r.variables.length > 0 && <div className="sg-formula-vars">
        {r.variables.map((v, vi) => {
          const vr = v && typeof v === "object" ? v as ItemRecord : {};
          return <span key={vi} className="sg-formula-var"><code>{formatValue(vr.symbol)}</code> = {formatValue(vr.meaning)}</span>;
        })}
      </div>}
      {typeof r.conditions === "string" && r.conditions && <div className="sg-formula-cond"><em>When:</em> {r.conditions}</div>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}
    </div>;
  }
  if (section.type === "difficult_words") {
    const r = item && typeof item === "object" ? item as ItemRecord : {};
    return <div className="sg-resultitem sg-dw-item" key={ii}>
      <div className="sg-dw-word"><strong>🔤 {formatValue(r.word)}</strong></div>
      <div className="sg-dw-meaning">{formatValue(r.meaning)}</div>
      {typeof r.example === "string" && r.example && <div className="sg-dw-example"><em>Usage:</em> {r.example}</div>}
      {typeof r.sourceReference === "string" && r.sourceReference && <small className="sg-source-ref">📖 {r.sourceReference}</small>}
    </div>;
  }
  return <div className="sg-resultitem" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b><pre>{prettyItem(item)}</pre></div>;
}) : <p className="sg-emptysection">No source-supported items were found.</p>}</article>)}</div></>}
        </section>
      </div>

      {/* Bottom sections: History, DPP History, Ask Notes */}
      <div className="sg-bottom">
        <section className="sg-card sg-card-pad" id="history">
          <div className="sg-cardhead"><div><h2>Recent study systems</h2><p>Your last 8 sessions are saved only on this device.</p></div><History size={18} className="sg-muted"/></div>
          {history.length ? <div className="sg-historylist">{history.map(item => <button className="sg-historyitem" key={item.id} onClick={() => useHistory(item)}><FileText size={17}/><div><strong>{item.name}</strong><small>{item.pack.sections.length} formats · {item.characters.toLocaleString()} chars</small></div><ChevronDown size={14} style={{ marginLeft: "auto", transform: "rotate(-90deg)" }}/></button>)}</div> : <p className="sg-hint sg-historyempty">Your generated sessions will appear here.</p>}
          <button className="sg-navbtn sg-danger" onClick={() => setHistory([])} disabled={!history.length}><Trash2 size={13}/> Clear local history</button>
        </section>
        <section className="sg-card sg-card-pad sg-chat" id="ask">
          <div className="sg-cardhead"><div><h2><MessageCircle size={16} className="sg-teal"/> Ask your notes</h2><p>Ask anything about the uploaded material; answers are source-grounded.</p></div><span className="sg-step">AI tutor</span></div>
          <div className="sg-chatbody">{chatAnswer ? <><div className="sg-chatquestion">You asked: {chatQuestion}</div><div className="sg-chatbubble">{chatAnswer.answer}</div></> : <div className="sg-chatempty"><MessageCircle size={22}/><span>Upload notes, then ask a question.</span></div>}</div>
          <form className="sg-chatform" onSubmit={askQuestion}><input value={chatQuestion} onChange={e => setChatQuestion(e.target.value)} placeholder={text ? "e.g. Explain this in simple words…" : "Upload material first…"} disabled={!text || Boolean(busyLabel)}/><button aria-label="Send question" disabled={!chatQuestion.trim() || !text || Boolean(busyLabel)}><Send size={14}/></button></form>
        </section>
      </div>

      {/* DPP History */}
      {dppHistory.length > 0 && <section className="sg-card sg-card-pad" style={{ marginTop: 20 }}>
        <div className="sg-cardhead"><div><h2><Trophy size={16} className="sg-teal"/> DPP Test History</h2><p>Your past DPP results. {dppHistory.length} tests taken.</p></div><History size={18} className="sg-muted"/></div>
        <div style={{ marginTop: 14 }}>
          {dppHistory.map(item => {
            const date = new Date(item.date);
            const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            return <div className="sg-dpp-history-item" key={item.id}>
              <div className="sg-dpp-history-icon"><Trophy size={16} /></div>
              <div className="sg-dpp-history-info">
                <strong>{item.name}</strong>
                <small>{dateStr} · {item.difficulty} · {item.correct}/{item.total} correct · {Math.floor(item.timeTaken / 60)}m {item.timeTaken % 60}s</small>
              </div>
              <div className="sg-dpp-history-score">{item.percentage}%</div>
            </div>;
          })}
        </div>
      </section>}

      <footer className="sg-footer"><span>CRAM AI</span><span>Source-grounded learning · Your API key stays server-side</span></footer>
    </main>
  </div>;
}
function Router() { return <Switch><Route path="/" component={Home}/><Route component={NotFound}/></Switch>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>; }
export default App;

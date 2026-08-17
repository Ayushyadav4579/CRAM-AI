import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { askStudyDocument, detectStudyTopics, generateStudyPack, type StudyChatResponse, type StudyPack } from "@workspace/api-client-react";
import {
  AlertCircle, BookOpen, Brain, Check, ChevronDown, Clipboard, Download, FileQuestion, FileText, Gauge, Globe2, History,
  Lightbulb, Loader2, MessageCircle, Paperclip, RefreshCw, Send, Sparkles, Target, Trash2, UploadCloud, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Router as WouterRouter, Switch } from "wouter";

const queryClient = new QueryClient();
type OutputType = "notes" | "short_notes" | "mcq" | "short_answer" | "long_answer" | "true_false" | "fill_blank" | "flashcards" | "quiz" | "mindmap" | "definitions" | "formulas" | "difficult_words" | "mnemonics";
type Difficulty = "easy" | "medium" | "detailed";
type Language = "English" | "Hindi";
type SavedPack = { id: string; name: string; characters: number; createdAt: string; text: string; pack: StudyPack };

type ItemRecord = Record<string, unknown>;
const outputOptions: { id: OutputType; label: string; hint: string; icon?: string }[] = [
  { id: "notes", label: "Detailed notes", hint: "Structured overview" },
  { id: "short_notes", label: "Quick revision", hint: "High-yield points" },
  { id: "mcq", label: "MCQs", hint: "Exam practice" },
  { id: "short_answer", label: "Short answers", hint: "Exam-ready writing" },
  { id: "long_answer", label: "Long answers", hint: "Detailed responses" },
  { id: "true_false", label: "True / False", hint: "Fast checks" },
  { id: "fill_blank", label: "Fill blanks", hint: "Recall practice" },
  { id: "flashcards", label: "Flashcards", hint: "Quick recall" },
  { id: "quiz", label: "AI Quiz", hint: "Interactive practice" },
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
  return body as { name: string; text: string; characters: number; truncated: boolean };
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

function MnemonicCard({ item }: { item: unknown }) {
  const r = item && typeof item === "object" ? item as ItemRecord : {};
  return <div className="sg-mnemonic-card">
    <div className="sg-mnemonic-icon"><Lightbulb size={17} /></div>
    <div><span className="sg-mnemonic-label">Remember this</span><strong>{formatValue(r.fact || r.term || r.content)}</strong>
      <div className="sg-trick"><b>🧠 Trick:</b> {formatValue(r.trick || r.back)}</div>
      {r.whyItWorks && <small><b>Why it works:</b> {formatValue(r.whyItWorks)}</small>}
      {r.recallCue && <small><b>Recall cue:</b> {formatValue(r.recallCue)}</small>}
    </div>
  </div>;
}
function QuizCard({ item, index }: { item: unknown; index: number }) {
  const r = item && typeof item === "object" ? item as ItemRecord : {};
  const options = Array.isArray(r.options) ? r.options : [];
  return <div className="sg-quiz-card"><div className="sg-quiz-number">Q{index + 1}</div><div className="sg-quiz-main">
    <strong>{formatValue(r.question || r.statement || r.content)}</strong>
    {options.length > 0 && <div className="sg-quiz-options">{options.map((o, i) => <div className="sg-quiz-option" key={i}><span>{String.fromCharCode(65 + i)}</span>{formatValue(o)}</div>)}</div>}
    {r.answer !== undefined && <div className="sg-quiz-answer"><b>Answer:</b> {formatValue(r.answer)}{r.explanation ? <><br /><b>Why:</b> {formatValue(r.explanation)}</> : null}</div>}
  </div></div>;
}

function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<"upload" | "paste">("upload");
  const [fileName, setFileName] = useState(""); const [text, setText] = useState(""); const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopic, setSelectedTopic] = useState(""); const [outputs, setOutputs] = useState<OutputType[]>(["notes", "quiz", "mnemonics"]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium"); const [language, setLanguage] = useState<Language>("English"); const [count, setCount] = useState(10);
  const [pack, setPack] = useState<StudyPack | null>(null); const [history, setHistory] = useState<SavedPack[]>([]);
  const [chatQuestion, setChatQuestion] = useState(""); const [chatAnswer, setChatAnswer] = useState<StudyChatResponse | null>(null);
  const [error, setError] = useState(""); const [busyLabel, setBusyLabel] = useState(""); const [dragging, setDragging] = useState(false); const [copied, setCopied] = useState(false);

  const topicMutation = useMutation({ mutationFn: (value: { text: string }) => detectStudyTopics(value) });
  const generateMutation = useMutation({ mutationFn: (value: Parameters<typeof generateStudyPack>[0]) => generateStudyPack(value) });
  const chatMutation = useMutation({ mutationFn: (value: Parameters<typeof askStudyDocument>[0]) => askStudyDocument(value) });

  useEffect(() => { try { const saved = localStorage.getItem("cram-ai-history"); if (saved) setHistory(JSON.parse(saved) as SavedPack[]); } catch { localStorage.removeItem("cram-ai-history"); } }, []);
  useEffect(() => { localStorage.setItem("cram-ai-history", JSON.stringify(history.slice(0, 8))); }, [history]);
  const selectedLabels = useMemo(() => outputOptions.filter(o => outputs.includes(o.id)).map(o => o.label), [outputs]);
  const setSource = (name: string, extractedText: string) => { setFileName(name); setText(extractedText); setPack(null); setChatAnswer(null); setError(""); setTopics([]); };

  const detect = async (source: string) => { try { setBusyLabel("Finding chapters and topics…"); const result = await topicMutation.mutateAsync({ text: source }); setTopics(result.topics); setSelectedTopic(""); } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); } };
  const detectCurrentTopics = async () => { if (text.trim().length < 20) return setError("Add at least 20 characters before detecting topics."); await detect(text); };
  const processFile = async (file: File) => {
    if (!/\.(pdf|docx|txt|md|png|jpe?g)$/i.test(file.name)) return setError("Supported files are PDF, DOCX, TXT, MD, JPG, and PNG.");
    try {
      setError("");
      setBusyLabel(`Reading ${file.name}…`);

      // Plain-text files do not need a server round-trip. Reading them in the
      // browser avoids Netlify Function upload limits and makes TXT/MD uploads
      // work even if the document parser is unavailable.
      const isPlainText = /\.(txt|md)$/i.test(file.name);
      const result = isPlainText
        ? { name: file.name, text: await file.text(), characters: 0, truncated: false }
        : await extractFile(file);

      const cleanText = result.text.replace(/\u0000/g, "").trim();
      if (cleanText.length < 20) throw new Error("No readable study text was found. Please upload a text-based document or a PDF with selectable text.");
      setSource(result.name, cleanText);
      setBusyLabel("Finding chapters and topics…");
      const topicResult = await topicMutation.mutateAsync({ text: cleanText });
      setTopics(topicResult.topics);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyLabel("");
    }
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
    try { setError(""); setBusyLabel(quickType === "quiz" ? "Building your AI quiz…" : quickType === "mnemonics" ? "Creating memory tricks…" : "Building your study system…");
      const result = await generateMutation.mutateAsync({ text, types: selected, count, language, difficulty, topic: selectedTopic || null }); setPack(result); setChatAnswer(null);
      const saved = { id: crypto.randomUUID(), name: fileName || "Untitled study material", characters: text.length, createdAt: new Date().toISOString(), text, pack: result } satisfies SavedPack;
      setHistory(cur => [saved, ...cur.filter(x => x.name !== saved.name)].slice(0, 8));
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); }
  };
  const askQuestion = async (event: FormEvent) => { event.preventDefault(); if (!chatQuestion.trim() || text.trim().length < 20) return; try { setError(""); setBusyLabel("Searching your notes…"); setChatAnswer(await chatMutation.mutateAsync({ text, question: chatQuestion.trim() })); } catch (e) { setError(getErrorMessage(e)); } finally { setBusyLabel(""); } };
  const useHistory = (item: SavedPack) => { setFileName(item.name); setText(item.text); setPack(item.pack); setTopics(item.pack.topics); setSelectedTopic(""); setChatAnswer(null); setError(""); };
  const reset = () => { setText(""); setFileName(""); setTopics([]); setSelectedTopic(""); setPack(null); setChatAnswer(null); setError(""); setCopied(false); };

  return <div className="sg-shell">
    <header className="sg-topbar"><MiniLogo /><div className="sg-brand">CRAM <span>AI</span></div><div className="sg-topnav"><button className="sg-navbtn" onClick={() => document.getElementById("history")?.scrollIntoView({ behavior: "smooth" })}><History size={14} /> History</button><button className="sg-navbtn" onClick={() => document.getElementById("ask")?.scrollIntoView({ behavior: "smooth" })}><MessageCircle size={14} /> Ask notes</button><div className="sg-avatar">CA</div></div></header>
    <main className="sg-layout">
      <div className="sg-welcome"><div><div className="sg-kicker">Your AI study workspace</div><h1>Study less. Remember more.</h1><p>Turn PDFs and notes into questions, quizzes, memory tricks and source-grounded answers.</p></div><div className="sg-streak"><Target size={18} className="sg-teal" /><div><strong>Built for real revision</strong><small>Practice → recall → understand</small></div></div></div>
      {error && <div className="sg-alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
      <div className="sg-featurebar"><div><FileQuestion size={19}/><div><strong>AI Questions & Quiz</strong><small>MCQs, exam questions and mixed practice</small></div></div><button onClick={() => generate("quiz")} disabled={!text || Boolean(busyLabel)}><Sparkles size={14}/> Generate quiz</button><div><Lightbulb size={19}/><div><strong>Memory Tricks</strong><small>Mnemonics for hard facts and sequences</small></div></div><button onClick={() => generate("mnemonics")} disabled={!text || Boolean(busyLabel)}><Sparkles size={14}/> Make mnemonics</button></div>
      <div className="sg-workspace">
        <section className="sg-card sg-builder">
          <div className="sg-cardhead"><div><div className="sg-step">01 · SOURCE</div><h2>Upload your PDF or notes</h2><p>Everything generated stays grounded in the material you provide.</p></div><BookOpen size={20} className="sg-muted" /></div>
          <div className="sg-tabs"><button className={sourceMode === "upload" ? "active" : ""} onClick={() => setSourceMode("upload")}><UploadCloud size={14}/> Upload</button><button className={sourceMode === "paste" ? "active" : ""} onClick={() => setSourceMode("paste")}><Paperclip size={14}/> Paste notes</button></div>
          {sourceMode === "upload" ? <button className={`sg-dropzone ${dragging ? "dragging" : ""}`} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); if (!busyLabel) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} disabled={Boolean(busyLabel)} aria-label="Upload study material"><input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg" onChange={handleFile} hidden/><UploadCloud size={25}/><strong>{fileName || (dragging ? "Release to upload" : "Drop your material here")}</strong><span>{fileName ? `${text.length.toLocaleString()} characters extracted` : "PDF, DOCX, TXT, MD, JPG or PNG · max 4 MB"}</span><em>Scanned PDFs & images are OCR-ready</em><em>Browse files · or drag & drop</em></button> : <><textarea className="sg-textarea sg-paste" value={text} onChange={e => { setText(e.target.value); setFileName("Pasted study notes"); setPack(null); setTopics([]); }} placeholder="Paste notes, textbook extracts, or class material here…"/><button className="sg-detectbutton" onClick={detectCurrentTopics} disabled={Boolean(busyLabel) || text.trim().length < 20}><RefreshCw size={13}/> Detect topics</button></>}
          {text && <div className="sg-source-preview"><div className="sg-source-meta"><span><Check size={13}/> Material ready</span><small>{text.length.toLocaleString()} chars</small></div><textarea value={text} onChange={e => { setText(e.target.value); setTopics([]); setPack(null); setChatAnswer(null); }} aria-label="Study material"/><button className="sg-clear" onClick={reset}>Clear source</button></div>}
          {busyLabel && <div className="sg-progress"><Loader2 size={15} className="sg-spin"/> {busyLabel}</div>}
          <div className="sg-divider"/><div className="sg-step">02 · TOPICS</div><h3 className="sg-subhead">Choose what to focus on</h3><div className="sg-topicrow"><button className={!selectedTopic ? "selected" : ""} onClick={() => setSelectedTopic("")}>All topics</button>{topics.map(t => <button className={selectedTopic === t ? "selected" : ""} key={t} onClick={() => setSelectedTopic(t)}>{t}</button>)}</div>{!topics.length && <p className="sg-hint">Topics are detected automatically after upload.</p>}
          <div className="sg-divider"/><div className="sg-step">03 · OUTPUTS</div><h3 className="sg-subhead">Build your study system <span>{outputs.length} selected</span></h3><div className="sg-outputgrid">{outputOptions.map(o => <button key={o.id} className={`sg-output ${outputs.includes(o.id) ? "selected" : ""}`} onClick={() => toggleOutput(o.id)}><span className="sg-check">{outputs.includes(o.id) && <Check size={12}/>}</span><strong>{o.label}</strong><small>{o.hint}</small></button>)}</div>
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
          {!pack ? <div className="sg-empty"><Sparkles size={42}/><h3>Your learning system will appear here.</h3><p>Upload a chapter, then generate quizzes, questions, notes and memory tricks from it.</p><div className="sg-emptyfeatures"><span>🧠 Mnemonics</span><span>❓ AI Quiz</span><span>💬 Ask notes</span></div></div> : <><div className="sg-resulttop"><div className="sg-kicker">AI study system · ready</div><h2>{pack.title}</h2><p>{pack.summary}</p><div className="sg-resultmeta"><span className="sg-pill">{fileName || "Study material"}</span><span className="sg-pill">{pack.sections.length} formats</span><span className="sg-pill">{language} · {difficulty}</span>{count === 100 && <span className="sg-pill sg-maxpill">MAXIMUM COVERAGE</span>}<div className="sg-resultactions"><button className="sg-actionbutton" onClick={copyPack}><Clipboard size={13}/>{copied ? "Copied!" : "Copy"}</button><button className="sg-actionbutton" onClick={downloadPack}><Download size={13}/>Download</button></div></div></div><div className="sg-resultbody">{pack.sections.map((section, si) => <article className="sg-resultsection" key={`${section.type}-${si}`}><div className="sg-sectionlabel"><span>{String(si + 1).padStart(2, "0")} · {section.title}</span><span>{section.items.length} items</span></div>{section.items.length ? section.items.map((item, ii) => section.type === "mnemonics" ? <MnemonicCard item={item} key={ii}/> : section.type === "quiz" || section.type === "mcq" ? <QuizCard item={item} index={ii} key={ii}/> : <div className="sg-resultitem" key={ii}><b>{String(ii + 1).padStart(2, "0")}</b><pre>{prettyItem(item)}</pre></div>) : <p className="sg-emptysection">No source-supported items were found.</p>}</article>)}</div></>}
        </section>
      </div>
      <div className="sg-bottom">
        <section className="sg-card sg-card-pad" id="history"><div className="sg-cardhead"><div><h2>Recent study systems</h2><p>Your last 8 sessions are saved only on this device.</p></div><History size={18} className="sg-muted"/></div>{history.length ? <div className="sg-historylist">{history.map(item => <button className="sg-historyitem" key={item.id} onClick={() => useHistory(item)}><FileText size={17}/><div><strong>{item.name}</strong><small>{item.pack.sections.length} formats · {item.characters.toLocaleString()} chars</small></div><ChevronDown size={14} style={{ marginLeft: "auto", transform: "rotate(-90deg)" }}/></button>)}</div> : <p className="sg-hint sg-historyempty">Your generated sessions will appear here.</p>}<button className="sg-navbtn sg-danger" onClick={() => setHistory([])} disabled={!history.length}><Trash2 size={13}/> Clear local history</button></section>
        <section className="sg-card sg-card-pad sg-chat" id="ask"><div className="sg-cardhead"><div><h2><MessageCircle size={16} className="sg-teal"/> Ask your notes</h2><p>Ask anything about the uploaded material; answers are source-grounded.</p></div><span className="sg-step">AI tutor</span></div><div className="sg-chatbody">{chatAnswer ? <><div className="sg-chatquestion">You asked: {chatQuestion}</div><div className="sg-chatbubble">{chatAnswer.answer}</div></> : <div className="sg-chatempty"><MessageCircle size={22}/><span>Upload notes, then ask a question.</span></div>}</div><form className="sg-chatform" onSubmit={askQuestion}><input value={chatQuestion} onChange={e => setChatQuestion(e.target.value)} placeholder={text ? "e.g. Explain this in simple words…" : "Upload material first…"} disabled={!text || Boolean(busyLabel)}/><button aria-label="Send question" disabled={!chatQuestion.trim() || !text || Boolean(busyLabel)}><Send size={14}/></button></form></section>
      </div>
      <footer className="sg-footer"><span>CRAM AI</span><span>Source-grounded learning · Your API key stays server-side</span></footer>
    </main>
  </div>;
}
function Router() { return <Switch><Route path="/" component={Home}/><Route component={NotFound}/></Switch>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>; }
export default App;

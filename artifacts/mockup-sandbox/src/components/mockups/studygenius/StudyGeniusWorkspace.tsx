import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  Flame,
  FolderOpen,
  History,
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

type OutputType = "notes" | "mcq" | "flashcards" | "short_answer" | "mindmap";
type HistoryItem = { id: number; title: string; meta: string; source: string };

const outputOptions: { id: OutputType; label: string; hint: string }[] = [
  { id: "notes", label: "Study notes", hint: "Detailed, structured" },
  { id: "mcq", label: "MCQs", hint: "Exam practice" },
  { id: "flashcards", label: "Flashcards", hint: "Quick recall" },
  { id: "short_answer", label: "Short answers", hint: "Write like an exam" },
  { id: "mindmap", label: "Mind map", hint: "See the whole chapter" },
];

const sourceText =
  "Cellular respiration is the process by which cells convert the chemical energy in glucose into ATP. Glycolysis occurs in the cytoplasm and produces pyruvate, ATP, and NADH. In the presence of oxygen, pyruvate enters the mitochondrion and is converted to acetyl-CoA. The Krebs cycle produces ATP, NADH, and FADH2. The electron transport chain uses electrons from NADH and FADH2 to create a proton gradient, which powers ATP synthase. Oxygen is the final electron acceptor and water is formed.";

const starterHistory: HistoryItem[] = [
  { id: 1, title: "Cellular respiration", meta: "12 items · Today, 10:42 AM", source: "Biology · Chapter 7" },
  { id: 2, title: "The French Revolution", meta: "18 items · Yesterday", source: "History · Unit 3" },
  { id: 3, title: "Organic chemistry reactions", meta: "10 items · 18 May", source: "Chemistry · Notes" },
];

function MiniLogo() {
  return (
    <div className="sg-logo">
      <Sparkles size={17} strokeWidth={2.5} />
    </div>
  );
}

function CramAIWorkspace() {
  const [sourceMode, setSourceMode] = useState<"upload" | "paste">("upload");
  const [fileName, setFileName] = useState("Cellular respiration · Chapter 7.pdf");
  const [text, setText] = useState(sourceText);
  const [outputs, setOutputs] = useState<OutputType[]>(["notes", "mcq", "flashcards"]);
  const [difficulty, setDifficulty] = useState("Exam ready");
  const [language, setLanguage] = useState("English");
  const [count, setCount] = useState("12");
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(true);
  const [history, setHistory] = useState(starterHistory);
  const [selectedHistory, setSelectedHistory] = useState<number | null>(1);
  const [chat, setChat] = useState("");
  const [chatAnswer, setChatAnswer] = useState(
    "The electron transport chain is the final stage of aerobic respiration. It transfers electrons from NADH and FADH₂ through protein complexes, using the released energy to pump protons and create a gradient. ATP synthase then uses this gradient to make ATP."
  );

  const selectedLabels = useMemo(
    () => outputOptions.filter((item) => outputs.includes(item.id)).map((item) => item.label),
    [outputs],
  );

  const toggleOutput = (id: OutputType) =>
    setOutputs((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setGenerated(false);
    }
  };

  const generate = () => {
    if (!text.trim() && !fileName) return;
    setIsGenerating(true);
    window.setTimeout(() => {
      setIsGenerating(false);
      setGenerated(true);
      setHistory((items) => [
        { id: Date.now(), title: topic || "Cellular respiration", meta: `${count} items · Just now`, source: "Biology · Uploaded source" },
        ...items.filter((item) => item.id !== 1),
      ]);
    }, 850);
  };

  const askQuestion = (event: FormEvent) => {
    event.preventDefault();
    if (!chat.trim()) return;
    const question = chat.toLowerCase();
    setChatAnswer(question.includes("glycolysis")
      ? "Glycolysis happens in the cytoplasm and splits one glucose molecule into two pyruvate molecules. It produces a net gain of 2 ATP and 2 NADH, and it does not require oxygen."
      : "Based on this chapter, the key idea is energy transfer: glucose is gradually broken down, and the released energy is captured in ATP. Oxygen enables the final electron-transfer step.");
    setChat("");
  };

  return (
    <div className="sg-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap');
        .sg-shell { --ink:#172a3d; --muted:#718092; --line:#dce5e9; --paper:#fbfcf8; --soft:#f0f5f3; --teal:#176c6b; --mint:#dff0e9; --coral:#ee7a5b; min-height:100vh; background:#f4f7f3; color:var(--ink); font-family:Manrope, sans-serif; }
        .sg-shell * { box-sizing:border-box; } .sg-shell button,.sg-shell input,.sg-shell textarea,.sg-shell select { font:inherit; }
        .sg-topbar { height:70px; border-bottom:1px solid var(--line); background:rgba(251,252,248,.9); backdrop-filter:blur(14px); display:flex; align-items:center; padding:0 clamp(18px,4vw,56px); gap:13px; position:sticky; top:0; z-index:5; }
        .sg-logo { display:grid; place-items:center; width:32px; height:32px; color:#fff; background:var(--teal); border-radius:10px; box-shadow:4px 5px 0 #c9e2d8; }
        .sg-brand { font-weight:800; letter-spacing:-.04em; font-size:18px; } .sg-brand span { color:var(--coral); }
        .sg-topnav { margin-left:auto; display:flex; gap:8px; align-items:center; color:var(--muted); font-size:12px; font-weight:700; }
        .sg-navbtn { border:0; background:transparent; padding:9px 12px; color:inherit; cursor:pointer; border-radius:9px; display:flex; gap:7px; align-items:center; } .sg-navbtn:hover { background:var(--soft); color:var(--teal); }
        .sg-avatar { width:31px; height:31px; margin-left:9px; border-radius:50%; display:grid; place-items:center; background:#e8d4bb; color:#865b39; font-size:11px; font-weight:800; }
        .sg-layout { max-width:1440px; margin:auto; padding:42px clamp(18px,4vw,56px) 80px; }
        .sg-welcome { display:flex; justify-content:space-between; gap:22px; align-items:flex-end; margin-bottom:29px; } .sg-kicker { color:var(--coral); font:500 11px 'DM Mono'; letter-spacing:.12em; text-transform:uppercase; } 
        .sg-welcome h1 { margin:7px 0 8px; font:600 clamp(34px,4.2vw,55px)/.98 Newsreader,serif; letter-spacing:-.045em; } .sg-welcome p { color:var(--muted); font-size:13px; margin:0; }
        .sg-streak { background:#fff; border:1px solid var(--line); border-radius:15px; padding:14px 17px; min-width:157px; display:flex; gap:10px; align-items:center; box-shadow:0 7px 18px rgba(23,42,61,.04); } .sg-streak strong { display:block; font-size:15px; } .sg-streak small { color:var(--muted); font-size:10px; } .sg-fire { color:var(--coral); }
        .sg-workspace { display:grid; grid-template-columns:minmax(0,1.02fr) minmax(430px,.98fr); gap:20px; align-items:start; }
        .sg-card { background:var(--paper); border:1px solid var(--line); border-radius:19px; box-shadow:0 12px 30px rgba(33,62,71,.055); } .sg-card-pad { padding:22px; }
        .sg-cardhead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:19px; } .sg-cardhead h2 { font-size:17px; margin:0 0 4px; letter-spacing:-.03em; } .sg-cardhead p { color:var(--muted); font-size:11px; margin:0; } .sg-step { color:var(--teal); background:var(--mint); border-radius:99px; padding:6px 9px; font:500 10px 'DM Mono'; white-space:nowrap; }
        .sg-tabs { display:flex; gap:4px; background:#edf3ef; border-radius:10px; padding:3px; margin-bottom:12px; } .sg-tab { flex:1; border:0; color:var(--muted); background:transparent; padding:9px; border-radius:8px; cursor:pointer; font-size:11px; font-weight:700; } .sg-tab.active { background:#fff; color:var(--teal); box-shadow:0 2px 8px rgba(23,42,61,.08); }
        .sg-drop { border:1.5px dashed #aac5bd; border-radius:14px; min-height:156px; background:#f6faf7; display:grid; place-items:center; text-align:center; padding:17px; transition:.2s; } .sg-drop:hover { border-color:var(--teal); background:#f0f8f3; } .sg-uploadicon { margin:auto auto 8px; width:35px;height:35px; display:grid;place-items:center; border-radius:11px; background:#dcefe7; color:var(--teal); } .sg-drop strong { display:block; font-size:12px; } .sg-drop small { color:var(--muted); font-size:10px; display:block; margin-top:5px; } .sg-browse { color:var(--teal); text-decoration:underline; cursor:pointer; } .sg-hidden { display:none; }
        .sg-file { display:flex; align-items:center; gap:10px; background:#fff; border:1px solid var(--line); border-radius:11px; padding:10px 12px; margin-top:11px; font-size:11px; } .sg-fileicon { color:var(--coral); } .sg-file small { display:block; color:var(--muted); margin-top:2px; } .sg-iconbutton { margin-left:auto; border:0; background:transparent; color:#9aa8ad; cursor:pointer; padding:4px; } .sg-iconbutton:hover { color:var(--coral); }
        .sg-textarea { width:100%; min-height:150px; resize:vertical; border:1px solid var(--line); border-radius:12px; background:#fff; padding:13px; color:var(--ink); font-size:12px; line-height:1.65; outline:0; } .sg-textarea:focus { border-color:var(--teal); box-shadow:0 0 0 3px #dff0e9; }
        .sg-divider { display:flex; align-items:center; gap:10px; color:#9ba8aa; font:500 10px 'DM Mono'; margin:19px 0 15px; } .sg-divider:before,.sg-divider:after { content:""; height:1px; background:var(--line); flex:1; }
        .sg-label { color:var(--muted); display:block; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.11em; margin-bottom:7px; } .sg-focus { width:100%; background:#fff; border:1px solid var(--line); border-radius:9px; padding:10px; color:var(--ink); font-size:11px; outline:0; }
        .sg-outputgrid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; } .sg-output { border:1px solid var(--line); background:#fff; border-radius:11px; padding:11px; text-align:left; cursor:pointer; transition:.18s; } .sg-output:hover { transform:translateY(-1px); border-color:#9dc4b9; } .sg-output.on { background:#eff8f3; border-color:#75aa9d; box-shadow:inset 3px 0 var(--teal); } .sg-output strong { display:block; font-size:11px; } .sg-output span { color:var(--muted); display:block; font-size:9px; margin-top:4px; }
        .sg-controls { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:18px; } .sg-select { width:100%; padding:9px 8px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); font-size:11px; outline:0; }
        .sg-generate { width:100%; border:0; border-radius:11px; color:#fff; background:var(--teal); padding:13px; margin-top:18px; cursor:pointer; font-weight:800; font-size:12px; display:flex; gap:8px; align-items:center; justify-content:center; transition:.18s; } .sg-generate:hover { background:#125958; transform:translateY(-1px); } .sg-generate:disabled { opacity:.7; cursor:wait; }
        .sg-preview { min-height:550px; overflow:hidden; } .sg-resulttop { padding:23px 23px 18px; background:#edf6f0; border-bottom:1px solid var(--line); } .sg-resulttop h2 { font:600 28px Newsreader,serif; margin:8px 0 8px; letter-spacing:-.04em; } .sg-resulttop p { max-width:470px; color:#55706e; font-size:11px; line-height:1.55; margin:0; } .sg-resultmeta { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; } .sg-pill { background:#fff; border:1px solid #d5e7df; border-radius:99px; padding:5px 8px; color:var(--teal); font:500 9px 'DM Mono'; }
        .sg-resultbody { padding:20px 23px 23px; } .sg-sectionlabel { display:flex; justify-content:space-between; align-items:center; color:var(--muted); font:500 10px 'DM Mono'; text-transform:uppercase; letter-spacing:.12em; margin-bottom:12px; } .sg-sectionlabel button { border:0; background:transparent; color:var(--teal); font:inherit; cursor:pointer; text-transform:none; letter-spacing:0; }
        .sg-note { border-left:3px solid var(--coral); background:#fff; border-radius:0 12px 12px 0; padding:14px 15px; margin-bottom:10px; } .sg-note h3 { margin:0 0 7px; font-size:12px; } .sg-note p { margin:0; color:#587080; line-height:1.62; font-size:11px; } .sg-note em { color:var(--teal); font-style:normal; font-weight:800; }
        .sg-mcq { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-top:18px; } .sg-mcq b { font-size:11px; line-height:1.45; } .sg-option { padding:7px 9px; border-radius:7px; background:#f4f7f4; color:#657580; margin-top:6px; font-size:10px; } .sg-option.correct { background:#e2f2e8; color:var(--teal); font-weight:700; display:flex; justify-content:space-between; }
        .sg-bottom { display:grid; grid-template-columns:1.05fr .95fr; gap:20px; margin-top:20px; } .sg-historylist { display:grid; gap:7px; } .sg-historyitem { width:100%; text-align:left; cursor:pointer; border:1px solid transparent; background:transparent; border-radius:11px; padding:11px; display:flex; gap:10px; align-items:center; color:var(--ink); } .sg-historyitem:hover,.sg-historyitem.selected { background:#eef6f2; border-color:#d4e8de; } .sg-historyitem svg { color:var(--teal); flex:none; } .sg-historyitem strong { display:block; font-size:11px; } .sg-historyitem small { display:block; color:var(--muted); font-size:9px; margin-top:3px; }
        .sg-chat { min-height:240px; display:flex; flex-direction:column; } .sg-chatbody { flex:1; } .sg-chatbubble { background:#edf6f0; border-radius:12px 12px 12px 3px; padding:12px; color:#52716c; font-size:11px; line-height:1.6; } .sg-chatquestion { color:var(--muted); font-size:10px; margin:12px 0 8px; } .sg-chatform { display:flex; gap:6px; border-top:1px solid var(--line); padding-top:13px; margin-top:15px; } .sg-chatform input { flex:1; min-width:0; border:1px solid var(--line); border-radius:9px; padding:9px; font-size:10px; outline:0; } .sg-chatform button { border:0; border-radius:9px; background:var(--teal); color:#fff; width:34px; cursor:pointer; display:grid; place-items:center; }
        .sg-empty { min-height:480px; display:grid; place-items:center; text-align:center; color:var(--muted); padding:30px; } .sg-empty svg { color:#94bcae; margin:auto; } .sg-empty h3 { color:var(--ink); font:600 25px Newsreader,serif; margin:13px 0 5px; } .sg-empty p { font-size:11px; max-width:220px; line-height:1.55; }
        @media(max-width:900px){ .sg-workspace{grid-template-columns:1fr;} .sg-preview{min-height:0;} .sg-bottom{grid-template-columns:1fr;} } @media(max-width:560px){ .sg-topbar{height:62px;} .sg-topnav .sg-navbtn:not(:last-of-type){display:none;} .sg-layout{padding-top:27px;} .sg-welcome{align-items:flex-start; flex-direction:column;} .sg-streak{align-self:stretch;} .sg-card-pad{padding:17px;} .sg-controls{grid-template-columns:1fr;} .sg-outputgrid{grid-template-columns:1fr 1fr;} .sg-resulttop,.sg-resultbody{padding:18px;} }
      `}</style>

      <header className="sg-topbar">
        <MiniLogo /><div className="sg-brand">Study<span>Genius</span></div>
        <nav className="sg-topnav">
          <button className="sg-navbtn"><BookOpen size={14} /> Workspace</button>
          <button className="sg-navbtn"><History size={14} /> History</button>
          <button className="sg-navbtn"><CircleHelp size={14} /> Help</button>
          <div className="sg-avatar">AS</div>
        </nav>
      </header>

      <main className="sg-layout">
        <div className="sg-welcome">
          <div><div className="sg-kicker">Your study desk · Monday, 20 May</div><h1>Make a chapter<br />feel <i>familiar.</i></h1><p>Turn your material into a study pack that actually helps you remember.</p></div>
          <div className="sg-streak"><Flame className="sg-fire" size={21} /><div><strong>4 day streak</strong><small>Keep the rhythm going</small></div></div>
        </div>

        <div className="sg-workspace">
          <section className="sg-card sg-card-pad">
            <div className="sg-cardhead"><div><h2>Build your study pack</h2><p>Start with a chapter, lecture, or a question.</p></div><span className="sg-step">01 / source</span></div>
            <div className="sg-tabs"><button className={`sg-tab ${sourceMode === "upload" ? "active" : ""}`} onClick={() => setSourceMode("upload")}><UploadCloud size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />Upload a file</button><button className={`sg-tab ${sourceMode === "paste" ? "active" : ""}`} onClick={() => setSourceMode("paste")}><Plus size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />Paste text</button></div>
            {sourceMode === "upload" ? <><label className="sg-drop"><input className="sg-hidden" type="file" accept=".pdf,.docx,.txt" onChange={handleFile} /><div><div className="sg-uploadicon"><UploadCloud size={18} /></div><strong>Drop your file here</strong><small>PDF, DOCX or TXT · up to 20 MB<br /><span className="sg-browse">Browse files</span> from your device</small></div></label><div className="sg-file"><FileText size={18} className="sg-fileicon" /><div><strong>{fileName}</strong><small>Ready to read · 8 pages</small></div><button className="sg-iconbutton" onClick={() => setFileName("")}><X size={15} /></button></div></> : <textarea className="sg-textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your lecture notes or textbook excerpt here..." />}
            <div className="sg-divider">shape the pack</div>
            <label className="sg-label">Topic focus <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label><input className="sg-focus" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. ATP production, not the whole chapter" />
            <div style={{ marginTop: 18 }}><label className="sg-label">What do you want to make?</label><div className="sg-outputgrid">{outputOptions.map((item) => <button key={item.id} className={`sg-output ${outputs.includes(item.id) ? "on" : ""}`} onClick={() => toggleOutput(item.id)}><strong>{outputs.includes(item.id) && <Check size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />}{item.label}</strong><span>{item.hint}</span></button>)}</div></div>
            <div className="sg-controls"><label className="sg-label">Language<select className="sg-select" value={language} onChange={(e) => setLanguage(e.target.value)}><option>English</option><option>Hindi</option><option>English + Hindi</option></select></label><label className="sg-label">Difficulty<select className="sg-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option>Gentle start</option><option>Exam ready</option><option>Challenge me</option></select></label><label className="sg-label">Items<select className="sg-select" value={count} onChange={(e) => setCount(e.target.value)}><option>6</option><option>12</option><option>20</option><option>30</option></select></label></div>
            <button className="sg-generate" onClick={generate} disabled={isGenerating || outputs.length === 0}>{isGenerating ? <><Loader2 size={15} className="sg-spin" /> Building your study pack…</> : <><Sparkles size={15} /> Generate study pack <ArrowUpRight size={14} /></>}</button>
          </section>

          <section className="sg-card sg-preview">
            {!generated ? <div className="sg-empty"><div><Target size={42} /><h3>Your pack will land here.</h3><p>Choose a format, then generate. We’ll keep the source and structure close at hand.</p></div></div> : <><div className="sg-resulttop"><div className="sg-kicker">Study pack · ready to review</div><h2>Cellular respiration</h2><p>A clear path through glycolysis, the Krebs cycle, and oxidative phosphorylation — with exam-ready practice along the way.</p><div className="sg-resultmeta"><span className="sg-pill">Biology · Chapter 7</span><span className="sg-pill">{count} items</span><span className="sg-pill">{difficulty}</span></div></div><div className="sg-resultbody"><div className="sg-sectionlabel"><span>Key ideas</span><button>Open full pack <ArrowUpRight size={11} style={{ verticalAlign: "middle" }} /></button></div><article className="sg-note"><h3>01 · The big picture</h3><p>Cells convert the chemical energy in <em>glucose</em> into usable <em>ATP</em>. In aerobic respiration, this happens through three linked stages.</p></article><article className="sg-note"><h3>02 · Follow the energy</h3><p><em>Glycolysis</em> starts in the cytoplasm. Pyruvate then enters the mitochondrion, where electron carriers feed the final ATP-making stage.</p></article><div className="sg-mcq"><div style={{ color: "var(--coral)", font: "500 9px 'DM Mono'", marginBottom: 8 }}>PRACTICE CHECK · 01</div><b>Where does glycolysis take place?</b><div className="sg-option">A&nbsp;&nbsp; The nucleus</div><div className="sg-option correct">B&nbsp;&nbsp; The cytoplasm <Check size={13} /></div><div className="sg-option">C&nbsp;&nbsp; The inner mitochondrial membrane</div><div className="sg-option">D&nbsp;&nbsp; The ribosome</div></div></div></>}
          </section>
        </div>

        <div className="sg-bottom">
          <section className="sg-card sg-card-pad"><div className="sg-cardhead"><div><h2>Recent study packs</h2><p>Pick up where you left off.</p></div><History size={18} color="var(--muted)" /></div><div className="sg-historylist">{history.map((item) => <button className={`sg-historyitem ${selectedHistory === item.id ? "selected" : ""}`} key={item.id} onClick={() => { setSelectedHistory(item.id); setGenerated(true); }}><FileText size={17} /><div><strong>{item.title}</strong><small>{item.source} · {item.meta}</small></div><ChevronDown size={14} style={{ marginLeft: "auto", transform: "rotate(-90deg)", color: "var(--muted)" }} /></button>)}</div><button className="sg-navbtn" style={{ marginTop: 9, color: "var(--teal)", paddingLeft: 2 }} onClick={() => setHistory([])}><Trash2 size={13} /> Clear local history</button></section>
          <section className="sg-card sg-card-pad sg-chat"><div className="sg-cardhead"><div><h2><MessageCircle size={16} style={{ verticalAlign: "middle", marginRight: 7, color: "var(--teal)" }} />Ask your document</h2><p>Answers stay grounded in your uploaded source.</p></div><span className="sg-step">chat</span></div><div className="sg-chatbody"><div className="sg-chatquestion">You asked: What happens in the electron transport chain?</div><div className="sg-chatbubble">{chatAnswer}</div></div><form className="sg-chatform" onSubmit={askQuestion}><input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="Ask about this chapter…" /><button aria-label="Send question"><Send size={14} /></button></form></section>
        </div>
      </main>
    </div>
  );
}

export { CramAIWorkspace };
export default CramAIWorkspace;
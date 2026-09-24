import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, FileText, FolderOpen, LoaderCircle, Play, Upload, AlertCircle } from 'lucide-react';
import { assetOutputPath, blockMarkdown, convertProject, renameLabel, validateDraft, type BlockKind, type ConversionDraft, type DraftBlock, type SourceFile } from './converter';
import { serializeIntermediate, parseIntermediate } from './intermediate';
import { compilePdf } from './compile';
import { downloadWorkspace, settingsJson } from './export';
import PdfPages from './PdfPages';

const example = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb,amsthm}
\newtheorem{lemma}{Lemma}
\newcommand{\R}{\mathbb{R}}
\title{Foundations of Analysis}
\begin{document}
\maketitle
An article about sequences in $\R$.

\section{Convergence}
Let $(a_n)$ be a real sequence.

\begin{lemma}[Uniqueness of limits]\label{lem:unique}
A sequence has at most one limit.
\end{lemma}
\begin{proof}
If $a_n\to L$ and $a_n\to M$, then
\[
|L-M|\leq |L-a_n|+|a_n-M|\to 0.
\]
Hence $L=M$.
\end{proof}

We will use \ref{lem:unique} later.
\end{document}`;
const initialFiles: SourceFile[] = [{ path: 'main.tex', text: example }];
const initialDraft = convertProject(initialFiles, 'main.tex');
const stages = [
  { title: 'Source', sub: 'Upload or paste TeX' },
  { title: 'Original PDF', sub: 'Compile and compare' },
  { title: 'Combined Markdown', sub: 'Review the conversion' },
  { title: 'Block files', sub: 'Check the export' },
  { title: 'Editor view', sub: 'Read the result' },
] as const;
const fileType = (path: string) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' })[path.split('.').at(-1)?.toLowerCase() as 'png'] || 'application/octet-stream';

function Markdown({ content, draft, assets, select }: { content: string; draft: ConversionDraft; assets: Record<string, string>; select: (id: string) => void }) {
  const byLabel = new Map(draft.blocks.map(block => [block.label, block]));
  const linked = content.replace(/\[\[([^\]\n]+)\]\]/g, (whole, raw: string) => {
    const label = raw.replace(/∨$/, '').replace(/^@/, '').split('||')[0].trim();
    const target = byLabel.get(label);
    return target ? `[${target.title}](block:${encodeURIComponent(label)})` : whole;
  });
  const math = linked.replace(/\\\[\s*\n?([\s\S]*?)\n?\s*\\\]/g, (_whole, value: string) => `\n$$\n${value.trim()}\n$$\n`);
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { macros: draft.macros, throwOnError: false, strict: 'ignore' }]]} urlTransform={url => url.startsWith('block:') ? url : defaultUrlTransform(url)} components={{
    a: ({ href, children }) => href?.startsWith('block:') ? <button className="text-link" onClick={() => { const block = byLabel.get(decodeURIComponent(href.slice(6))); if (block) select(block.id); }}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }) => <img src={assets[src || ''] || src} alt={alt || ''} />,
  }}>{math}</ReactMarkdown>;
}

function Article({ block, draft, assets, select, depth = 0 }: { block: DraftBlock; draft: ConversionDraft; assets: Record<string, string>; select: (id: string) => void; depth?: number }) {
  const segments = block.content.split(/(\[\[[^\]\n]+∨\]\])/g);
  return <section className={`article-block depth-${Math.min(depth, 3)}`} id={`block-${block.id}`}>
    <button className="article-heading" onClick={() => select(block.id)}><span>{block.title}</span><small>{block.kind}</small></button>
    {segments.map((segment, i) => {
      const match = segment.match(/^\[\[([^\]\n]+)∨\]\]$/);
      if (match) {
        const child = draft.blocks.find(candidate => candidate.label === match[1]);
        return child && depth < 20 ? <Article key={`${child.id}-${i}`} block={child} draft={draft} assets={assets} select={select} depth={depth + 1} /> : <p className="issue" key={i}>Missing block: {match[1]}</p>;
      }
      return segment.trim() ? <Markdown key={i} content={segment} draft={draft} assets={assets} select={select} /> : null;
    })}
  </section>;
}

const blockKinds: BlockKind[] = ['document', 'section', 'subsection', 'definition', 'lemma', 'proposition', 'theorem', 'corollary', 'proof', 'example', 'remark', 'exercise'];

function InlineBlock({ block, draft, depth, activeId, activate, change, rename }: { block: DraftBlock; draft: ConversionDraft; depth: number; activeId: string | null; activate: (id: string) => void; change: (id: string, value: Partial<DraftBlock>) => void; rename: (id: string, label: string) => void }) {
  const [label, setLabel] = useState(block.label);
  useEffect(() => setLabel(block.label), [block.label]);
  const children = draft.blocks.filter(candidate => candidate.parentId === block.id);
  const pieces = block.content.split(/(\[\[[^\]\n]+∨\]\])/g);
  const editPiece = (index: number, value: string) => {
    const next = [...pieces];
    const leading = next[index].match(/^\n*/)?.[0] || '';
    const trailing = next[index].match(/\n*$/)?.[0] || '';
    next[index] = leading + value + trailing;
    change(block.id, { content: next.join('') });
  };
  return <section className={`inline-block depth-${Math.min(depth, 3)}${activeId === block.id ? ' active' : ''}`}>
    <div className="inline-boundary"><div className="inline-fields"><select className="inline-kind-edit" aria-label={`Kind of ${block.title}`} title={`Block kind · ${block.id}`} value={block.kind} onFocus={() => activate(block.id)} onChange={event => change(block.id, { kind: event.target.value as BlockKind })}>{blockKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select><input className="inline-title-edit" aria-label={`Title of ${block.kind}`} title="Block title" value={block.title} size={Math.max(8, Math.min(block.title.length + 1, 42))} onFocus={() => activate(block.id)} onChange={event => change(block.id, { title: event.target.value })} /><input className="inline-label-edit" aria-label={`Label of ${block.title}`} title="Block label · press Enter or leave the field to update references" value={label} size={Math.max(12, Math.min(label.length + 1, 56))} onFocus={() => activate(block.id)} onChange={event => setLabel(event.target.value)} onBlur={() => rename(block.id, label)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div></div>
    <div className="inline-scope">{pieces.map((piece, index) => {
        const match = piece.match(/^\[\[([^\]\n]+)∨\]\]$/);
        if (match) {
          const child = children.find(candidate => candidate.label === match[1]);
          return child ? <InlineBlock key={child.id} block={child} draft={draft} depth={depth + 1} activeId={activeId} activate={activate} change={change} rename={rename} /> : <textarea key={index} className="inline-text" aria-label={`${block.title} Markdown`} value={piece.trim()} onFocus={() => activate(block.id)} onChange={event => editPiece(index, event.target.value)} spellCheck={false} />;
        }
        return piece.trim() ? <textarea key={index} className="inline-text" aria-label={`${block.title} Markdown`} value={piece.replace(/^\n+|\n+$/g, '')} onFocus={() => activate(block.id)} onChange={event => editPiece(index, event.target.value)} spellCheck={false} /> : null;
      })}{children.filter(child => !block.content.includes(`[[${child.label}∨]]`)).map(child => <InlineBlock key={child.id} block={child} draft={draft} depth={depth + 1} activeId={activeId} activate={activate} change={change} rename={rename} />)}</div>
  </section>;
}

export default function App() {
  const [stage, setStage] = useState(1);
  const [files, setFiles] = useState<SourceFile[]>(initialFiles);
  const [mainPath, setMainPath] = useState('main.tex');
  const [draft, setDraft] = useState(initialDraft);
  const [combined, setCombined] = useState(() => serializeIntermediate(initialDraft));
  const [combinedError, setCombinedError] = useState('');
  const [combinedPending, setCombinedPending] = useState(false);
  const [sourcePending, setSourcePending] = useState(false);
  const [selectedId, setSelectedId] = useState(initialDraft.rootId);
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState(initialDraft.blocks[0].label);
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfLog, setPdfLog] = useState('');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'working' | 'ready' | 'error' | 'stale'>('idle');
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const combinedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfUrlRef = useRef('');
  const sourceVersion = useRef(0);

  useEffect(() => { folderPicker.current?.setAttribute('webkitdirectory', ''); }, []);
  useEffect(() => () => { if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); }, []);
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const file of draft.assets) if (file.bytes) urls[assetOutputPath(file.path, draft.mainPath)] = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: fileType(file.path) }));
    setAssets(urls);
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  }, [draft.assets, draft.mainPath]);

  const selected = draft.blocks.find(block => block.id === selectedId) || draft.blocks[0];
  const issues = useMemo(() => validateDraft(draft), [draft]);
  const errors = issues.filter(item => item.level === 'error').length;
  const source = files.find(file => file.path === mainPath)?.text || '';
  const stageInfo = stages[stage - 1];

  function acceptDraft(next: ConversionDraft) {
    if (combinedTimer.current) clearTimeout(combinedTimer.current);
    setDraft(next);
    setCombined(serializeIntermediate(next));
    setCombinedError('');
    setCombinedPending(false);
    setSelectedId(next.rootId);
    setLabelInput(next.blocks[0].label);
    setSourcePending(false);
  }
  function changeSource(value: string) {
    sourceVersion.current++;
    setSourcePending(true);
    const next = files.map(file => file.path === mainPath ? { ...file, text: value } : file);
    setFiles(next);
    setPdfStatus(pdfUrl ? 'stale' : 'idle');
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    sourceTimer.current = setTimeout(() => acceptDraft(convertProject(next, mainPath)), 450);
  }
  function changeCombined(value: string) {
    setCombined(value);
    setCombinedPending(true);
    if (combinedTimer.current) clearTimeout(combinedTimer.current);
    combinedTimer.current = setTimeout(() => {
      try {
        const next = parseIntermediate(value, draft);
        setDraft(next);
        setCombinedError('');
      } catch (error) { setCombinedError(error instanceof Error ? error.message : 'Invalid combined Markdown.'); }
      setCombinedPending(false);
    }, 450);
  }
  function changeBlock(id: string, change: Partial<DraftBlock>) {
    const next = { ...draft, blocks: draft.blocks.map(block => block.id === id ? { ...block, ...change } : block) };
    setDraft(next);
    setCombined(serializeIntermediate(next));
    setCombinedError('');
    setCombinedPending(false);
  }
  function commitLabel() {
    const next = renameLabel(draft, selected.id, labelInput);
    setDraft(next);
    setCombined(serializeIntermediate(next));
    setCombinedError('');
    setCombinedPending(false);
    setLabelInput(next.blocks.find(block => block.id === selected.id)?.label || selected.label);
  }
  function renameScope(id: string, label: string) {
    const next = renameLabel(draft, id, label);
    setDraft(next);
    setCombined(serializeIntermediate(next));
    setCombinedError('');
    setCombinedPending(false);
    if (id === selectedId) setLabelInput(next.blocks.find(block => block.id === id)?.label || label);
  }
  function selectBlock(id: string) {
    const found = draft.blocks.find(block => block.id === id);
    if (!found) return;
    setSelectedId(id);
    setLabelInput(found.label);
    document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function importFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: SourceFile[] = await Promise.all(Array.from(list).map(async file => ({ path: file.webkitRelativePath || file.name, ...(/\.tex$/i.test(file.name) ? { text: await file.text() } : { bytes: new Uint8Array(await file.arrayBuffer()) }) })));
    const tex = next.filter(file => file.text !== undefined);
    if (!tex.length) return;
    const main = tex.find(file => /(?:main|article|paper)\.tex$/i.test(file.path)) || tex[0];
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    setFiles(next);
    sourceVersion.current++;
    setMainPath(main.path);
    acceptDraft(convertProject(next, main.path));
    setPdfStatus('idle');
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = '';
    setPdfUrl('');
    setPdfLog('');
    setStage(1);
  }
  function switchMain(path: string) {
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    sourceVersion.current++;
    setMainPath(path);
    acceptDraft(convertProject(files, path));
    setPdfStatus(pdfUrl ? 'stale' : 'idle');
  }
  async function runCompile() {
    const version = sourceVersion.current;
    setPdfStatus('working');
    setPdfLog('Loading the browser TeX engine and compiling…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      compilePdf(files, mainPath),
      new Promise<{ pdf: Blob | null; log: string }>(resolve => {
        timer = setTimeout(() => resolve({ pdf: null, log: 'PDF compilation timed out after two minutes. Try a smaller TeX file or reload the page before retrying.' }), 120_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    setPdfLog(result.log);
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = result.pdf ? URL.createObjectURL(result.pdf) : '';
    setPdfUrl(pdfUrlRef.current);
    setPdfStatus(version !== sourceVersion.current ? 'stale' : result.pdf ? 'ready' : 'error');
  }
  async function exportZip() {
    if (errors || combinedError || combinedPending || sourcePending) return;
    setExporting(true);
    try { await downloadWorkspace(draft); }
    finally { setExporting(false); }
  }
  const blockList = <div className="block-list">{draft.blocks.map(block => <button key={block.id} className={block.id === selected.id ? 'selected' : ''} onClick={() => selectBlock(block.id)} style={{ paddingLeft: 12 + block.label.split('/').length * 10 }}><span>{block.title}</span><small>{block.kind}</small></button>)}</div>;
  const blockEditor = <div className="block-editor"><div className="field-row"><label>Title<input value={selected.title} onChange={e => changeBlock(selected.id, { title: e.target.value })} /></label><label>Label<input value={labelInput} onChange={e => setLabelInput(e.target.value)} onBlur={commitLabel} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /></label></div><label>Markdown content<textarea value={selected.content} onChange={e => changeBlock(selected.id, { content: e.target.value })} spellCheck={false} /></label></div>;

  return <div className="app">
    <header className="top"><div className="brand"><BookOpen size={21} /><div><strong>Block Converter</strong><span>TeX to connected notes</span></div></div><button className="export" disabled={!!errors || !!combinedError || combinedPending || sourcePending || exporting} onClick={() => void exportZip()}><ArrowDownToLine size={16} />{exporting ? 'Preparing…' : 'Export workspace'}</button></header>
    <main>
      <nav className="steps" aria-label="Conversion stages">{stages.map((item, index) => <button key={item.title} className={stage === index + 1 ? 'active' : ''} onClick={() => setStage(index + 1)}><span className="step-number">{index + 1}</span><span>{item.title}</span></button>)}</nav>
      <div className="heading"><div><span className="eyebrow">STAGE {stage} OF 5</span><h1>{stageInfo.title}</h1><p>{stageInfo.sub}. Changes in an earlier stage update the stages that follow.</p></div><div className="heading-actions"><span className="count">{draft.blocks.length} blocks · {issues.length} issues</span>{stage < 5 && <button className="next" onClick={() => setStage(stage + 1)}>Next <ArrowRight size={15} /></button>}</div></div>
      {stage === 1 && <div className="panes"><section className="pane"><div className="pane-head"><strong>Original TeX</strong><span>Editable</span></div><div className="toolbar"><button onClick={() => filePicker.current?.click()}><Upload size={15} /> Choose files</button><button onClick={() => folderPicker.current?.click()}><FolderOpen size={15} /> Choose folder</button><input ref={filePicker} type="file" multiple accept=".tex,.bib,.png,.jpg,.jpeg,.gif,.svg,.webp,.pdf" hidden onChange={e => void importFiles(e.target.files)} /><input ref={folderPicker} type="file" multiple hidden onChange={e => void importFiles(e.target.files)} /></div><textarea className="codearea" aria-label="TeX source" value={source} onChange={e => changeSource(e.target.value)} spellCheck={false} placeholder="Paste a complete TeX document here…" /></section><section className="pane"><div className="pane-head"><strong>Project</strong><span>{files.length} files</span></div><div className="pane-content"><label className="file-select">Main TeX file<select value={mainPath} onChange={e => switchMain(e.target.value)}>{files.filter(file => file.text !== undefined).map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label><div className="file-list">{files.map(file => <div key={file.path}><FileText size={14} /><span>{file.path}</span></div>)}</div><h3>Detected blocks</h3>{blockList}</div></section></div>}
      {stage === 2 && <div className="panes"><section className="pane"><div className="pane-head"><strong>Original TeX</strong><span>Editable</span></div><textarea className="codearea" aria-label="TeX source" value={source} onChange={e => changeSource(e.target.value)} spellCheck={false} /></section><section className="pane"><div className="pane-head"><strong>Expected PDF</strong><span>{pdfStatus === 'ready' ? 'Compiled locally' : pdfStatus === 'stale' ? 'Source changed' : 'Browser TeX'}</span></div><div className="compile-bar"><button className="primary" disabled={pdfStatus === 'working'} onClick={() => void runCompile()}>{pdfStatus === 'working' ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} {pdfStatus === 'working' ? 'Compiling…' : pdfStatus === 'stale' ? 'Recompile PDF' : 'Compile PDF'}</button>{pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>}</div>{pdfStatus === 'working' && <p className="compile-status" role="status">Loading the TeX engine and compiling. The first run may take a while.</p>}{pdfUrl ? <PdfPages url={pdfUrl} /> : <div className="empty-pdf"><FileText size={34} /><strong>{pdfStatus === 'error' ? 'Compilation did not produce a PDF' : 'Compile to see the original layout'}</strong><p>The TeX engine runs in your browser. First use downloads its runtime files; conversion can continue if compilation fails.</p></div>}{pdfLog && <details className="log" open={pdfStatus === 'error'}><summary>Compilation log</summary><pre>{pdfLog.slice(-12000)}</pre></details>}</section></div>}
      {stage === 3 && <section className="pane combined-pane"><div className="pane-head"><strong>Combined Markdown</strong><span>Edit kind, title, and label in place</span></div><div className="combined-document"><details className="inline-settings"><summary>Settings · {Object.keys(draft.macros).length} math macros</summary><pre>{JSON.stringify(draft.macros, null, 2)}</pre></details>{draft.blocks.filter(block => !block.parentId).map(block => <InlineBlock key={block.id} block={block} draft={draft} depth={0} activeId={activeScopeId} activate={setActiveScopeId} change={changeBlock} rename={renameScope} />)}</div><details className="raw-combined"><summary>Raw combined Markdown</summary><textarea className="codearea" aria-label="Combined Markdown" value={combined} onChange={e => changeCombined(e.target.value)} spellCheck={false} />{combinedError && <div className="inline-error"><AlertCircle size={15} />{combinedError}</div>}</details></section>}
      {stage === 4 && <div className="panes"><section className="pane"><div className="pane-head"><strong>Block data</strong><span>{draft.blocks.length} files</span></div><div className="pane-content">{blockList}{blockEditor}</div></section><section className="pane"><div className="pane-head"><strong>Exported files</strong><span>All blocks in reading order</span></div><div className="all-files"><details className="settings-file"><summary>Settings · setting/settings.json</summary><pre>{settingsJson(draft)}</pre></details>{draft.blocks.map(block => <section className="exported-block" key={block.id}><div className="exported-block-head"><strong>{block.title}</strong><span>{block.kind} · {block.id}.md</span></div><div className="exported-label">{block.label}</div><pre>{blockMarkdown(block)}</pre></section>)}</div><div className="export-tree"><strong>Workspace ZIP</strong><span>{draft.blocks.length} block .md files</span><span>setting/settings.json</span>{draft.assets.map(file => <span key={file.path}>{assetOutputPath(file.path, draft.mainPath)}</span>)}</div></section></div>}
      {stage === 5 && <div className="panes"><section className="pane"><div className="pane-head"><strong>Selected block</strong><span>Editable Markdown</span></div><div className="pane-content">{blockList}{blockEditor}</div></section><section className="pane"><div className="pane-head"><strong>Continuous editor view</strong><span>Live preview</span></div><div className="article-scroll"><Article block={draft.blocks.find(block => block.id === draft.rootId) || draft.blocks[0]} draft={draft} assets={assets} select={selectBlock} /></div></section></div>}
      {issues.length > 0 && <details className="issues"><summary><AlertCircle size={15} /> Review {issues.length} conversion issue{issues.length === 1 ? '' : 's'}</summary><div>{issues.map((item, index) => <button key={index} onClick={() => item.blockId && selectBlock(item.blockId)}><strong>{item.level}</strong> {item.message}</button>)}</div></details>}
      <div className="bottom"><span>Files are processed in your browser.</span><button className="export" disabled={!!errors || !!combinedError || combinedPending || sourcePending || exporting} onClick={() => void exportZip()}><Check size={15} /> Export workspace ZIP</button></div>
    </main>
  </div>;
}

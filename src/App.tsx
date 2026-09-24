import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ArrowDownToLine, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Code2, FileArchive, FileText, FolderOpen, Link2, PencilLine, RefreshCw, UploadCloud, WandSparkles, X } from 'lucide-react';
import { assetOutputPath, blockMarkdown, convertProject, renameLabel, validateDraft, type ConversionDraft, type DraftBlock, type SourceFile } from './converter';
import { downloadWorkspace } from './export';

const sample = String.raw`\documentclass{article}
\usepackage{amsmath}
\newcommand{\R}{\mathbb{R}}
\title{Foundations of Analysis}
\begin{document}
\maketitle
This article begins with a simple observation about sequences in $\R$.

\section{Convergence}
Let $(a_n)$ be a real sequence. We say it converges when its terms approach one value.

\begin{definition}[Limit]\label{def:limit}
The sequence $(a_n)$ converges to $L$ if, for every $\varepsilon>0$, there is an $N$ such that
\[
  n \ge N \implies |a_n-L| < \varepsilon.
\]
\end{definition}

\begin{lemma}[Uniqueness of limits]\label{lem:unique}
A sequence in $\R$ has at most one limit.
\end{lemma}

\begin{proof}
Suppose $a_n$ converges to both $L$ and $M$. By \ref{def:limit}, choose $N$ so that both errors are smaller than $\varepsilon/2$. Then
\begin{align*}
|L-M| &\le |L-a_n| + |a_n-M| \\
      &< \varepsilon.
\end{align*}
Hence $L=M$.
\end{proof}

The conclusion of \ref{lem:unique} will be used throughout the article.
\end{document}`;

const sampleFiles: SourceFile[] = [{ path: 'foundations.tex', text: sample }];
const formatKind = (kind: DraftBlock['kind']) => kind === 'document' ? 'Document' : kind[0].toUpperCase() + kind.slice(1);
const mimeFor = (path: string) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' })[path.split('.').at(-1)?.toLowerCase() as 'png'] || 'application/octet-stream';

function PreviewMarkdown({ markdown, draft, assetUrls, onSelect }: { markdown: string; draft: ConversionDraft; assetUrls: Record<string, string>; onSelect: (id: string) => void }) {
  const labels = new Map(draft.blocks.map(block => [block.label, block]));
  const linked = markdown.replace(/\[\[([^\]\n]+)\]\]/g, (match, inner: string) => {
    const [rawLabel, alias] = inner.replace(/^@/, '').split('||').map(value => value.trim());
    const target = labels.get(rawLabel);
    return target ? `[${alias || target.title}](block:${encodeURIComponent(target.label)})` : match;
  });
  const renderable = linked.replace(/\\\[\s*\n?([\s\S]*?)\n?\s*\\\]/g, (_all, math: string) => `\n$$\n${math.trim()}\n$$\n`);
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { macros: draft.macros, throwOnError: false, strict: 'ignore' }]]}
    urlTransform={url => url.startsWith('block:') ? url : defaultUrlTransform(url)}
    components={{
      a: ({ href, children }) => {
        if (href?.startsWith('block:')) {
          const label = decodeURIComponent(href.slice(6));
          const target = labels.get(label);
          return <button className="inline-link" onClick={() => target && onSelect(target.id)} title={label}><Link2 size={12} />{children}</button>;
        }
        return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      },
      img: ({ src, alt }) => <img className="preview-image" src={assetUrls[src || ''] || src} alt={alt || ''} />
    }}
  >{renderable}</ReactMarkdown>;
}

function ContinuousBlock({ block, draft, assetUrls, selectedId, onSelect, depth = 0 }: { block: DraftBlock; draft: ConversionDraft; assetUrls: Record<string, string>; selectedId: string; onSelect: (id: string) => void; depth?: number }) {
  const pieces = block.content.split(/(\[\[[^\]\n]+∨\]\])/g);
  return <section className={`preview-block depth-${Math.min(depth, 3)} ${selectedId === block.id ? 'selected' : ''}`} id={`preview-${block.id}`}>
    <div className="preview-block-head">
      <button onClick={() => onSelect(block.id)} className="block-title-button"><span className="kind-dot" />{block.title}</button>
      <span className="block-type">{formatKind(block.kind)}</span>
      <code>{block.label}</code>
    </div>
    <div className="preview-body">
      {pieces.map((piece, index) => {
        const open = piece.match(/^\[\[([^\]\n]+)∨\]\]$/);
        if (open) {
          const label = open[1].replace(/^@/, '').split('||')[0].trim();
          const child = draft.blocks.find(candidate => candidate.label === label);
          return child && depth < 20
            ? <ContinuousBlock key={`${child.id}-${index}`} block={child} draft={draft} assetUrls={assetUrls} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
            : <p className="missing-reference" key={index}>Unresolved embedded block: {label}</p>;
        }
        return piece.trim() ? <PreviewMarkdown key={index} markdown={piece} draft={draft} assetUrls={assetUrls} onSelect={onSelect} /> : null;
      })}
    </div>
  </section>;
}

export default function App() {
  const [files, setFiles] = useState<SourceFile[]>(sampleFiles);
  const [mainPath, setMainPath] = useState('foundations.tex');
  const [draft, setDraft] = useState<ConversionDraft>(() => convertProject(sampleFiles, 'foundations.tex'));
  const [selectedId, setSelectedId] = useState('block-1');
  const [labelInput, setLabelInput] = useState('foundations-of-analysis');
  const [sourceView, setSourceView] = useState<'tex' | 'markdown'>('tex');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', ''); }, []);
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const asset of draft.assets) {
      if (asset.bytes) urls[assetOutputPath(asset.path, draft.mainPath)] = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: mimeFor(asset.path) }));
    }
    setAssetUrls(urls);
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  }, [draft.assets, draft.mainPath]);

  const selected = draft.blocks.find(block => block.id === selectedId) || draft.blocks[0];
  const diagnostics = useMemo(() => validateDraft(draft), [draft]);
  const errorCount = diagnostics.filter(item => item.level === 'error').length;
  const warningCount = diagnostics.filter(item => item.level === 'warning').length;
  const source = files.find(file => file.path === mainPath)?.text || draft.source;

  function selectBlock(id: string) {
    const block = draft.blocks.find(candidate => candidate.id === id);
    if (!block) return;
    setSelectedId(id);
    setLabelInput(block.label);
    document.getElementById(`preview-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updateBlock(id: string, changes: Partial<DraftBlock>) {
    setDraft(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...changes } : block) }));
  }

  function commitLabel() {
    setDraft(current => {
      const next = renameLabel(current, selected.id, labelInput);
      setLabelInput(next.blocks.find(block => block.id === selected.id)?.label || selected.label);
      return next;
    });
  }

  async function loadFiles(selectedFiles: FileList | null) {
    if (!selectedFiles?.length) return;
    const next = await Promise.all(Array.from(selectedFiles).map(async file => {
      const path = file.webkitRelativePath || file.name;
      return /\.tex$/i.test(file.name)
        ? { path, text: await file.text() }
        : { path, bytes: new Uint8Array(await file.arrayBuffer()) };
    }));
    const texFiles = next.filter(file => file.text !== undefined);
    if (!texFiles.length) return;
    const preferred = texFiles.find(file => /(?:main|article|paper)\.tex$/i.test(file.path)) || texFiles[0];
    setFiles(next);
    setMainPath(preferred.path);
    const converted = convertProject(next, preferred.path);
    setDraft(converted);
    setSelectedId(converted.rootId);
    setLabelInput(converted.blocks[0].label);
    setSourceView('tex');
  }

  function runConversion(path = mainPath) {
    const converted = convertProject(files, path);
    setDraft(converted);
    setSelectedId(converted.rootId);
    setLabelInput(converted.blocks[0].label);
  }

  async function exportZip() {
    if (errorCount) { setShowDiagnostics(true); return; }
    setExporting(true);
    try { await downloadWorkspace(draft); }
    finally { setExporting(false); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><BookOpen size={21} strokeWidth={2.2} /></div><div><strong>Block Converter</strong><small>TeX to connected notes</small></div></div>
      <div className="topbar-right"><span className="privacy-note"><CheckCircle2 size={15} /> Files stay in your browser</span><button className="export-button" onClick={exportZip} disabled={exporting || !!errorCount}><ArrowDownToLine size={17} />{exporting ? 'Preparing…' : 'Export workspace'}<span className="export-count">{draft.blocks.length}</span></button></div>
    </header>

    <div className="hero-strip"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line" /> CONVERSION WORKSPACE</span><h1>From a document to<br /><em>connected ideas.</em></h1><p>Turn a TeX manuscript into reviewable blocks, keep every theorem in context, and export a ready-to-open Math Note workspace.</p></div><div className="hero-steps"><span><b>01</b> Import</span><ArrowRight size={15} /><span><b>02</b> Review</span><ArrowRight size={15} /><span><b>03</b> Export</span></div></div>

    <main className="workspace">
      <aside className="sidebar">
        <div className="panel-heading"><span>PROJECT</span><span className="heading-line" /></div>
        <div className="import-card" onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={event => event.key === 'Enter' && fileInput.current?.click()}>
          <div className="import-icon"><UploadCloud size={22} /></div><strong>Choose TeX files</strong><span>Main file, included files & images</span>
          <input ref={fileInput} type="file" multiple accept=".tex,.png,.jpg,.jpeg,.gif,.svg,.webp,.pdf" onChange={event => void loadFiles(event.target.files)} hidden />
        </div>
        <button className="folder-import" onClick={() => folderInput.current?.click()}><FolderOpen size={15} /> Or choose a project folder</button>
        <input ref={folderInput} type="file" multiple onChange={event => void loadFiles(event.target.files)} hidden />
        <div className="file-field"><label htmlFor="main-file">MAIN FILE</label><div className="select-wrap"><FileText size={15} /><select id="main-file" value={mainPath} onChange={event => { setMainPath(event.target.value); runConversion(event.target.value); }}>{files.filter(file => file.text !== undefined).map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select><ChevronDown size={14} /></div></div>
        <button className="reconvert" onClick={() => runConversion()}><RefreshCw size={14} /> Reconvert source</button>

        <div className="panel-heading outline-heading"><span>BLOCK OUTLINE</span><span className="count-pill">{draft.blocks.length}</span></div>
        <nav className="outline">{draft.blocks.map(block => <button key={block.id} className={`outline-item ${selectedId === block.id ? 'active' : ''}`} style={{ paddingLeft: 13 + (block.label.split('/').length - 1) * 13 }} onClick={() => selectBlock(block.id)}><span className="outline-node">{block.parentId ? <ChevronRight size={13} /> : <BookOpen size={13} />}</span><span className="outline-title">{block.title}</span></button>)}</nav>

        <button className={`diagnostic-button ${errorCount ? 'has-errors' : ''}`} onClick={() => setShowDiagnostics(value => !value)}><CircleAlert size={16} /><span>Review issues</span><b>{errorCount + warningCount}</b></button>
        {showDiagnostics && <div className="diagnostic-list">{diagnostics.length ? diagnostics.map((item, index) => <button key={index} onClick={() => item.blockId && selectBlock(item.blockId)} className={item.level}><strong>{item.level}</strong>{item.message}</button>) : <p>All labels and links look ready.</p>}</div>}
      </aside>

      <div className="main-area">
        <div className="section-header"><div><span className="eyebrow small">REVIEW THE CONVERSION</span><h2>Your document, in context.</h2><p>The right side renders the proposed Markdown. Select a block to edit its title, label or content.</p></div><div className="status-chip"><span className="status-dot" />{errorCount ? `${errorCount} errors to fix` : `${draft.blocks.length} blocks ready`}</div></div>
        <div className="comparison">
          <div className="source-panel"><div className="pane-head"><div><Code2 size={16} /><strong>Source</strong></div><div className="pane-tabs"><button className={sourceView === 'tex' ? 'active' : ''} onClick={() => setSourceView('tex')}>TeX</button><button className={sourceView === 'markdown' ? 'active' : ''} onClick={() => setSourceView('markdown')}>Selected .md</button></div></div><div className="source-scroll"><div className="source-filename">{sourceView === 'tex' ? mainPath : `${selected.id}.md`}</div><pre>{sourceView === 'tex' ? source : blockMarkdown(selected)}</pre></div></div>
          <div className="preview-panel"><div className="pane-head"><div><WandSparkles size={17} /><strong>Continuous preview</strong></div><span className="preview-badge"><span /> LIVE MARKDOWN</span></div><div className="preview-scroll" ref={previewRef}><ContinuousBlock block={draft.blocks[0]} draft={draft} assetUrls={assetUrls} selectedId={selectedId} onSelect={selectBlock} /><div className="preview-end">END OF DOCUMENT</div></div></div>
        </div>

        <div className="inspector"><div className="inspector-heading"><div className="inspector-icon"><PencilLine size={17} /></div><div><span>SELECTED BLOCK</span><h3>{selected.title}</h3></div><span className="inspector-kind">{formatKind(selected.kind)}</span></div><div className="inspector-fields"><label>Title<input value={selected.title} onChange={event => updateBlock(selected.id, { title: event.target.value })} /></label><label>Label<input value={labelInput} onChange={event => setLabelInput(event.target.value)} onBlur={commitLabel} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} /></label></div><label className="content-label">Markdown content<textarea value={selected.content} onChange={event => updateBlock(selected.id, { content: event.target.value })} spellCheck={false} /></label><div className="inspector-foot"><span>Open child links keep blocks visible in their original place.</span><button onClick={() => setSourceView('markdown')}><FileText size={14} /> View .md</button></div></div>
      </div>
    </main>
    <footer><span>Block Converter · TeX-first preview</span><span>Local processing · ZIP export · Math Note Editor format</span></footer>
  </div>;
}

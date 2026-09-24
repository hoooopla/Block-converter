import assert from 'node:assert/strict';
import test from 'node:test';
import { assetOutputPath, blockMarkdown, convertProject, parseBlockMarkdown, renameLabel, validateDraft } from './converter';
import { makeWorkspaceArchive } from './export';
import JSZip from 'jszip';
import { parseIntermediate, serializeIntermediate } from './intermediate';

test('converts a lemma, proof, and reference into ordered linked blocks', () => {
  const tex = String.raw`\title{Article name}\begin{document}
aaa
\begin{lemma}[A]\label{lemma A}
bbb
\end{lemma}
\begin{proof}
some math
\end{proof}
ccc in \ref{lemma A} ddd
\end{document}`;
  const draft = convertProject([{ path: 'article.tex', text: tex }], 'article.tex');
  assert.equal(draft.blocks.length, 3);
  const [article, lemma, proof] = draft.blocks;
  assert.equal(article.title, 'Article name');
  assert.equal(lemma.label, 'article-name/lemma-a');
  assert.equal(proof.parentId, lemma.id);
  assert.match(article.content, /aaa[\s\S]*\[\[article-name\/lemma-a∨\]\][\s\S]*ccc in \[\[article-name\/lemma-a\]\] ddd/);
  assert.match(lemma.content, /bbb[\s\S]*\[\[article-name\/lemma-a\/proof∨\]\]/);
  assert.equal(validateDraft(draft).length, 0);
  assert.match(blockMarkdown(lemma), /^---\nid: block-2\ntitle: "Lemma A"\nlabel: "article-name\/lemma-a"\n---/);
});

test('keeps math readable, exports macros, and updates links when a label changes', () => {
  const tex = String.raw`\newcommand{\R}{\mathbb{R}}
\title{Limits}\begin{document}
\begin{theorem}\label{thm:one}
For $x\in\R$,
\begin{align*}x & = x \\ 2x & = 2x\end{align*}
\end{theorem}
See \ref{thm:one}.
\end{document}`;
  const draft = convertProject([{ path: 'main.tex', text: tex }], 'main.tex');
  assert.equal(draft.macros['\\R'], '\\mathbb{R}');
  assert.match(draft.blocks[1].content, /\$x\\in\\R\$/);
  assert.match(draft.blocks[1].content, /\\\[\n\\begin\{aligned\}/);
  const renamed = renameLabel(draft, draft.blocks[1].id, 'limits/first-theorem');
  assert.match(renamed.blocks[0].content, /\[\[limits\/first-theorem∨\]\]/);
  assert.match(renamed.blocks[0].content, /\[\[limits\/first-theorem\]\]/);
  assert.equal(validateDraft(renamed).length, 0);
});

test('includes selected TeX files and retains nested image paths', () => {
  const draft = convertProject([
    { path: 'project/main.tex', text: String.raw`\title{Book}\begin{document}\input{chapter}\end{document}` },
    { path: 'project/chapter.tex', text: String.raw`\section{Images}\includegraphics{figures/plot.png}` },
    { path: 'project/figures/plot.png', bytes: new Uint8Array([1, 2, 3]) }
  ], 'project/main.tex');
  assert.equal(draft.blocks.length, 2);
  assert.match(draft.blocks[1].content, /!\[plot.png\]\(assets\/figures\/plot.png\)/);
  assert.equal(assetOutputPath('project/figures/plot.png', 'project/main.tex'), 'assets/figures/plot.png');
});

test('exports an importable workspace ZIP with settings, root blocks, and assets', async () => {
  const draft = convertProject([
    { path: 'project/main.tex', text: String.raw`\newcommand{\R}{\mathbb{R}}\title{Notes}\begin{document}\includegraphics{figures/plot.png}\end{document}` },
    { path: 'project/figures/plot.png', bytes: new Uint8Array([1, 2, 3]) }
  ], 'project/main.tex');
  const zip = await JSZip.loadAsync(await (await makeWorkspaceArchive(draft)).arrayBuffer());
  assert.ok(zip.file('setting/settings.json'));
  assert.equal(JSON.parse(await zip.file('setting/settings.json')!.async('string')).macros['\\R'], '\\mathbb{R}');
  assert.ok(zip.file('block-1--notes.md'));
  assert.deepEqual([...await zip.file('assets/figures/plot.png')!.async('uint8array')], [1, 2, 3]);
});

test('combined Markdown preserves reading order and round-trips into the export blocks', () => {
  const draft = convertProject([{ path: 'main.tex', text: String.raw`\title{Article}\begin{document}Before\begin{lemma}[A]\label{lem:a}Inside\end{lemma}After \ref{lem:a}.\end{document}` }], 'main.tex');
  const combined = serializeIntermediate(draft);
  assert.ok(combined.indexOf('Before') < combined.indexOf('Inside'));
  assert.ok(combined.indexOf('Inside') < combined.indexOf('After'));
  const edited = parseIntermediate(combined.replace('Inside', 'Edited inside'), draft);
  assert.equal(edited.blocks[1].content, 'Edited inside');
  assert.equal(edited.blocks[0].content, draft.blocks[0].content);
  assert.equal(validateDraft(edited).length, 0);
});

test('round-trips nested sections, statements, proof, macros, and references', () => {
  const tex = String.raw`\newcommand{\RR}{\mathbb{R}}\title{Long Notes}\begin{document}
\section{First}\label{sec:first}Before.
\subsection{Details}
\begin{definition}[Compactness]\label{def:compact}A set $K\subset\RR$ is compact.\end{definition}
\begin{theorem}[Bolzano]\label{thm:bolzano}See \ref{def:compact}.\end{theorem}
\begin{proof}The claim follows.\end{proof}
After \ref{thm:bolzano}.
\section{Second}More.\end{document}`;
  const draft = convertProject([{ path: 'main.tex', text: tex }], 'main.tex');
  assert.deepEqual(draft.blocks.map(block => block.kind), ['document', 'section', 'subsection', 'definition', 'theorem', 'proof', 'section']);
  assert.equal(draft.macros['\\RR'], '\\mathbb{R}');
  assert.equal(draft.blocks[5].parentId, draft.blocks[4].id);
  assert.match(draft.blocks[4].content, /\[\[long-notes\/sec-first\/details\/def-compact\]\]/);
  assert.equal(validateDraft(draft).length, 0);
  const parsed = parseIntermediate(serializeIntermediate(draft), draft);
  assert.deepEqual(parsed.blocks.map(block => block.content), draft.blocks.map(block => block.content));
});

test('flags TeX constructs that need manual review in a complex document', () => {
  const tex = String.raw`\title{Diagrams}\begin{document}\section*{Unnumbered}
\begin{remark}A diagram: \begin{tikzcd}A\arrow[r]&B\end{tikzcd}. \cite{key}\end{remark}
\begin{equation}\label{eq:one}x=1\end{equation}See \eqref{eq:one}.\end{document}`;
  const draft = convertProject([{ path: 'main.tex', text: tex }], 'main.tex');
  const messages = validateDraft(draft).map(issue => issue.message);
  assert.ok(messages.some(message => message.includes('Diagram needs')));
  assert.ok(messages.some(message => message.includes('Citation needs')));
  assert.ok(messages.some(message => message.includes('Unresolved reference: eq:one')));
});

test('parses edits to an exported block file without changing its ID', () => {
  const draft = convertProject([{ path: 'main.tex', text: String.raw`\title{Notes}\begin{document}Original.\end{document}` }], 'main.tex');
  const original = draft.blocks[0];
  const edited = blockMarkdown(original).replace('title: "Notes"', 'title: "New title"').replace('Original.', 'Revised $x^2$.');
  assert.deepEqual(parseBlockMarkdown(edited, original.id), { title: 'New title', label: original.label, content: 'Revised $x^2$.' });
  assert.throws(() => parseBlockMarkdown(edited.replace('id: block-1', 'id: block-9'), original.id), /file ID must remain/);
  assert.throws(() => parseBlockMarkdown(edited.replace('title: "New title"', 'title: New title'), original.id), /quoted JSON strings/);
  assert.throws(() => parseBlockMarkdown(edited.replace('id: block-1', 'id: block-1\nkind: theorem'), original.id), /Unsupported or repeated field/);
});

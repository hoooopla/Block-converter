export type BlockKind = 'document' | 'section' | 'subsection' | 'definition' | 'lemma' | 'proposition' | 'theorem' | 'corollary' | 'proof' | 'example' | 'remark' | 'exercise';

export interface SourceFile {
  path: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface DraftBlock {
  id: string;
  title: string;
  label: string;
  kind: BlockKind;
  content: string;
  parentId: string | null;
  sourceLabel?: string;
}

export interface Diagnostic {
  level: 'warning' | 'error';
  message: string;
  blockId?: string;
}

export interface ConversionDraft {
  title: string;
  rootId: string;
  blocks: DraftBlock[];
  macros: Record<string, string>;
  assets: SourceFile[];
  diagnostics: Diagnostic[];
  source: string;
  mainPath: string;
}

interface WorkingBlock extends DraftBlock {
  slug: string;
  parts: Array<string | { childId: string }>;
}

const statementKinds = new Set<BlockKind>(['definition', 'lemma', 'proposition', 'theorem', 'corollary', 'example', 'remark', 'exercise']);
const environmentKinds = new Set<BlockKind>([...statementKinds, 'proof']);
const headingLevels: Record<string, number> = { chapter: 1, section: 2, subsection: 3, subsubsection: 4 };

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\\[a-z]+/gi, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
}

function readGroup(source: string, start: number, open = '{', close = '}'): { value: string; end: number } | null {
  if (source[start] !== open) return null;
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === open && source[index - 1] !== '\\') depth++;
    else if (source[index] === close && source[index - 1] !== '\\') {
      depth--;
      if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function skipSpace(source: string, start: number): number {
  while (/\s/.test(source[start] || '')) start++;
  return start;
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export function assetOutputPath(path: string, mainPath: string): string {
  const normalized = normalizePath(path);
  const mainDirectory = normalizePath(mainPath).split('/').slice(0, -1).join('/');
  const relative = mainDirectory && normalized.startsWith(`${mainDirectory}/`)
    ? normalized.slice(mainDirectory.length + 1) : normalized;
  return `assets/${relative.replace(/^assets\//, '')}`;
}

function expandInputs(path: string, files: Map<string, SourceFile>, diagnostics: Diagnostic[], seen = new Set<string>()): string {
  const file = files.get(path);
  if (!file?.text) return '';
  if (seen.has(path)) {
    diagnostics.push({ level: 'warning', message: `Circular \\input skipped: ${path}` });
    return '';
  }
  seen.add(path);
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const result = file.text.replace(/\\(?:input|include)\s*\{([^}]+)\}/g, (_match, raw: string) => {
    const candidate = normalizePath(directory + (raw.endsWith('.tex') ? raw : `${raw}.tex`));
    const found = files.has(candidate) ? candidate : [...files.keys()].find(key => key.endsWith(`/${candidate}`));
    if (!found) {
      diagnostics.push({ level: 'warning', message: `Missing included TeX file: ${raw}` });
      return `% Missing input: ${raw}`;
    }
    return expandInputs(found, files, diagnostics, seen);
  });
  seen.delete(path);
  return result;
}

function extractMacros(source: string): { source: string; macros: Record<string, string> } {
  const macros: Record<string, string> = {};
  const ranges: Array<[number, number]> = [];
  const pattern = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)\*?/g;
  for (const match of source.matchAll(pattern)) {
    let position = skipSpace(source, match.index + match[0].length);
    const command = readGroup(source, position);
    if (!command) continue;
    const name = command.value.trim();
    if (!/^\\[A-Za-z]+$/.test(name)) continue;
    position = skipSpace(source, command.end);
    if (source[position] === '[') position = skipSpace(source, readGroup(source, position, '[', ']')?.end ?? position);
    const definition = readGroup(source, position);
    if (!definition) continue;
    macros[name] = match[1] === 'DeclareMathOperator' ? `\\operatorname{${definition.value}}` : definition.value;
    ranges.push([match.index, definition.end]);
  }
  for (const [start, end] of ranges.reverse()) source = source.slice(0, start) + source.slice(end);
  return { source, macros };
}

function fileStem(path: string): string {
  return path.split('/').at(-1)?.replace(/\.tex$/i, '').replace(/[-_]+/g, ' ') || 'Untitled document';
}

function buildBlocks(source: string, documentTitle: string): WorkingBlock[] {
  const root: WorkingBlock = { id: 'block-1', title: documentTitle, label: '', slug: slug(documentTitle), kind: 'document', content: '', parentId: null, parts: [] };
  const blocks = [root];
  const byId = new Map([[root.id, root]]);
  const headingByLevel = new Map<number, WorkingBlock>();
  let current = root;
  let currentHeading = root;
  let lastStatement: WorkingBlock | null = null;
  const environments: Array<{ kind: BlockKind; previous: WorkingBlock }> = [];
  const append = (value: string) => {
    if (!value) return;
    const last = current.parts.at(-1);
    if (typeof last === 'string') current.parts[current.parts.length - 1] = last + value;
    else current.parts.push(value);
    if (current === currentHeading && value.trim()) lastStatement = null;
  };
  const create = (kind: BlockKind, title: string, parent: WorkingBlock) => {
    const node: WorkingBlock = { id: `block-${blocks.length + 1}`, title, label: '', slug: slug(title), kind, content: '', parentId: parent.id, parts: [] };
    blocks.push(node);
    byId.set(node.id, node);
    parent.parts.push({ childId: node.id });
    return node;
  };

  for (let position = 0; position < source.length;) {
    if (source[position] === '%' && source[position - 1] !== '\\') {
      const end = source.indexOf('\n', position);
      position = end < 0 ? source.length : end;
      continue;
    }
    if (source[position] !== '\\') { append(source[position++]); continue; }
    const command = source.slice(position).match(/^\\([A-Za-z]+\*?)/);
    if (!command) { append(source[position++]); continue; }
    const name = command[1].replace(/\*$/, '');
    let afterName = skipSpace(source, position + command[0].length);
    if (name === 'begin' || name === 'end') {
      const group = readGroup(source, afterName);
      if (group) {
        const kind = group.value.replace(/\*$/, '') as BlockKind;
        if (environmentKinds.has(kind)) {
          if (name === 'begin') {
            const optional = source[group.end] === '[' ? readGroup(source, group.end, '[', ']') : null;
            const parent = kind === 'proof' && lastStatement ? lastStatement : current;
            const title = kind === 'proof' ? 'Proof' : `${kind[0].toUpperCase()}${kind.slice(1)}${optional?.value ? ` ${optional.value}` : ''}`;
            const node = create(kind, title, parent);
            environments.push({ kind, previous: current });
            current = node;
            position = optional?.end ?? group.end;
          } else {
            const frame = environments.at(-1);
            if (frame?.kind === kind) {
              environments.pop();
              const finished = current;
              current = frame.previous;
              if (statementKinds.has(kind)) lastStatement = finished;
            }
            position = group.end;
          }
          continue;
        }
        const mathEnd = name === 'begin' && ['equation', 'align', 'gather', 'multline', 'displaymath'].includes(kind)
          ? source.indexOf(`\\end{${group.value}}`, group.end) : -1;
        if (mathEnd >= 0) {
          append(source.slice(position, mathEnd + `\\end{${group.value}}`.length));
          position = mathEnd + `\\end{${group.value}}`.length;
          continue;
        }
      }
    }
    if (name in headingLevels) {
      const titleGroup = readGroup(source, afterName);
      if (titleGroup) {
        const level = headingLevels[name];
        const parent = [...headingByLevel.entries()].filter(([key]) => key < level).sort((a, b) => b[0] - a[0])[0]?.[1] || root;
        const kind: BlockKind = level <= 2 ? 'section' : 'subsection';
        const node = create(kind, titleGroup.value.trim(), parent);
        for (const key of headingByLevel.keys()) if (key >= level) headingByLevel.delete(key);
        headingByLevel.set(level, node);
        currentHeading = node;
        current = node;
        lastStatement = null;
        position = titleGroup.end;
        continue;
      }
    }
    if (name === 'label') {
      const group = readGroup(source, afterName);
      if (group) {
        current.sourceLabel = group.value.trim();
        current.slug = slug(group.value);
        position = group.end;
        continue;
      }
    }
    if (name === 'maketitle' || name === 'tableofcontents') { position += command[0].length; continue; }
    append(command[0]);
    position += command[0].length;
  }
  return blocks;
}

function assignLabels(blocks: WorkingBlock[], diagnostics: Diagnostic[]) {
  const byId = new Map(blocks.map(block => [block.id, block]));
  const used = new Set<string>();
  for (const block of blocks) {
    const parent = block.parentId ? byId.get(block.parentId) : null;
    const prefix = parent ? `${parent.label}/` : '';
    let label = `${prefix}${block.slug}`;
    let count = 2;
    while (used.has(label)) label = `${prefix}${block.slug}-${count++}`;
    if (count > 2) diagnostics.push({ level: 'warning', message: `Duplicate label adjusted to ${label}`, blockId: block.id });
    block.label = label;
    used.add(label);
  }
}

function convertMath(text: string): string {
  return text
    .replace(/\\\(([\s\S]*?)\\\)/g, (_all, math: string) => `$${math.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_all, math: string) => `\\[\n${math.trim()}\n\\]`)
    .replace(/\\begin\{(equation|displaymath|gather|multline)\*?\}([\s\S]*?)\\end\{\1\*?\}/g,
      (_all, _name: string, math: string) => `\\[\n${math.trim()}\n\\]`)
    .replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
      (_all, math: string) => `\\[\n\\begin{aligned}\n${math.trim()}\n\\end{aligned}\n\\]`);
}

function convertText(text: string, block: WorkingBlock, refs: Map<string, WorkingBlock>, assets: SourceFile[], mainPath: string, diagnostics: Diagnostic[]): string {
  let output = convertMath(text);
  output = output.replace(/\\(?:eqref|autoref|cref|Cref|ref)\s*\{([^}]+)\}/g, (match, key: string) => {
    const target = refs.get(key.trim());
    if (!target) {
      diagnostics.push({ level: 'warning', message: `Unresolved reference: ${key}`, blockId: block.id });
      return match;
    }
    return `[[${target.label}]]`;
  });
  output = output.replace(/\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, (match, raw: string) => {
    const requested = normalizePath(raw);
    const asset = assets.find(file => normalizePath(file.path).endsWith(requested) || normalizePath(file.path).endsWith(`${requested}.png`) || normalizePath(file.path).endsWith(`${requested}.pdf`));
    if (!asset) {
      diagnostics.push({ level: 'warning', message: `Missing image: ${raw}`, blockId: block.id });
      return match;
    }
    if (/\.pdf$/i.test(asset.path)) {
      diagnostics.push({ level: 'warning', message: `PDF figure needs conversion to PNG, SVG, or another web image: ${raw}`, blockId: block.id });
      return match;
    }
    const filename = asset.path.split('/').at(-1);
    return `![${filename}](${assetOutputPath(asset.path, mainPath)})`;
  });
  output = output.replace(/\\(emph|textit)\{([^{}]*)\}/g, '*$2*').replace(/\\textbf\{([^{}]*)\}/g, '**$1**');
  output = output.replace(/\\begin\{(?:enumerate|itemize)\}|\\end\{(?:enumerate|itemize)\}/g, '\n')
    .replace(/\\item(?:\[[^\]]*\])?/g, '\n- ')
    .replace(/\\(?:noindent|par)\b/g, '\n')
    .replace(/\\href\{([^}]+)\}\{([^}]+)\}/g, '[$2]($1)')
    .replace(/\\url\{([^}]+)\}/g, '<$1>');
  if (/\\begin\{(?:tikzpicture|tikzcd|xymatrix)\}/.test(output) || /\\xymatrix\b/.test(output)) {
    diagnostics.push({ level: 'warning', message: 'Diagram needs an image or manual conversion', blockId: block.id });
  }
  if (/\\cite[a-z]*\s*\{/.test(output)) diagnostics.push({ level: 'warning', message: 'Citation needs review', blockId: block.id });
  return output;
}

export function convertProject(files: SourceFile[], mainPath: string): ConversionDraft {
  const diagnostics: Diagnostic[] = [];
  const fileMap = new Map(files.map(file => [normalizePath(file.path), file]));
  const source = expandInputs(normalizePath(mainPath), fileMap, diagnostics);
  const titleMatch = source.match(/\\title\s*\{([^{}]*)\}/);
  const title = titleMatch?.[1].trim() || fileStem(mainPath);
  const withMacros = extractMacros(source);
  let body = withMacros.source;
  const documentStart = body.indexOf('\\begin{document}');
  if (documentStart >= 0) body = body.slice(documentStart + '\\begin{document}'.length);
  const documentEnd = body.lastIndexOf('\\end{document}');
  if (documentEnd >= 0) body = body.slice(0, documentEnd);
  body = body.replace(/\\title\s*\{[^{}]*\}/g, '').replace(/\\(?:author|date|documentclass|usepackage)(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '');
  const working = buildBlocks(body, title);
  assignLabels(working, diagnostics);
  const refs = new Map<string, WorkingBlock>();
  for (const block of working) {
    if (!block.sourceLabel) continue;
    if (refs.has(block.sourceLabel)) diagnostics.push({ level: 'error', message: `Duplicate TeX label: ${block.sourceLabel}`, blockId: block.id });
    else refs.set(block.sourceLabel, block);
  }
  const assets = files.filter(file => !!file.bytes);
  const blocks = working.map(block => {
    const content = block.parts.map(part => typeof part === 'string'
      ? convertText(part, block, refs, assets, mainPath, diagnostics)
      : `\n\n[[${working.find(candidate => candidate.id === part.childId)?.label}∨]]\n\n`)
      .join('').replace(/\n{3,}/g, '\n\n').trim();
    const { parts: _parts, slug: _slug, ...result } = block;
    return { ...result, content };
  });
  return { title, rootId: blocks[0].id, blocks, macros: withMacros.macros, assets, diagnostics, source, mainPath };
}

export function renameLabel(draft: ConversionDraft, id: string, value: string): ConversionDraft {
  const target = draft.blocks.find(block => block.id === id);
  if (!target || !value.trim() || value.includes('[[') || value.includes(']]')) return draft;
  const before = target.label;
  const after = value.trim();
  if (before === after || draft.blocks.some(block => block.id !== id && block.label === after)) return draft;
  const replacements = new Map<string, string>();
  for (const block of draft.blocks) {
    if (block.label === before || block.label.startsWith(`${before}/`)) replacements.set(block.label, after + block.label.slice(before.length));
  }
  if (draft.blocks.some(block => !replacements.has(block.label) && [...replacements.values()].includes(block.label))) return draft;
  return {
    ...draft,
    blocks: draft.blocks.map(block => ({
      ...block,
      label: replacements.get(block.label) || block.label,
      content: block.content.replace(/\[\[([^\]\n]+)\]\]/g, (match, inner: string) => {
        const open = inner.endsWith('∨');
        const original = open ? inner.slice(0, -1) : inner;
        const next = replacements.get(original);
        return next ? `[[${next}${open ? '∨' : ''}]]` : match;
      })
    }))
  };
}

export function blockMarkdown(block: DraftBlock): string {
  return `---\nid: ${block.id}\ntitle: ${JSON.stringify(block.title)}\nlabel: ${JSON.stringify(block.label)}\n---\n${block.content}\n`;
}

export function validateDraft(draft: ConversionDraft): Diagnostic[] {
  const diagnostics = [...draft.diagnostics];
  const labels = new Set<string>();
  for (const block of draft.blocks) {
    if (!block.label || block.label.startsWith('/') || block.label.startsWith('@')) diagnostics.push({ level: 'error', message: 'Invalid block label', blockId: block.id });
    if (labels.has(block.label)) diagnostics.push({ level: 'error', message: `Duplicate block label: ${block.label}`, blockId: block.id });
    labels.add(block.label);
  }
  for (const block of draft.blocks) {
    for (const match of block.content.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const label = match[1].replace(/∨$/, '');
      if (!labels.has(label)) diagnostics.push({ level: 'error', message: `Broken block link: ${label}`, blockId: block.id });
    }
  }
  return diagnostics;
}

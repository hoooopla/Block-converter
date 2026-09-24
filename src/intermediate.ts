import { type ConversionDraft, type DraftBlock } from './converter';

const start = '<!-- block:start ';
const end = '<!-- block:end -->';
const settings = '<!-- settings ';
const openLink = /\[\[([^\]\n]+)∨\]\]/g;

/** A review format: raw Markdown stays in place; comments carry export metadata. */
export function serializeIntermediate(draft: ConversionDraft): string {
  const children = new Map<string, DraftBlock[]>();
  for (const block of draft.blocks) {
    if (block.parentId) children.set(block.parentId, [...(children.get(block.parentId) || []), block]);
  }
  const visited = new Set<string>();
  const write = (block: DraftBlock): string => {
    if (visited.has(block.id)) return '';
    visited.add(block.id);
    const header = `${start}${JSON.stringify({ id: block.id, kind: block.kind, title: block.title, label: block.label, parentId: block.parentId })} -->\n`;
    let body = '';
    let last = 0;
    for (const match of block.content.matchAll(openLink)) {
      body += block.content.slice(last, match.index) + match[0];
      const child = children.get(block.id)?.find(candidate => candidate.label === match[1]);
      if (child) body += `\n\n${write(child)}\n`;
      last = match.index + match[0].length;
    }
    body += block.content.slice(last);
    for (const child of children.get(block.id) || []) {
      if (!visited.has(child.id)) body += `\n\n${write(child)}\n`;
    }
    return `${header}${body.trim()}\n${end}`;
  };
  const root = draft.blocks.find(block => block.id === draft.rootId) || draft.blocks[0];
  return `${settings}${JSON.stringify({ macros: draft.macros })} -->\n\n${write(root)}\n`;
}

export function parseIntermediate(text: string, previous: ConversionDraft): ConversionDraft {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex(line => line.trim());
  if (first < 0 || !lines[first].startsWith(settings) || !lines[first].endsWith(' -->')) throw new Error('The first line must contain settings.');
  let macros: Record<string, string>;
  try {
    const parsed = JSON.parse(lines[first].slice(settings.length, -4));
    if (!parsed || typeof parsed.macros !== 'object' || Array.isArray(parsed.macros)) throw new Error();
    macros = parsed.macros;
  } catch { throw new Error('Settings must contain a valid macros object.'); }
  const blocks: DraftBlock[] = [];
  const stack: Array<{ index: number; body: string[] }> = [];
  for (const line of lines.slice(first + 1)) {
    if (line.startsWith(start) && line.endsWith(' -->')) {
      let data: DraftBlock;
      try { data = JSON.parse(line.slice(start.length, -4)); }
      catch { throw new Error('A block header contains invalid JSON.'); }
      if (!data.id || !data.title || !data.label || !data.kind || (data.parentId ?? null) !== (stack.length ? blocks[stack.at(-1)!.index].id : null)) {
        throw new Error(`Invalid block header or parent for ${data.label || 'a block'}.`);
      }
      if (blocks.some(block => block.id === data.id)) throw new Error(`Duplicate block ID: ${data.id}.`);
      blocks.push(data);
      stack.push({ index: blocks.length - 1, body: [] });
    } else if (line === end) {
      const current = stack.pop();
      if (!current) throw new Error('An extra block end marker was found.');
      blocks[current.index] = { ...blocks[current.index], content: current.body.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
    } else if (stack.length) {
      stack.at(-1)!.body.push(line);
    } else if (line.trim()) {
      throw new Error('Text outside a block must be moved inside a block.');
    }
  }
  if (stack.length) throw new Error('A block is missing its end marker.');
  if (!blocks.length || blocks.filter(block => !block.parentId).length !== 1) throw new Error('The document must have one root block.');
  return { ...previous, title: blocks.find(block => !block.parentId)!.title, rootId: blocks.find(block => !block.parentId)!.id, blocks, macros };
}

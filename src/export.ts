import JSZip from 'jszip';
import { assetOutputPath, blockMarkdown, type ConversionDraft } from './converter';

export async function makeWorkspaceArchive(draft: ConversionDraft): Promise<Blob> {
  const zip = new JSZip();
  zip.file('setting/settings.json', JSON.stringify({ macros: draft.macros, customCommands: Object.keys(draft.macros), textCommands: [] }, null, 2));
  for (const block of draft.blocks) {
    const filename = `${block.id}--${block.label.replace(/[^a-zA-Z0-9-]+/g, '-')}.md`;
    zip.file(filename, blockMarkdown(block));
  }
  for (const asset of draft.assets) {
    if (asset.bytes) zip.file(assetOutputPath(asset.path, draft.mainPath), asset.bytes);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function downloadWorkspace(draft: ConversionDraft): Promise<void> {
  const blob = await makeWorkspaceArchive(draft);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${draft.blocks[0].label.replace(/[^a-zA-Z0-9-]+/g, '-') || 'math-notes'}-workspace.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

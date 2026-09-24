import type { SourceFile } from './converter';

let compiler: import('@typeward/texlive-wasm').EngineHandle | null = null;

export async function compilePdf(files: SourceFile[], mainPath: string): Promise<{ pdf: Blob | null; log: string }> {
  const { createEngine, latexmk } = await import('@typeward/texlive-wasm');
  const base = `${import.meta.env.BASE_URL}texlive-wasm/`;
  compiler ||= await createEngine('pdflatex', {
    enginePath: `${base}pdflatex/emscripten/pdflatex.wasm`,
    bundleUrl: `${base}texmf-core-pdflatex.bundle`,
  });
  const prefix = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
  const inputs = files.map(file => ({
    path: prefix && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path,
    content: file.text ?? file.bytes ?? '',
  }));
  try {
    const result = await latexmk({
      engine: 'pdflatex',
      mainTex: prefix ? mainPath.slice(prefix.length) : mainPath,
      files: inputs,
      handles: { tex: compiler },
      bibtex: false,
      biber: false,
      makeindex: false,
      timeoutMs: 90_000,
    });
    return { pdf: result.pdf ? new Blob([new Uint8Array(result.pdf)], { type: 'application/pdf' }) : null, log: result.log };
  } catch (error) {
    await compiler.dispose();
    compiler = null;
    return { pdf: null, log: error instanceof Error ? error.message : String(error) };
  }
}

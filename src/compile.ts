import type { SourceFile } from './converter';

let compiler: import('@typeward/texlive-wasm').PdfLatex | null = null;

export async function compilePdf(files: SourceFile[], mainPath: string): Promise<{ pdf: Blob | null; log: string }> {
  const { PdfLatex } = await import('@typeward/texlive-wasm');
  const base = `${import.meta.env.BASE_URL}texlive-wasm/`;
  compiler ||= new PdfLatex({
    enginePath: `${base}pdflatex/emscripten/pdflatex.wasm`,
    bundleUrl: `${base}texmf-core-pdflatex.bundle`,
  });
  const prefix = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
  const inputs = files.map(file => ({
    path: prefix && file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path,
    content: file.text ?? file.bytes ?? '',
  }));
  try {
    const result = await compiler.compile({
      mainTex: prefix ? mainPath.slice(prefix.length) : mainPath,
      files: inputs,
      timeoutMs: 90_000,
    });
    const pdf = [...result.outputs.entries()].find(([path]) => path.endsWith('.pdf'))?.[1];
    return { pdf: pdf ? new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) : null, log: result.log || result.stderr || result.stdout };
  } catch (error) {
    await compiler.dispose();
    compiler = null;
    return { pdf: null, log: error instanceof Error ? error.message : String(error) };
  }
}

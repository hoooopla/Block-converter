# Block Converter

A minimal, TeX-first browser workspace for reviewing a Math Note Editor conversion before exporting it. The public site is at https://hoooopla.github.io/Block-converter/.

## Five stages

1. Upload a TeX project or paste and edit a complete TeX document. Choose its main file.
2. Compile the original document with pdfLaTeX running locally in WebAssembly, then compare its PDF with the source. Compilation is manual; an error log is available when TeX cannot produce a PDF.
3. Review and edit one combined Markdown document. A settings comment comes first, followed by block comments and raw Markdown in reading order. This is an intermediate review format, not an exported file.
4. Inspect or edit each block's title, label, and Markdown content. Preview the exact `.md` frontmatter and `setting/settings.json` that go into the ZIP.
5. Read a continuous preview of the article with math and open child links, then export the workspace ZIP.

Source edits regenerate the conversion after a short pause. Valid edits to combined Markdown update the block files and final preview. Block edits update the combined document and final preview. Compilation is independent: unsupported TeX packages do not prevent Markdown review and export. Source regeneration currently replaces manual Markdown corrections, so finish source edits before making detailed block corrections.

## Run locally

```bash
npm ci
npm run build
npm run preview
```

Use the production preview for local PDF compilation. `npm test` checks conversion, the combined-document round trip, and workspace ZIP contents. `npm run dev` is useful for editing the UI, but Vite's development import handling does not support the TeX engine's dynamic runtime import; the production build and GitHub Pages deployment do.

## Processing and limits

Selected files and TeX compilation run in the browser. The pdfLaTeX WebAssembly runtime and its core TeX files are served from this site's static assets; the source document is not uploaded to a conversion service. First compilation downloads roughly 28 MB of runtime files. The runtime is from [typeward/texlive-wasm](https://github.com/typeward/texlive-wasm); its included license and notice files are in `public/texlive-wasm/`.

The converter handles `\input`/`\include`, title, section headings, common theorem-style environments, proofs, `\label`/`\ref`, inline and display math, basic lists and formatting, macros, and web images. Complex custom commands, citations, diagrams, and PDF figures need manual review. The final preview models Math Note Editor's block links and KaTeX rendering; it is not the editor application itself.

The ZIP contains root-level block `.md` files, `setting/settings.json`, and selected assets under `assets/`. GitHub Pages builds the site from `main` through `.github/workflows/deploy.yml`.

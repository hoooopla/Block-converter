# Block Converter

A browser-first companion for turning TeX manuscripts into Math Note Editor workspaces. The review screen renders the proposed Markdown blocks continuously, with source TeX beside them. The export is a ZIP containing root-level block `.md` files, `setting/settings.json`, and selected image assets under `assets/`.

## Run locally

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. `npm test` checks conversion and ZIP structure; `npm run build` checks types and produces the static site.

## TeX-first scope

- Select one or more `.tex` files and images, or select a project folder. Choose the main TeX file in the sidebar.
- Supports `\input`, `\include`, document title, section headings, definition/theorem-style environments, proofs, `\label`, `\ref`, common inline/display math, basic lists, emphasis, links, and `\includegraphics` for web images.
- Exports `\newcommand`, `\renewcommand`, `\providecommand`, and `\DeclareMathOperator` definitions as KaTeX macros in settings.
- The preview is assembled from the proposed block Markdown. Edits to a title, label, or Markdown body update the preview. Label edits update descendant labels and generated links.
- Files are processed locally in the browser. The site does not upload the selected project to a server. ZIP export uses a browser download.

TeX is a large language. This first version does not execute TeX or compile a PDF. It flags missing inputs, unresolved references, citations, and diagrams for review. PDF figures need conversion to a web image before they can appear in the preview. Complex custom commands and math should be checked against the source before import.

The site is deployed by `.github/workflows/deploy.yml` to GitHub Pages from `main`. Its Vite base path is `/Block-converter/`.

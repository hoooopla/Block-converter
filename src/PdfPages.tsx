import { useEffect, useRef, useState } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export default function PdfPages({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [fitWidth, setFitWidth] = useState(0);
  const [message, setMessage] = useState('Rendering PDF…');

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new ResizeObserver(() => setFitWidth(target.clientWidth));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const target = container.current;
    if (!target) return;
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const task = pdfjs.getDocument({ url });
        const pdf = await task.promise;
        const nextPages = document.createDocumentFragment();
        for (let index = 1; index <= pdf.numPages && !cancelled; index++) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1 });
          const width = Math.min((fitWidth || target!.clientWidth) - 36 || 600, 760);
          const scaled = page.getViewport({ scale: (width / viewport.width) * zoom / 100 });
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(scaled.width * pixelRatio);
          canvas.height = Math.ceil(scaled.height * pixelRatio);
          canvas.style.width = `${scaled.width}px`;
          canvas.style.height = `${scaled.height}px`;
          canvas.setAttribute('aria-label', `PDF page ${index}`);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas rendering is unavailable.');
          await page.render({ canvas, canvasContext: context, viewport: scaled, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
          nextPages.appendChild(canvas);
        }
        if (!cancelled) {
          target!.replaceChildren(nextPages);
          setMessage('');
        }
      } catch (error) {
        if (!cancelled) setMessage(`PDF preview could not render: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [url, zoom, fitWidth]);

  return <div className="pdf-view"><div className="pdf-zoom" role="group" aria-label="PDF zoom"><button aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))}>−</button><span>{zoom}%</span><button aria-label="Zoom in" disabled={zoom >= 250} onClick={() => setZoom(value => Math.min(250, value + 25))}>+</button><button onClick={() => setZoom(100)}>Fit width</button></div><div className="pdf-pages" ref={container} />{message && <p>{message}</p>}</div>;
}

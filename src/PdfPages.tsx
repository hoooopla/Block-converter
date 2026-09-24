import { useEffect, useRef, useState } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export default function PdfPages({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Rendering PDF…');

  useEffect(() => {
    let cancelled = false;
    const target = container.current;
    if (!target) return;
    target.replaceChildren();
    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const task = pdfjs.getDocument({ url });
        const pdf = await task.promise;
        for (let index = 1; index <= pdf.numPages && !cancelled; index++) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1 });
          const width = Math.min(target!.clientWidth - 36 || 600, 760);
          const scaled = page.getViewport({ scale: width / viewport.width });
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(scaled.width * pixelRatio);
          canvas.height = Math.ceil(scaled.height * pixelRatio);
          canvas.style.width = `${scaled.width}px`;
          canvas.style.height = `${scaled.height}px`;
          canvas.setAttribute('aria-label', `PDF page ${index}`);
          if (!cancelled) target!.appendChild(canvas);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas rendering is unavailable.');
          await page.render({ canvas, canvasContext: context, viewport: scaled, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
        }
        if (!cancelled) setMessage('');
      } catch (error) {
        if (!cancelled) setMessage(`PDF preview could not render: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    void render();
    return () => { cancelled = true; target.replaceChildren(); };
  }, [url]);

  return <div className="pdf-view"><div className="pdf-pages" ref={container} />{message && <p>{message}</p>}</div>;
}

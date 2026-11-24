"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

type PdfDoc = { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: object) => { promise: Promise<void> } }> };

/**
 * A PDF shown page by page with pdf.js. Each page keeps its real proportions from the start, so whatever is laid over
 * it (fields, in percent of the page) is in place before the page has drawn. Pages draw as they scroll into view.
 */
export function PdfPages({ url, pages, overlay, onPageClick, loadingLabel }: {
  url: string; pages: { w: number; h: number }[]; loadingLabel: string;
  overlay?: (page: number) => ReactNode;
  /** A click on an empty spot of a page, in fractions of the page from its top left. */
  onPageClick?: (page: number, x: number, y: number) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (!gone) setDoc(d as unknown as PdfDoc);
      } catch (e) { if (!gone) setError(String((e as Error)?.message ?? e)); }
    })();
    return () => { gone = true; };
  }, [url]);
  return (
    <div className="pdf-pages">
      {error ? <div className="note bad small">{error}</div> : null}
      {pages.map((p, i) => (
        <Page key={i} n={i + 1} size={p} doc={doc} loadingLabel={loadingLabel} onClick={onPageClick}>{overlay?.(i + 1)}</Page>
      ))}
    </div>
  );
}

function Page({ n, size, doc, children, onClick, loadingLabel }: { n: number; size: { w: number; h: number }; doc: PdfDoc | null; children?: ReactNode; onClick?: (page: number, x: number, y: number) => void; loadingLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const task = useRef<{ cancel?: () => void } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!doc || !seen || !canvas.current || !box.current) return;
    let gone = false;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const width = box.current!.clientWidth || 800;
      const scale = (width / base.width) * Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const c = canvas.current!;
      c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
      // One drawing at a time on a canvas: a newer one cancels the one still running.
      task.current?.cancel?.();
      const run = page.render({ canvasContext: c.getContext("2d"), canvas: c, viewport }) as { promise: Promise<void>; cancel?: () => void };
      task.current = run;
      await run.promise;
    })().catch(() => undefined).finally(() => { if (!gone) setDrawn(true); });
    return () => { gone = true; };
  }, [doc, seen, n]);
  return (
    <div className="pdf-page-wrap">
      <div className="small muted pdf-page-no">{n}</div>
      <div
        ref={box} className="pdf-page" style={{ aspectRatio: `${size.w} / ${size.h}` }}
        onClick={(e) => {
          if (!onClick || e.target !== e.currentTarget.querySelector(".pdf-hit")) return;
          const r = e.currentTarget.getBoundingClientRect();
          onClick(n, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
      >
        <canvas ref={canvas} />
        {drawn ? null : <div className="pdf-loading small muted">{loadingLabel}</div>}
        <div className="pdf-hit" />
        {children}
      </div>
    </div>
  );
}

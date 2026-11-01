import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

export function ArtifactPdfPreview({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let active = true;
    const task = getDocument({ data: bytes.slice(), disableAutoFetch: true, enableXfa: false, useWorkerFetch: false, useSystemFonts: true });
    task.promise.then(document => { if (active) { setPdf(document); setPage(1); } }).catch(() => { if (active) setError("This PDF could not be opened. It may be encrypted or unsupported. Use Download from the artifact menu."); });
    return () => { active = false; void task.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true; let cancel: (() => void) | undefined;
    setRendering(true); setError("");
    pdf.getPage(page).then(documentPage => {
      if (!active || !canvas.current) return;
      const base = documentPage.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 1400 / base.width, Math.sqrt(4_000_000 / (base.width * base.height)));
      const viewport = documentPage.getViewport({ scale });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      const task = documentPage.render({ canvas: canvas.current, viewport }); cancel = () => task.cancel();
      return task.promise;
    }).then(() => { if (active) setRendering(false); }).catch(() => { if (active) { setError("Could not render this PDF page."); setRendering(false); } });
    return () => { active = false; cancel?.(); };
  }, [pdf, page]);
  return <div className="artifact-pdf-view">
    {pdf && <div className="artifact-pdf-controls"><button type="button" className="subtle-button" disabled={page <= 1 || rendering} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {pdf.numPages}</span><button type="button" className="subtle-button" disabled={page >= pdf.numPages || rendering} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    {error ? <p role="alert">{error}</p> : <>{rendering && <p role="status">Rendering PDF…</p>}<canvas ref={canvas} aria-label={`PDF page ${page}`} /></>}
  </div>;
}

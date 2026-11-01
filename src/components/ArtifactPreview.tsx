import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAction, useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RequestArtifact } from "../types";
import { artifactDownloadUrl } from "../artifactDownloads";
import { artifactPreviewKind, PDF_PREVIEW_LIMIT, previewText, readPreviewBytes } from "../artifactPreview";
import "../artifact-preview.css";
const PdfPreview = lazy(() => import("./ArtifactPdfPreview").then(m => ({ default: m.ArtifactPdfPreview })));

export function ArtifactPreview({ requestId, artifact, onClose }: { requestId: string; artifact: RequestArtifact; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const downloadUrl = useAction(api.artifactTransfers.downloadUrl);
  const client = useConvex();
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const kind = artifactPreviewKind(artifact.name, artifact.contentType);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setUrl(""); setText(""); setPdf(null); setTruncated(false);
    async function load() {
      if (kind === "unsupported") { setLoading(false); return; }
      if (kind === "pdf" && artifact.size > PDF_PREVIEW_LIMIT) throw new Error("PDF preview supports files up to 16 MiB. Use Download from the artifact menu for this file.");
      const result = await downloadUrl({ requestId: requestId as Id<"requests">, artifactId: artifact.id });
      if (controller.signal.aborted) return;
      const link = artifactDownloadUrl(result, client.url);
      if (kind === "text" || kind === "pdf") {
        const content = await readPreviewBytes(link, kind, controller.signal);
        if (controller.signal.aborted) return;
        if (kind === "pdf") {
          if (content.truncated) throw new Error("PDF is too large to preview. Use Download from the artifact menu.");
          setPdf(content.bytes);
        } else { setText(previewText(content.bytes, artifact.name, artifact.contentType, content.truncated)); setTruncated(content.truncated); }
      } else setUrl(link);
      setLoading(false);
    }
    void load().catch(cause => { if (!controller.signal.aborted) { setLoading(false); setError(typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "Could not load preview. Try refreshing it."); } });
    return () => controller.abort();
  }, [requestId, artifact.id, artifact.name, artifact.contentType, artifact.size, kind, version, downloadUrl, client]);
  function mediaError() { setError("This file could not be displayed. Refresh the preview, or use Download from the artifact menu. Your webview may not support its format."); }
  return <dialog ref={dialog} className="artifact-preview-dialog" aria-labelledby="artifact-preview-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header className="artifact-preview-heading"><div><h2 id="artifact-preview-title">{artifact.label ?? artifact.name}</h2><p>{artifact.name} · {artifact.contentType} · {(artifact.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB</p></div><div className="artifact-preview-actions">{kind !== "unsupported" && <button type="button" className="subtle-button" disabled={loading} onClick={() => setVersion(v => v + 1)}>Refresh preview</button>}<button type="button" autoFocus className="settings-action" onClick={onClose}>Close</button></div></header>
    <div className="artifact-preview-content" aria-busy={loading}>
      {loading && <p role="status">Loading preview…</p>}
      {error && <p className="artifact-preview-error" role="alert">{error}</p>}
      {!loading && (!error || url) && <>
        {kind === "unsupported" && <div className="artifact-preview-empty"><b>Preview is not available for this file type.</b><p>Close this view and choose Download from the artifact’s ••• menu.</p></div>}
        {kind === "text" && <>{truncated && <p className="artifact-preview-notice">Showing the first 1 MiB. Download the file to read its full contents.</p>}<pre className="artifact-preview-text">{text || "(Empty file)"}</pre></>}
        {kind === "image" && url && <img className="artifact-preview-image" src={url} alt={artifact.label ?? artifact.name} onError={mediaError} />}
        {kind === "audio" && url && <div className="artifact-preview-audio"><span aria-hidden="true">♫</span><audio controls preload="metadata" src={url} onError={mediaError} /></div>}
        {kind === "video" && url && <video className="artifact-preview-video" controls preload="metadata" src={url} onError={mediaError} />}
        {kind === "pdf" && pdf && <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfPreview bytes={pdf} /></Suspense>}
      </>}
    </div>
  </dialog>;
}

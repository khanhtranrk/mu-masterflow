import { Input } from "./ui/Input";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DisplayModeSwitch, useDisplayMode } from "../requestPresentation";
import type { RequestItem } from "../types";

type RequestArtifactsProps = {
  request: RequestItem;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  highlightedNode?: string;
  highlightedIds: string[];
  focusVersion: number;
  onClearHighlight: () => void;
};

export function RequestArtifacts({ request, open, onToggle, panelId, highlightedNode, highlightedIds, focusVersion, onClearHighlight }: RequestArtifactsProps) {
  const [mode, setMode] = useDisplayMode("mu-masterflow:artifacts-layout", "grid");
  const urls = useQuery(api.requestArtifacts.urls, open ? { requestId: request.convexId as Id<"requests"> } : "skip");
  const start = useMutation(api.requestArtifacts.startUpload);
  const complete = useMutation(api.requestArtifacts.completeUpload);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !highlightedNode) return;
    const first = body.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    first?.focus({ preventScroll: true });
    (first ?? body.current)?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [open, highlightedNode, focusVersion]);

  async function upload(file: File) {
    if (!open) onToggle();
    setBusy(true);
    setError("");
    try {
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      const requestId = request.convexId as Id<"requests">;
      const { uploadId, uploadUrl } = await start({ requestId, artifactId: crypto.randomUUID(), sha256, size: file.size });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error(`Upload failed (${response.status}). Try again.`);
      const { storageId } = await response.json();
      await complete({ requestId, uploadId, storageId, name: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return <section className="request-files" aria-label="Request artifacts">
    <div className="request-files-heading">
      <button type="button" className="request-files-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span aria-hidden="true">{open ? "⌄" : "›"}</span><b>Artifacts</b><span className="request-files-count">{request.artifacts?.length ?? 0}</span>
      </button>
      <div className="request-files-heading-actions">
        <DisplayModeSwitch mode={mode} onChange={setMode} label="Artifact layout" />
        <button className="subtle-button" disabled={busy || (request.artifacts?.length ?? 0) >= 100} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Upload file"}</button>
      </div>
      <Input ref={input} type="file" hidden disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    {error && <p role="alert">{error}</p>}
    <div id={panelId} hidden={!open} className="request-files-body" ref={body}>
    {highlightedNode && <div className="request-files-focus"><span role="status">{highlightedIds.length} {highlightedIds.length === 1 ? "artifact" : "artifacts"} highlighted · <b>{highlightedNode}</b></span><button className="subtle-button" onClick={onClearHighlight}>Clear highlight</button></div>}
    <div className={`artifact-items artifact-layout-${mode}`}>
    {!request.artifacts?.length && <small>No files attached to this request.</small>}
    {request.artifacts?.map(artifact => {
      const url = urls?.find(item => item.id === artifact.id)?.url;
      const highlighted = highlightedIds.includes(artifact.id);
      return <div className={`request-artifact request-file ${highlighted ? "highlighted" : ""}`} key={artifact.id}
        data-highlighted={highlighted} tabIndex={-1} aria-label={`${artifact.label ?? artifact.name}${highlighted ? `, highlighted from ${highlightedNode}` : ""}`}>
        <div><b>{artifact.label ?? artifact.name}</b><small>{artifact.name} · {(artifact.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB{artifact.nodeName ? ` · ${artifact.nodeName}` : ""}</small></div>
        {url ? <a href={url} download={artifact.name} target="_blank" rel="noopener noreferrer" onClick={event => {
          if (isTauri()) {
            event.preventDefault();
            void openUrl(url).catch(cause => setError(cause instanceof Error ? cause.message : "Could not open download."));
          }
        }}>Download</a> : <small>{urls === undefined ? "Loading…" : "File unavailable"}</small>}
      </div>;
    })}
    </div>
    </div>
  </section>;
}

import { Input } from "./ui/Input";
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAction, useMutation, useQuery } from "convex/react";
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
  const records = useQuery(api.artifactStore.list, open ? { requestId: request.convexId as Id<"requests"> } : "skip");
  const storage = useQuery(api.storage.list, {});
  const [connectionId, setConnectionId] = useState("");
  const start = useAction(api.artifactTransfers.startUpload);
  const complete = useAction(api.artifactTransfers.completeUpload);
  const download = useAction(api.artifactTransfers.downloadUrl);
  const remove = useMutation(api.artifactStore.remove);
  const artifacts = records ?? request.artifacts ?? [];
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
      const { uploadId, uploadUrl, method, headers } = await start({ requestId, artifactId: crypto.randomUUID(), sha256, size: file.size, contentType: file.type || "application/octet-stream", ...(connectionId ? { connectionId } : {}) });
      const response = await fetch(uploadUrl, { method, headers, body: file });
      if (!response.ok) throw new Error(`Upload failed (${response.status}). Try again.`);
      await complete({ requestId, uploadId, name: file.name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function downloadFile(artifactId: string) {
    const popup = isTauri() ? null : window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const result = await download({ requestId: request.convexId as Id<"requests">, artifactId });
      if (isTauri()) await openUrl(result.url);
      else if (popup) popup.location.href = result.url;
      else throw new Error("Allow a new window to download the file.");
    } catch (cause) { popup?.close(); setError(cause instanceof Error ? cause.message : "Download failed"); }
  }

  return <section className="request-files" aria-label="Request artifacts">
    <div className="request-files-heading">
      <button type="button" className="request-files-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span aria-hidden="true">{open ? "⌄" : "›"}</span><b>Artifacts</b><span className="request-files-count">{request.artifacts?.length ?? 0}</span>
      </button>
      <div className="request-files-heading-actions">
        <select aria-label="Upload storage" value={connectionId} onChange={event => setConnectionId(event.target.value)}>
          <option value="">Default storage</option>{storage?.connections.filter(c => c.enabled).map(c => <option key={c.connectionId} value={c.connectionId}>{c.name} ({c.connectionId})</option>)}
        </select>
        <DisplayModeSwitch mode={mode} onChange={setMode} label="Artifact layout" />
        <button className="subtle-button" disabled={busy || artifacts.length >= 100} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Upload file"}</button>
      </div>
      <Input ref={input} type="file" hidden disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    {error && <p role="alert">{error}</p>}
    <div id={panelId} hidden={!open} className="request-files-body" ref={body}>
    {highlightedNode && <div className="request-files-focus"><span role="status">{highlightedIds.length} {highlightedIds.length === 1 ? "artifact" : "artifacts"} highlighted · <b>{highlightedNode}</b></span><button className="subtle-button" onClick={onClearHighlight}>Clear highlight</button></div>}
    <div className={`artifact-items artifact-layout-${mode}`}>
    {!artifacts.length && <small>No files attached to this request.</small>}
    {artifacts.map(artifact => {
      const highlighted = highlightedIds.includes(artifact.id);
      return <div className={`request-artifact request-file ${highlighted ? "highlighted" : ""}`} key={artifact.id}
        data-highlighted={highlighted} tabIndex={-1} aria-label={`${artifact.label ?? artifact.name}${highlighted ? `, highlighted from ${highlightedNode}` : ""}`}>
        <div><b>{artifact.label ?? artifact.name}</b><small>{artifact.name} · {(artifact.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB{artifact.nodeName ? ` · ${artifact.nodeName}` : ""}</small></div>
        <button onClick={() => void downloadFile(artifact.id)}>Download</button>
        {storage?.isOwner && <button onClick={() => { if (window.confirm("Remove this artifact record? The stored file will be retained.")) void remove({ requestId: request.convexId as Id<"requests">, artifactId: artifact.id }).catch(cause => setError(String(cause))); }}>Remove record</button>}

      </div>;
    })}
    </div>
    </div>
  </section>;
}

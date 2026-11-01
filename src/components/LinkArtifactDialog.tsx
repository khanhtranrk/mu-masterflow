import { useEffect, useRef, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RequestArtifact } from "../types";
import { Input } from "./ui/Input";
import { ArtifactPreview } from "./ArtifactPreview";
import "../artifact-preview.css";
import "../artifact-links.css";

type Source = { requestId: Id<"requests">; specSlug: string; pipelineName: string; artifact: RequestArtifact };
export function LinkArtifactDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Source | null>(null);
  const [artifactId, setArtifactId] = useState<string>(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(api.artifactLinks.browse, { search: query }, { initialNumItems: 20 });
  const link = useMutation(api.artifactLinks.link);
  useEffect(() => { const node = dialog.current!; node.showModal(); searchInput.current?.focus(); return () => node.close(); }, []);
  useEffect(() => { const timeout = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timeout); }, [search]);
  return <dialog ref={dialog} className="artifact-preview-dialog artifact-link-dialog" aria-labelledby="artifact-link-title" onCancel={event => { event.stopPropagation(); if (!busy) onClose(); else event.preventDefault(); }}>
    <header className="artifact-preview-heading"><div><h2 id="artifact-link-title">Link existing artifact</h2><p>Create a separate artifact using the same stored file. No upload or copy.</p></div><button type="button" className="settings-action" disabled={busy} onClick={onClose}>Close</button></header>
    <form className="artifact-link-form" onSubmit={event => { event.preventDefault(); if (!selected || busy) return; setBusy(true); setError(""); void link({ requestId: requestId as Id<"requests">, sourceRequestId: selected.requestId, sourceArtifactId: selected.artifact.id, expectedSourceCreatedAt: selected.artifact.createdAt, artifactId: artifactId.trim(), name: name.trim(), ...(label.trim() ? { label: label.trim() } : {}), ...(nodeName.trim() ? { nodeName: nodeName.trim() } : {}) }).then(onClose).catch(cause => { setError(cause instanceof Error ? cause.message : "Could not link artifact."); setBusy(false); }); }}>
      <label className="artifact-link-search">Find a source<Input ref={searchInput} maxLength={256} type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="Search file name or exact Request ID" /></label>
      <div className="artifact-link-sources" aria-label="Available source artifacts" aria-busy={status === "LoadingFirstPage" || status === "LoadingMore"}>
        {results.map(source => <article className="artifact-link-source" data-selected={selected?.requestId === source.requestId && selected?.artifact.id === source.artifact.id} key={`${source.requestId}:${source.artifact.id}`}>
          <button type="button" className="artifact-link-source-select" disabled={busy} aria-pressed={selected?.requestId === source.requestId && selected?.artifact.id === source.artifact.id} onClick={() => { setSelected(source); setName(source.artifact.name); setError(""); }}><b>{source.artifact.label ?? source.artifact.name}</b><span>{source.artifact.name} · {(source.artifact.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB</span><small>{source.specSlug} · {source.pipelineName} · {source.requestId}</small></button>
          <button type="button" className="subtle-button" disabled={busy} aria-label={`Preview ${source.artifact.name} from ${source.requestId}`} onClick={() => setPreview(source)}>View</button>
        </article>)}
        {status === "LoadingFirstPage" && <p role="status">Loading artifacts…</p>}
        {status !== "LoadingFirstPage" && !results.length && <p>No matching artifacts in this page.{status === "CanLoadMore" ? " Load more to continue browsing." : ""}</p>}
        {(status === "CanLoadMore" || status === "LoadingMore") && <button type="button" className="settings-action" disabled={busy || status === "LoadingMore"} onClick={() => loadMore(20)}>{status === "LoadingMore" ? "Loading…" : "Load more artifacts"}</button>}
      </div>
      {selected && <div className="artifact-link-details"><p className="artifact-link-selection">Selected: <b>{selected.artifact.name}</b><br />Source request: <code>{selected.requestId}</code></p><div className="artifact-link-fields">
        <label>New artifact ID<Input required maxLength={128} value={artifactId} disabled={busy} onChange={event => setArtifactId(event.target.value)} /></label>
        <label>File name<Input required maxLength={255} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label>Label (optional)<Input maxLength={255} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} /></label>
        <label>Node name (optional)<Input maxLength={255} value={nodeName} disabled={busy} onChange={event => setNodeName(event.target.value)} /></label>
      </div><p className="artifact-link-hint">The new record belongs to this request. Deleting or changing the original artifact will not change this link.</p></div>}
      {error && <p className="artifact-preview-error" role="alert">{error}</p>}
      <footer className="artifact-link-actions"><button type="button" className="subtle-button" disabled={busy} onClick={onClose}>Cancel</button><button className="request-button" disabled={busy || !selected}>{busy ? "Linking…" : "Link artifact"}</button></footer>
    </form>
    {preview && <ArtifactPreview key={`${preview.requestId}:${preview.artifact.id}`} requestId={preview.requestId} artifact={preview.artifact} onClose={() => setPreview(null)} />}
  </dialog>;
}

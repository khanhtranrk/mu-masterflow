import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const empty = { connectionId: "", name: "", provider: "r2" as "r2" | "supabase", endpoint: "", region: "auto", bucket: "", prefix: "mu", accessKeyId: "", secretAccessKey: "" };
export function StorageConnectionsView() {
  const data = useQuery(api.storage.list, {});
  const save = useAction(api.s3.saveConnection);
  const configure = useMutation(api.storage.configure);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data) return <p>Loading storage connections…</p>;
  if (!data.isOwner) return <p>Storage connections are managed by the application owner.</p>;
  const change = (key: keyof typeof empty, value: string) => setForm(current => ({ ...current, [key]: value }));
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Storage operation failed"); } finally { setBusy(false); }
  };
  return <section style={{ display: "grid", gap: 16, width: "100%" }}>
    <h2>Storage connections</h2><p>Private S3-compatible buckets for new artifacts. Disabling a connection stops new upload/download URLs; existing files are retained.</p>
    {data.connections.map(c => <div className="settings-card" key={c.connectionId}>
      <b>{c.name} · {c.connectionId}</b><p>{c.provider} · {c.bucket} · {c.enabled ? "Enabled" : "Disabled"}{data.defaultConnectionId === c.connectionId ? " · Default" : ""}</p>
      <button disabled={busy} onClick={() => { setEditing(true); setForm({ ...empty, connectionId: c.connectionId, name: c.name, provider: c.provider, endpoint: c.endpoint, region: c.region, bucket: c.bucket, prefix: c.prefix }); }}>Edit / rotate credentials</button>{" "}
      <button disabled={busy} onClick={() => void perform(() => configure({ connectionId: c.connectionId, enabled: !c.enabled }))}>{c.enabled ? "Disable" : "Enable"}</button>{" "}
      {c.enabled && data.defaultConnectionId !== c.connectionId && <button disabled={busy} onClick={() => void perform(() => configure({ connectionId: c.connectionId, makeDefault: true }))}>Use by default</button>}
    </div>)}
    <form style={{ display: "grid", gap: 10 }} onSubmit={event => { event.preventDefault(); void perform(async () => { await save(form); setForm(empty); setEditing(false); }); }}>
      <h3>{editing ? "Update connection" : "Add connection"}</h3>
      <label>Provider <select disabled={editing || busy} value={form.provider} onChange={e => { change("provider", e.target.value); change("region", e.target.value === "r2" ? "auto" : ""); }}><option value="r2">Cloudflare R2</option><option value="supabase">Supabase Storage</option></select></label>
      {([ ["connectionId", "Stable ID (for example r2-1)"], ["name", "Display name"], ["endpoint", "HTTPS S3 endpoint"], ["region", "Region"], ["bucket", "Private bucket"], ["prefix", "Object prefix"], ["accessKeyId", "S3 access key ID"], ["secretAccessKey", "S3 secret access key"] ] as const).map(([key, label]) => <label key={key}>{label}<input style={{ display: "block", width: "100%" }} required={key !== "prefix"} disabled={busy || (editing && ["connectionId", "endpoint", "region", "bucket", "prefix"].includes(key))} type={key === "secretAccessKey" ? "password" : "text"} autoComplete="off" value={form[key]} onChange={e => change(key, e.target.value)} /></label>)}
      <p>Credentials are encrypted on the server and never returned here. Use a private bucket; configure bucket CORS for your desktop/web origins. Changing the storage location requires a new stable ID.</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Checking connection…" : "Test and save connection"}</button>
      {editing && <button type="button" disabled={busy} onClick={() => { setEditing(false); setForm(empty); }}>Cancel</button>}
    </form>
  </section>;
}

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Input } from "./ui/Input";
import { SelectField } from "./ui/SelectField";
import { ActionMenu } from "./ui/ActionMenu";
import "../storage-connections.css";

const empty = { connectionId: "", name: "", provider: "r2" as "r2" | "supabase", endpoint: "", region: "auto", bucket: "", prefix: "mu", accessKeyId: "", secretAccessKey: "" };
const providers = [{ value: "r2", label: "Cloudflare R2" }, { value: "supabase", label: "Supabase Storage" }];
const fields = [
  ["connectionId", "Stable connection ID", "r2-1"], ["name", "Display name", "Production artifacts"],
  ["endpoint", "S3 endpoint", "https://…"], ["bucket", "Private bucket", "mu-artifacts"],
  ["region", "Region", "auto"], ["prefix", "Object prefix", "mu"],
] as const;

export function StorageConnectionsView({ open = true }: { open?: boolean }) {
  const data = useQuery(api.storage.list, {});
  const save = useAction(api.s3.saveConnection);
  const configure = useMutation(api.storage.configure);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!open) { setForm(empty); setEditing(false); setError(""); } }, [open]);
  if (!data) return <p className="storage-state" role="status">Loading storage connections…</p>;
  if (!data.isOwner) return <p className="storage-state">Storage connections are managed by the application owner.</p>;
  const change = (key: keyof typeof empty, value: string) => setForm(current => ({ ...current, [key]: value }));
  const reset = () => { setForm(empty); setEditing(false); setError(""); };
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Storage operation failed"); } finally { setBusy(false); }
  };
  return <div className="storage-manager">
    <div className="storage-connection-list">
      {data.connections.map(c => <article className="storage-connection-card" key={c.connectionId}>
        <div className="storage-connection-heading">
          <div><b>{c.name}</b><span className={`unit-token-status ${c.enabled ? "active" : "revoked"}`}>{c.enabled ? "Enabled" : "Disabled"}</span>{data.defaultConnectionId === c.connectionId && <span className="storage-default">Default</span>}</div>
          <ActionMenu label={`Actions for ${c.name}`} trigger={<button type="button" className="settings-action storage-menu-trigger" disabled={busy} aria-label={`Actions for ${c.name}`}>•••</button>} actions={[
            { label: "Edit / rotate credentials", disabled: busy, onSelect: () => { setError(""); setEditing(true); setForm({ ...empty, connectionId: c.connectionId, name: c.name, provider: c.provider, endpoint: c.endpoint, region: c.region, bucket: c.bucket, prefix: c.prefix }); } },
            { label: c.enabled ? "Disable connection" : "Enable connection", disabled: busy, onSelect: () => void perform(() => configure({ connectionId: c.connectionId, enabled: !c.enabled })) },
            ...(c.enabled && data.defaultConnectionId !== c.connectionId ? [{ label: "Use by default", disabled: busy, onSelect: () => void perform(() => configure({ connectionId: c.connectionId, makeDefault: true })) }] : []),
          ]} />
        </div>
        <p>{c.provider === "r2" ? "Cloudflare R2" : "Supabase Storage"} · {c.bucket}</p>
        <code>{c.connectionId}</code>
      </article>)}
      {!data.connections.length && <div className="empty-editor"><b>No storage connections</b><small>Add a private bucket to start uploading artifacts.</small></div>}
    </div>
    <form className="storage-connection-form" onSubmit={event => { event.preventDefault(); void perform(async () => { await save(form); reset(); }); }}>
      <div className="storage-form-heading"><div><h3>{editing ? "Update connection" : "Add connection"}</h3><p>{editing ? "Re-enter credentials to rotate access. The storage location stays fixed." : "Connect a private bucket for direct artifact uploads and downloads."}</p></div>{editing && <button type="button" className="subtle-button" disabled={busy} onClick={reset}>Add another connection</button>}</div>
      <fieldset disabled={busy} className="storage-form-section">
        <legend>Connection</legend>
        <div className="storage-form-grid">
          <label className="storage-field-wide">Provider<SelectField label="Storage provider" disabled={editing || busy} value={form.provider} options={providers} onValueChange={value => setForm(current => ({ ...current, provider: value as "r2" | "supabase", region: value === "r2" ? "auto" : "" }))} /></label>
          {fields.map(([key, label, placeholder]) => <label key={key} className={key === "endpoint" ? "storage-field-wide" : undefined}>{label}<Input required={key !== "prefix"} disabled={busy || (editing && key !== "name")} autoComplete="off" spellCheck={false} placeholder={placeholder} value={form[key]} onChange={e => change(key, e.target.value)} /></label>)}
        </div>
      </fieldset>
      <fieldset disabled={busy} className="storage-form-section">
        <legend>Credentials</legend>
        <div className="storage-form-grid">
          <label>S3 access key ID<Input required autoComplete="off" spellCheck={false} value={form.accessKeyId} onChange={e => change("accessKeyId", e.target.value)} /></label>
          <label>S3 secret access key<Input required type="password" autoComplete="new-password" value={form.secretAccessKey} onChange={e => change("secretAccessKey", e.target.value)} /></label>
        </div>
        <p className="storage-form-hint">Credentials are encrypted on the server and never shown again. Configure bucket CORS for your app origins.</p>
      </fieldset>
      {error && <p className="storage-form-error" role="alert">{error}</p>}
      <div className="storage-form-actions"><button className="request-button" disabled={busy}>{busy ? "Checking connection…" : "Test and save connection"}</button>{editing && <button type="button" className="subtle-button" disabled={busy} onClick={reset}>Cancel</button>}</div>
    </form>
  </div>;
}

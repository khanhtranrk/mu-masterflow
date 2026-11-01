import { Input } from "./ui/Input";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

const DateTimePicker = lazy(() => import("./ui/DateTimePicker").then(module => ({ default: module.DateTimePicker })));
const datePickerLoading = <button type="button" disabled className="ui-date-trigger">Loading date picker…</button>;

type UnitToken = {
  _id: Id<"unitTokens">;
  _creationTime: number;
  name: string;
  unitId?: string;
  specSlugs?: string[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  deletedAt?: number;
};

function createRandomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function toLocalDateTime(timestamp?: number) {
  if (timestamp === undefined) return "";
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function expiryTimestamp(value: string) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Choose a valid expiration date.");
  return timestamp;
}

export function UnitTokensView({ open = true }: { open?: boolean }) {
  const revealOpen = useRef(open);
  revealOpen.current = open;
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [specSlugsInput, setSpecSlugsInput] = useState("");
  const [editSpecSlugs, setEditSpecSlugs] = useState("");
  const [unitId, setUnitId] = useState("");
  const [editUnitId, setEditUnitId] = useState("");
  const storageAccess = useQuery(api.storage.list, {});
  const [name, setName] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [editingId, setEditingId] = useState<Id<"unitTokens"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editExpiresAtInput, setEditExpiresAtInput] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const remoteTokens = useQuery(api.unitTokens.list, { includeRevoked });
  const createUnitToken = useMutation(api.unitTokens.create);
  const updateUnitToken = useMutation(api.unitTokens.update);
  const revokeUnitToken = useMutation(api.unitTokens.revoke);
  // Keep only the last metadata snapshot while a filter query is resolving.
  // Convex remains the source of truth and replaces it as soon as results arrive.
  const lastLoaded = useRef<UnitToken[] | undefined>(undefined);
  useEffect(() => { if (remoteTokens !== undefined) lastLoaded.current = remoteTokens; }, [remoteTokens]);
  const tokens = remoteTokens ?? lastLoaded.current;
  const loading = tokens === undefined;
  const refreshing = remoteTokens === undefined && !loading;

  useEffect(() => {
    // Collapsing must not preserve the one-time plaintext reveal.
    if (!open) { setNewToken(""); setCopied(false); }
  }, [open]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNewToken("");
    setCopied(false);
    try {
      const token = createRandomToken();
      const tokenHash = await hashToken(token);
      const expiresAt = expiryTimestamp(expiresAtInput);
      await createUnitToken({
        name,
        unitId,
        specSlugs: specSlugsInput.split(",").map(s => s.trim()).filter(Boolean),
        tokenHash,
        ...(expiresAt !== null && { expiresAt }),
      });
      setNewToken(revealOpen.current ? token : "");
      setName("");
      setExpiresAtInput("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create unit token.");
    } finally {
      setSaving(false);
    }
  }

  async function updateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      const expiresAt = expiryTimestamp(editExpiresAtInput);
      await updateUnitToken({ id: editingId, name: editName, unitId: editUnitId, specSlugs: editSpecSlugs.split(",").map(s => s.trim()).filter(Boolean), expiresAt });
      setEditingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update unit token.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeToken(token: UnitToken) {
    if (!window.confirm(`Revoke unit token “${token.name}”? Units using it will no longer be authorized.`)) return;
    setSaving(true);
    setError("");
    try {
      await revokeUnitToken({ id: token._id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke unit token.");
    } finally {
      setSaving(false);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not copy token.");
    }
  }

  function beginEdit(token: UnitToken) {
    setEditingId(token._id);
    setEditName(token.name); setEditUnitId(token.unitId ?? ""); setEditSpecSlugs((token.specSlugs ?? []).join(", "));
    setEditExpiresAtInput(toLocalDateTime(token.expiresAt));
  }

  function tokenStatus(token: UnitToken) {
    if (token.deletedAt !== undefined) return "Revoked";
    if (token.expiresAt !== undefined && token.expiresAt <= Date.now()) return "Expired";
    return "Active";
  }

  if (storageAccess && !storageAccess.isOwner) return <p>Only the owner can manage worker tokens.</p>;

  return (
    <section className="editor-view unit-tokens-view">
      <div className="view-heading">
        <div>
          <span className="view-kicker">UNITS</span>
          <h2>Unit tokens</h2>
          <p>Manage bearer tokens used by Units (Workers) to call Convex HTTP hooks.</p>
        </div>
      </div>

      {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
      <form className="auth-admin-card unit-token-create" onSubmit={(event) => void createToken(event)}>
        <div><b>Create unit token</b><p>Token plaintext is shown once. Save it in the Unit's secret configuration.</p></div>
        <div className="unit-token-form-fields">
          <label>Allowed spec slugs<Input required disabled={saving} value={specSlugsInput} onChange={event => setSpecSlugsInput(event.target.value)} placeholder="spec-a, spec-b" /></label>
          <label>Worker unit ID<Input required disabled={saving} value={unitId} onChange={event => setUnitId(event.target.value)} placeholder="Exact --unit-id used by this worker" /></label>
          <label>Name<Input required disabled={saving} value={name} onChange={(event) => setName(event.target.value)} placeholder="Unit or integration" /></label>
          <label>Expires at <Suspense fallback={datePickerLoading}><DateTimePicker label="New token expiration" min={toLocalDateTime(Date.now() + 60_000)} value={expiresAtInput} onValueChange={setExpiresAtInput} disabled={saving} /></Suspense></label>
          <div className="unit-token-form-actions"><button className="request-button" disabled={saving}>{saving ? "Creating…" : "Create token"}</button></div>
        </div>
      </form>

      {newToken && (
        <div className="unit-token-once">
          <b>Copy this token now. It cannot be shown again.</b>
          <code>{newToken}</code>
          <button className="subtle-button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy token"}</button>
        </div>
      )}

      <div className="unit-token-list-heading">
        <b>Tokens <span>{tokens === undefined ? "—" : tokens.length}</span></b>
        {refreshing && <span className="unit-token-refresh" role="status">Updating…</span>}
        <label><Input type="checkbox" checked={includeRevoked} onChange={(event) => setIncludeRevoked(event.target.checked)} /> Include revoked</label>
      </div>
      <div className="unit-token-results" aria-busy={loading || refreshing}>
      {tokens === undefined ? <div className="unit-token-loading" role="status"><span>Loading unit tokens…</span><div className="unit-token-placeholder" aria-hidden="true" /><div className="unit-token-placeholder" aria-hidden="true" /></div> : tokens.length > 0 ? (
        <div className="unit-token-list">
          {tokens.map((token) => (
            <article className="unit-token-card" data-editing={editingId === token._id} key={token._id}>
              <div className="unit-token-card-heading">
                <div><b title={token.name}>{token.name}</b><span className={`unit-token-status ${tokenStatus(token).toLowerCase()}`}>{tokenStatus(token)}</span></div>
                <div className="unit-token-actions">
                  {token.deletedAt === undefined && <button className="subtle-button" disabled={saving || refreshing} onClick={() => beginEdit(token)}>Edit</button>}
                  {token.deletedAt === undefined && <button className="subtle-button danger" disabled={saving || refreshing} onClick={() => void revokeToken(token)}>Revoke</button>}
                </div>
              </div>
              <small>Worker: {token.unitId ?? "Unbound — configure before use"} · Specs: {token.specSlugs?.join(", ") || "Not configured"}</small>
              <small>Created {new Date(token.createdAt).toLocaleString()} · Last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "Never"}</small>
              <small>Expires {token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</small>
              {editingId === token._id && (
                <form className="unit-token-edit" onSubmit={(event) => void updateToken(event)}>
                  <label>Allowed spec slugs<Input required disabled={saving} value={editSpecSlugs} onChange={event => setEditSpecSlugs(event.target.value)} /></label>
                  <label>Worker unit ID<Input required disabled={saving || Boolean(token.unitId)} value={editUnitId} onChange={event => setEditUnitId(event.target.value)} /></label>
                  <label>Name<Input required disabled={saving} value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                  <label>Expires at<Suspense fallback={datePickerLoading}><DateTimePicker label="Token expiration" min={toLocalDateTime(Date.now() + 60_000)} value={editExpiresAtInput} onValueChange={setEditExpiresAtInput} disabled={saving} /></Suspense></label>
                  <div className="unit-token-form-actions"><button className="request-button" disabled={saving}>{saving ? "Saving…" : "Save token"}</button><button type="button" className="subtle-button" disabled={saving} onClick={() => setEditingId(null)}>Cancel</button></div>
                </form>
              )}
            </article>
          ))}
        </div>
      ) : <div className="empty-editor"><b>No unit tokens</b><small>Create a token for a Unit or integration.</small></div>}
      </div>
    </section>
  );
}

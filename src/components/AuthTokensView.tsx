import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

type AuthToken = {
  _id: Id<"authTokens">;
  _creationTime: number;
  name: string;
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

export function AuthTokensView() {
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [name, setName] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [editingId, setEditingId] = useState<Id<"authTokens"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editExpiresAtInput, setEditExpiresAtInput] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const remoteTokens = useQuery(api.authTokens.list, { includeRevoked });
  const createAuthToken = useMutation(api.authTokens.create);
  const updateAuthToken = useMutation(api.authTokens.update);
  const revokeAuthToken = useMutation(api.authTokens.revoke);
  const tokens = remoteTokens ?? [];
  const loading = remoteTokens === undefined;

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
      await createAuthToken({
        name,
        tokenHash,
        ...(expiresAt !== null && { expiresAt }),
      });
      setNewToken(token);
      setName("");
      setExpiresAtInput("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create auth token.");
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
      await updateAuthToken({ id: editingId, name: editName, expiresAt });
      setEditingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update auth token.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeToken(token: AuthToken) {
    if (!window.confirm(`Revoke token “${token.name}”? Workers using it will no longer be authorized.`)) return;
    setSaving(true);
    setError("");
    try {
      await revokeAuthToken({ id: token._id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke auth token.");
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

  function beginEdit(token: AuthToken) {
    setEditingId(token._id);
    setEditName(token.name);
    setEditExpiresAtInput(toLocalDateTime(token.expiresAt));
  }

  function tokenStatus(token: AuthToken) {
    if (token.deletedAt !== undefined) return "Revoked";
    if (token.expiresAt !== undefined && token.expiresAt <= Date.now()) return "Expired";
    return "Active";
  }

  return (
    <section className="editor-view auth-tokens-view">
      <div className="view-heading">
        <div>
          <span className="view-kicker">WORKERS</span>
          <h2>Auth tokens</h2>
          <p>Manage bearer tokens used by workers to call Convex HTTP hooks.</p>
        </div>
      </div>

      {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
      <form className="auth-admin-card auth-token-create" onSubmit={(event) => void createToken(event)}>
        <div><b>Create auth token</b><p>Token plaintext is shown once. Save it in the worker's secret configuration.</p></div>
        <div className="auth-token-form-fields">
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Worker or integration" /></label>
          <label>Expires at <input type="datetime-local" min={toLocalDateTime(Date.now() + 60_000)} value={expiresAtInput} onChange={(event) => setExpiresAtInput(event.target.value)} /></label>
          <button className="request-button" disabled={saving}>{saving ? "Creating…" : "Create token"}</button>
        </div>
      </form>

      {newToken && (
        <div className="auth-token-once">
          <b>Copy this token now. It cannot be shown again.</b>
          <code>{newToken}</code>
          <button className="subtle-button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy token"}</button>
        </div>
      )}

      <div className="auth-token-list-heading">
        <b>Tokens <span>{tokens.length}</span></b>
        <label><input type="checkbox" checked={includeRevoked} onChange={(event) => setIncludeRevoked(event.target.checked)} /> Include revoked</label>
      </div>
      {loading ? <div className="empty-editor"><small>Loading auth tokens…</small></div> : tokens.length > 0 ? (
        <div className="auth-token-list">
          {tokens.map((token) => (
            <article className="auth-token-card" key={token._id}>
              <div className="auth-token-card-heading">
                <div><b>{token.name}</b><span className={`auth-token-status ${tokenStatus(token).toLowerCase()}`}>{tokenStatus(token)}</span></div>
                <div className="auth-token-actions">
                  {token.deletedAt === undefined && <button className="subtle-button" onClick={() => beginEdit(token)}>Edit</button>}
                  {token.deletedAt === undefined && <button className="subtle-button danger" disabled={saving} onClick={() => void revokeToken(token)}>Revoke</button>}
                </div>
              </div>
              <small>Created {new Date(token.createdAt).toLocaleString()} · Last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "Never"}</small>
              <small>Expires {token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</small>
              {editingId === token._id && (
                <form className="auth-token-edit" onSubmit={(event) => void updateToken(event)}>
                  <label>Name<input required value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                  <label>Expires at<input type="datetime-local" min={toLocalDateTime(Date.now() + 60_000)} value={editExpiresAtInput} onChange={(event) => setEditExpiresAtInput(event.target.value)} /></label>
                  <button className="request-button" disabled={saving}>{saving ? "Saving…" : "Save token"}</button>
                  <button type="button" className="subtle-button" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              )}
            </article>
          ))}
        </div>
      ) : <div className="empty-editor"><b>No auth tokens</b><small>Create a token for a worker or integration.</small></div>}
    </section>
  );
}

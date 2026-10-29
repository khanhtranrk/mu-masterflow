import { useState, type FormEvent } from "react";

type AuthToken = {
  _id: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  deletedAt?: number;
};

type TokenResponse = { tokens: AuthToken[] };
type CreatedTokenResponse = { id: string; token: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function requestAdminApi<T>(
  baseUrl: string,
  adminKey: string,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  if (!baseUrl) throw new Error("VITE_CONVEX_SITE_URL is not configured.");
  const parsedBaseUrl = new URL(baseUrl);
  if (
    parsedBaseUrl.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(parsedBaseUrl.hostname)
  ) {
    throw new Error("Token administration requires HTTPS outside local development.");
  }

  const response = await fetch(`${parsedBaseUrl.origin.replace(/\/+$/, "")}/hooks/auth-tokens${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminKey}`,
      ...(body && { "Content-Type": "application/json" }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();

  if (!response.ok) {
    const message = isRecord(result) && typeof result.error === "string"
      ? result.error
      : `Auth token request failed (${response.status}).`;
    throw new Error(message);
  }

  return result as T;
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
  const [adminKey, setAdminKey] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [name, setName] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editExpiresAtInput, setEditExpiresAtInput] = useState("");
  const [newToken, setNewToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const baseUrl = import.meta.env.VITE_CONVEX_SITE_URL ?? "";

  async function loadTokens(key = adminKey, showRevoked = includeRevoked) {
    const result = await requestAdminApi<TokenResponse>(
      baseUrl,
      key,
      `?includeRevoked=${showRevoked}`,
      "GET",
    );
    setTokens(result.tokens);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await loadTokens(adminKey);
      setUnlocked(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not authenticate token administrator.");
    } finally {
      setLoading(false);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNewToken("");
    setCopied(false);
    try {
      const expiresAt = expiryTimestamp(expiresAtInput);
      const result = await requestAdminApi<CreatedTokenResponse>(
        baseUrl,
        adminKey,
        "/create",
        "POST",
        { name, ...(expiresAt !== null && { expiresAt }) },
      );
      setNewToken(result.token);
      setName("");
      setExpiresAtInput("");
      await loadTokens();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create auth token.");
    } finally {
      setLoading(false);
    }
  }

  async function updateToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setLoading(true);
    setError("");
    try {
      const expiresAt = expiryTimestamp(editExpiresAtInput);
      await requestAdminApi<{ ok: boolean }>(
        baseUrl,
        adminKey,
        "/update",
        "POST",
        { id: editingId, name: editName, expiresAt },
      );
      setEditingId(null);
      await loadTokens();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update auth token.");
    } finally {
      setLoading(false);
    }
  }

  async function revokeToken(token: AuthToken) {
    if (!window.confirm(`Revoke token “${token.name}”? Workers using it will no longer be authorized.`)) return;
    setLoading(true);
    setError("");
    try {
      await requestAdminApi<{ ok: boolean }>(baseUrl, adminKey, "/revoke", "POST", { id: token._id });
      await loadTokens();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke auth token.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshTokens(showRevoked: boolean) {
    setIncludeRevoked(showRevoked);
    setLoading(true);
    setError("");
    try {
      await loadTokens(adminKey, showRevoked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh auth tokens.");
    } finally {
      setLoading(false);
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
          <span className="view-kicker">SECURITY</span>
          <h2>Auth tokens</h2>
          <p>Manage bearer tokens used by workers to call Convex HTTP hooks.</p>
        </div>
      </div>

      {!unlocked ? (
        <form className="auth-admin-card" onSubmit={(event) => void unlock(event)}>
          <b>Administrator access</b>
          <p>Enter the admin key configured as <code>AUTH_TOKENS_ADMIN_KEY</code> in the Convex deployment. The key stays in memory only while this page is open.</p>
          <label>Admin key<input type="password" autoComplete="off" autoFocus required value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="request-button" disabled={loading}>{loading ? "Checking…" : "Unlock token manager"}</button>
        </form>
      ) : (
        <>
          {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
          <form className="auth-admin-card auth-token-create" onSubmit={(event) => void createToken(event)}>
            <div><b>Create auth token</b><p>Token plaintext is shown once. Save it in the worker's secret configuration.</p></div>
            <div className="auth-token-form-fields">
              <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Worker or integration" /></label>
              <label>Expires at <input type="datetime-local" min={toLocalDateTime(Date.now() + 60_000)} value={expiresAtInput} onChange={(event) => setExpiresAtInput(event.target.value)} /></label>
              <button className="request-button" disabled={loading}>{loading ? "Creating…" : "Create token"}</button>
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
            <label><input type="checkbox" checked={includeRevoked} onChange={(event) => void refreshTokens(event.target.checked)} /> Include revoked</label>
          </div>
          {tokens.length > 0 ? (
            <div className="auth-token-list">
              {tokens.map((token) => (
                <article className="auth-token-card" key={token._id}>
                  <div className="auth-token-card-heading">
                    <div><b>{token.name}</b><span className={`auth-token-status ${tokenStatus(token).toLowerCase()}`}>{tokenStatus(token)}</span></div>
                    <div className="auth-token-actions">
                      {token.deletedAt === undefined && <button className="subtle-button" onClick={() => beginEdit(token)}>Edit</button>}
                      {token.deletedAt === undefined && <button className="subtle-button danger" disabled={loading} onClick={() => void revokeToken(token)}>Revoke</button>}
                    </div>
                  </div>
                  <small>Created {new Date(token.createdAt).toLocaleString()} · Last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "Never"}</small>
                  <small>Expires {token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never"}</small>
                  {editingId === token._id && (
                    <form className="auth-token-edit" onSubmit={(event) => void updateToken(event)}>
                      <label>Name<input required value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                      <label>Expires at<input type="datetime-local" min={toLocalDateTime(Date.now() + 60_000)} value={editExpiresAtInput} onChange={(event) => setEditExpiresAtInput(event.target.value)} /></label>
                      <button className="request-button" disabled={loading}>{loading ? "Saving…" : "Save token"}</button>
                      <button type="button" className="subtle-button" onClick={() => setEditingId(null)}>Cancel</button>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ) : <div className="empty-editor"><b>No auth tokens</b><small>Create a token for a worker or integration.</small></div>}
          <button className="subtle-button auth-token-lock" onClick={() => { setUnlocked(false); setAdminKey(""); setTokens([]); setNewToken(""); }}>Lock token manager</button>
        </>
      )}
    </section>
  );
}

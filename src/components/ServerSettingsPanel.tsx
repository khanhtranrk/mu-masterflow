import { useState } from "react";
import {
  createConvexProfile,
  validateServerUrl,
  type ConnectionSettings,
  type ConvexServerProfile,
} from "../connectionSettings";

type ServerSettingsPanelProps = {
  settings: ConnectionSettings;
  onSave: (settings: ConnectionSettings) => Promise<void>;
  onConnect: (profileId: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
};

export function ServerSettingsPanel({
  settings,
  onSave,
  onConnect,
  onDisconnect,
}: ServerSettingsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [clientUrl, setClientUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeProfile = settings.profiles.find((profile) => profile.id === settings.activeProfileId);

  function startEditing(profile?: ConvexServerProfile) {
    setEditingId(profile?.id ?? null);
    setName(profile?.name ?? "");
    setClientUrl(profile?.clientUrl ?? "");
    setSiteUrl(profile?.siteUrl ?? "");
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Enter a name for this server.");
      const normalizedClientUrl = validateServerUrl(clientUrl, "Client/API URL");
      const normalizedSiteUrl = validateServerUrl(siteUrl, "HTTP site URL");
      let profileId = editingId;
      let profiles: ConvexServerProfile[];
      if (editingId) {
        profiles = settings.profiles.map((profile) => profile.id === editingId
          ? { ...profile, name: normalizedName, clientUrl: normalizedClientUrl, siteUrl: normalizedSiteUrl }
          : profile);
      } else {
        const profile = createConvexProfile({
          name: normalizedName,
          clientUrl: normalizedClientUrl,
          siteUrl: normalizedSiteUrl,
        });
        profileId = profile.id;
        profiles = [...settings.profiles, profile];
      }
      if (!profileId) throw new Error("Could not identify the saved server.");
      await onSave({ ...settings, profiles });
      if (!editingId || editingId === settings.activeProfileId) await onConnect(profileId);
      startEditing();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  async function selectServer(profileId: string) {
    setBusy(true);
    setError("");
    try {
      await onConnect(profileId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect to this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await onDisconnect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disconnect from this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: ConvexServerProfile) {
    if (!window.confirm(`Remove “${profile.name}” from the saved server list?`)) return;
    setBusy(true);
    setError("");
    try {
      const profiles = settings.profiles.filter((item) => item.id !== profile.id);
      const activeProfileId = settings.activeProfileId === profile.id ? null : settings.activeProfileId;
      await onSave({ ...settings, profiles, activeProfileId });
      if (editingId === profile.id) startEditing();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editor-view server-settings-panel">
      <div className="view-heading">
        <div>
          <span className="view-kicker">CONNECTION</span>
          <h2>Convex servers</h2>
          <p>Connect to a saved server or add an endpoint for another deployment.</p>
        </div>
      </div>

      {error && <div className="inline-error" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}

      <form className="auth-admin-card server-profile-form" onSubmit={(event) => void submit(event)}>
        <div>
          <b>{editingId ? "Edit server" : "Add a server"}</b>
          <p>Enter the Convex client/API URL and its matching HTTP site URL.</p>
        </div>
        <div className="server-profile-form-fields">
          <label>
            Name
            <input autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Local development" required />
          </label>
          <label>
            Client/API URL
            <input autoComplete="url" type="url" value={clientUrl} onChange={(event) => setClientUrl(event.target.value)} placeholder="http://127.0.0.1:3210" required />
          </label>
          <label>
            HTTP site URL
            <input autoComplete="url" type="url" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="http://127.0.0.1:3211" required />
          </label>
          <p className="server-profile-help">Self-hosted Convex typically uses port 3210 for API and 3211 for HTTP site. Admin keys are not needed.</p>
          <div className="server-profile-form-actions">
            {editingId && <button type="button" className="subtle-button" disabled={busy} onClick={() => startEditing()}>Cancel</button>}
            <button type="submit" className="request-button" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Add and connect"}
            </button>
          </div>
        </div>
      </form>

      <div className="auth-token-list-heading">
        <b>Saved servers <span>{settings.profiles.length}</span></b>
        <span>{activeProfile ? `Connected to ${activeProfile.name}` : "No server connected"}</span>
      </div>
      {settings.profiles.length > 0 ? (
        <div className="auth-token-list">
          {settings.profiles.map((profile) => {
            const active = profile.id === settings.activeProfileId;
            const accounts = profile.accounts ?? [];
            return (
              <article className="auth-token-card server-profile-card" key={profile.id}>
                <div className="auth-token-card-heading">
                  <div className="server-profile-title">
                    <b>{profile.name}</b>
                    <span className={`auth-token-status ${active ? "active" : ""}`}>{active ? "Connected" : "Saved"}</span>
                  </div>
                  <div className="auth-token-actions">
                    {!active && <button className="subtle-button" disabled={busy} onClick={() => void selectServer(profile.id)}>Connect</button>}
                    {active && <button className="subtle-button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}
                    <button className="subtle-button" disabled={busy} onClick={() => startEditing(profile)}>Edit</button>
                    <button className="subtle-button danger" disabled={busy} onClick={() => void removeProfile(profile)}>Remove</button>
                  </div>
                </div>
                <small>Client/API · {profile.clientUrl}</small>
                <small>HTTP site · {profile.siteUrl}</small>
                {accounts.length > 0 && <small>{accounts.length} remembered account{accounts.length === 1 ? "" : "s"}</small>}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-editor"><b>No saved servers</b><small>Add a server above to get started.</small></div>
      )}
    </section>
  );
}

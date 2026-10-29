import { useEffect, useState } from "react";
import {
  createConvexProfile,
  validateServerUrl,
  type ConnectionSettings,
  type ConvexServerProfile,
} from "../connectionSettings";

type LoginServerDialogProps = {
  settings: ConnectionSettings;
  darkMode: boolean;
  onSave: (settings: ConnectionSettings) => Promise<void>;
  onConnect: (profileId: string) => Promise<void>;
  onClose: () => void;
};

export function LoginServerDialog({
  settings,
  darkMode,
  onSave,
  onConnect,
  onClose,
}: LoginServerDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(settings.profiles.length === 0);
  const [name, setName] = useState("");
  const [clientUrl, setClientUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  function editProfile(profile?: ConvexServerProfile) {
    setEditingId(profile?.id ?? null);
    setAdding(!profile);
    setName(profile?.name ?? "");
    setClientUrl(profile?.clientUrl ?? "");
    setSiteUrl(profile?.siteUrl ?? "");
    setError("");
  }

  async function selectServer(profileId: string) {
    setBusy(true);
    setError("");
    try {
      await onConnect(profileId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not connect to this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  async function saveServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error("Enter a name for this server.");
      const profileFields = {
        name: normalizedName,
        clientUrl: validateServerUrl(clientUrl, "Client/API URL"),
        siteUrl: validateServerUrl(siteUrl, "HTTP site URL"),
      };
      let profileId = editingId;
      let profiles: ConvexServerProfile[];
      if (editingId) {
        profiles = settings.profiles.map((profile) => profile.id === editingId
          ? { ...profile, ...profileFields }
          : profile);
      } else {
        const profile = createConvexProfile(profileFields);
        profileId = profile.id;
        profiles = [...settings.profiles, profile];
      }
      if (!profileId) throw new Error("Could not identify the saved server.");
      await onSave({ ...settings, profiles });
      await onConnect(profileId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this Convex server.");
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
      if (editingId === profile.id) editProfile();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove this Convex server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`connection-overlay${darkMode ? " dark" : ""}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        className="connection-card login-server-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-server-title"
      >
        <header className="view-heading auth-view-heading login-server-heading">
          <div>
            <span className="view-kicker">MASTERFLOW · CONNECTION</span>
            <h1 id="login-server-title">Choose a Convex server</h1>
            <p>Select a saved server, or add one to continue to sign in.</p>
          </div>
          <button className="subtle-button login-server-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {settings.profiles.length > 0 && (
          <div className="login-server-list" aria-label="Saved Convex servers">
            <div className="auth-token-list-heading">
              <b>Saved servers <span>{settings.profiles.length}</span></b>
            </div>
            {settings.profiles.map((profile) => {
              const active = profile.id === settings.activeProfileId;
              return (
                <article className="auth-token-card login-server-profile" key={profile.id}>
                  <div className="auth-token-card-heading">
                    <div className="server-profile-title">
                      <b>{profile.name}</b>
                      <span className={`auth-token-status ${active ? "active" : ""}`}>{active ? "Connected" : "Saved"}</span>
                    </div>
                    <div className="auth-token-actions">
                      {!active && <button className="subtle-button" disabled={busy} onClick={() => void selectServer(profile.id)}>Connect</button>}
                      <button className="subtle-button" disabled={busy} onClick={() => editProfile(profile)}>Edit</button>
                      <button className="subtle-button danger" disabled={busy} onClick={() => void removeProfile(profile)}>Remove</button>
                    </div>
                  </div>
                  <small>Client/API · {profile.clientUrl}</small>
                  <small>HTTP site · {profile.siteUrl}</small>
                </article>
              );
            })}
          </div>
        )}

        {(adding || editingId) ? (
          <form className="auth-admin-card login-server-form" onSubmit={(event) => void saveServer(event)}>
            <div>
              <b>{editingId ? "Edit server" : "Add a server"}</b>
              <p>Enter the API and HTTP site endpoints for your Convex deployment.</p>
            </div>
            <div className="login-server-fields">
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
            </div>
            <p className="login-server-help">Use the HTTP site URL for worker hooks. Admin keys are not required.</p>
            {error && <p className="auth-inline-error" role="alert">{error}</p>}
            <div className="login-server-form-actions">
              {settings.profiles.length > 0 && <button type="button" className="subtle-button" disabled={busy} onClick={() => editProfile()}>Cancel</button>}
              <button type="submit" className="request-button" disabled={busy}>
                {busy ? "Connecting…" : editingId ? "Save and connect" : "Add and connect"}
              </button>
            </div>
          </form>
        ) : (
          <div className="login-server-add">
            <button className="request-button" disabled={busy} onClick={() => editProfile()}>
              ＋ Add another server
            </button>
            {error && <p className="auth-inline-error" role="alert">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

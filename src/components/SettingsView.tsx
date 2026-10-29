import { useState } from "react";
import type { ConnectionSettings, ConvexServerProfile } from "../connectionSettings";
import { UnitTokensView } from "./UnitTokensView";
import { ServerSettingsPanel } from "./ServerSettingsPanel";

type SettingsViewProps = {
  serverProfile: ConvexServerProfile | null;
  serverSettings: ConnectionSettings;
  darkMode: boolean;
  error: string;
  onSaveServerSettings: (settings: ConnectionSettings) => Promise<void>;
  onConnectServer: (profileId: string) => Promise<void>;
  onDisconnectServer: () => Promise<void>;
  onToggleTheme: () => void;
  onSignOut: () => void;
};

export function SettingsView({
  serverProfile,
  serverSettings,
  darkMode,
  error,
  onSaveServerSettings,
  onConnectServer,
  onDisconnectServer,
  onToggleTheme,
  onSignOut,
}: SettingsViewProps) {
  const [unitTokensExpanded, setUnitTokensExpanded] = useState(false);
  const [serverManagerExpanded, setServerManagerExpanded] = useState(serverProfile === null);

  return (
    <div className="editor-scroll settings-scroll">
      <section className="settings-page" aria-labelledby="settings-title">
        <header className="settings-heading">
          <p className="settings-eyebrow">MASTERFLOW</p>
          <h1 id="settings-title">Settings</h1>
          <p>Manage your appearance and Convex connection.</p>
        </header>

        <section className="settings-section" aria-labelledby="appearance-title">
          <div className="settings-section-copy">
            <h2 id="appearance-title">Appearance</h2>
            <p>Choose the color theme used by MasterFlow.</p>
          </div>
          <button className="settings-action" onClick={onToggleTheme}>
            <span aria-hidden="true">{darkMode ? "☼" : "☾"}</span>
            <span>{darkMode ? "Switch to light appearance" : "Switch to dark appearance"}</span>
          </button>
        </section>

        <section className="settings-section settings-server-section" aria-labelledby="server-title">
          <div className="settings-section-copy">
            <h2 id="server-title">Convex server</h2>
            <p>{serverProfile ? "Connected server profile and endpoint." : "Choose a saved server or add a new connection."}</p>
          </div>
          <div className="settings-server">
            <div className="settings-server-details">
              <strong>{serverProfile?.name ?? "No server connected"}</strong>
              {serverProfile && <span>{serverProfile.clientUrl}</span>}
            </div>
            <button
              className="settings-action"
              aria-expanded={serverManagerExpanded}
              onClick={() => setServerManagerExpanded((expanded) => !expanded)}
            >
              {serverManagerExpanded ? "Hide servers" : serverProfile ? "Manage servers" : "Choose a server"}
            </button>
          </div>
          {serverManagerExpanded && (
            <ServerSettingsPanel
              settings={serverSettings}
              onSave={onSaveServerSettings}
              onConnect={onConnectServer}
              onDisconnect={onDisconnectServer}
            />
          )}
        </section>

        {serverProfile && <section className="settings-section settings-unit-tokens" aria-labelledby="unit-tokens-title">
          <div className="settings-section-copy">
            <h2 id="unit-tokens-title">Unit tokens</h2>
            <p>Manage Unit (Worker) and integration access to Convex HTTP hooks.</p>
          </div>
          <button
            className="settings-action"
            aria-expanded={unitTokensExpanded}
            onClick={() => setUnitTokensExpanded((expanded) => !expanded)}
          >
            {unitTokensExpanded ? "Hide unit tokens" : "Manage unit tokens"}
          </button>
          {unitTokensExpanded && <UnitTokensView />}
        </section>}

        {serverProfile && <section className="settings-section settings-account" aria-labelledby="account-title">
          <div className="settings-section-copy">
            <h2 id="account-title">Account</h2>
            <p>Sign out of the account connected to this server.</p>
          </div>
          <button className="settings-action settings-sign-out" onClick={onSignOut}>
            <span aria-hidden="true">↪</span>
            <span>Sign out</span>
          </button>
        </section>}

        {error && <p className="settings-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

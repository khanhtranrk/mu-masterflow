import { useState } from "react";
import { SpecSidebar } from "./SpecSidebar";
import { SettingsView } from "./SettingsView";
import type { ConnectionSettings } from "../connectionSettings";
import "../settings.css";
import "../connections.css";

type DisconnectedRootProps = {
  settings: ConnectionSettings;
  onSaveSettings: (settings: ConnectionSettings) => Promise<void>;
  onConnectServer: (profileId: string) => Promise<void>;
  onDisconnectServer: () => Promise<void>;
  onSetDarkMode: (darkMode: boolean) => Promise<void>;
};

export function DisconnectedRoot({
  settings,
  onSaveSettings,
  onConnectServer,
  onDisconnectServer,
  onSetDarkMode,
}: DisconnectedRootProps) {
  const darkMode = settings.darkMode ?? false;
  const [error, setError] = useState("");

  async function toggleTheme() {
    try {
      await onSetDarkMode(!darkMode);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save appearance settings.");
    }
  }

  return (
    <div className={darkMode ? "desktop-shell dark" : "desktop-shell"}>
      <SpecSidebar
        specs={[]}
        connected={false}
        appAvailable={false}
        dark={darkMode}
        serverName="Not connected"
        specMenuSlug={null}
        notificationsActive={false}
        settingsActive
        notificationCount={0}
        onCreate={() => {}}
        onOpenNotifications={() => {}}
        onOpenSettings={() => {}}
        onOpen={() => {}}
        onToggleMenu={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
      <main className="work-area">
        <SettingsView
          serverProfile={null}
          serverSettings={settings}
          darkMode={darkMode}
          error={error}
          onSaveServerSettings={onSaveSettings}
          onConnectServer={onConnectServer}
          onDisconnectServer={onDisconnectServer}
          onToggleTheme={() => void toggleTheme()}
          onSignOut={() => {}}
        />
      </main>
    </div>
  );
}

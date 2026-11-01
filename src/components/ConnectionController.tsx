import { useCallback, useEffect, useRef, useState } from "react";
import { ConvexReactClient } from "convex/react";
import {
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettings,
  type ConvexServerProfile,
} from "../connectionSettings";
import { DisconnectedRoot } from "./DisconnectedRoot";
import { LoginServerDialog } from "./LoginServerDialog";
import "../connections.css";

type ConnectionControllerProps = {
  children: (
    client: ConvexReactClient,
    profile: ConvexServerProfile,
    onManageServers: () => void,
    darkMode: boolean,
    onSetDarkMode: (darkMode: boolean) => Promise<void>,
    settings: ConnectionSettings,
    onSaveSettings: (settings: ConnectionSettings) => Promise<void>,
    onConnectServer: (profileId: string) => Promise<void>,
    onDisconnectServer: () => Promise<void>,
  ) => React.ReactNode;
};

export function ConnectionController({ children }: ConnectionControllerProps) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(null);
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const settingsRef = useRef<ConnectionSettings | null>(null);
  const clientRef = useRef<ConvexReactClient | null>(null);
  const loadAttempt = useRef(0);

  const load = useCallback(async () => {
    const attempt = ++loadAttempt.current;
    setLoading(true);
    setLoadError("");
    try {
      const loaded = await loadConnectionSettings();
      if (attempt !== loadAttempt.current) return;
      setSettings(loaded);
      settingsRef.current = loaded;
      if (loaded.activeProfileId) {
        const profile = loaded.profiles.find((item) => item.id === loaded.activeProfileId);
        if (profile) {
          setClient(new ConvexReactClient(profile.clientUrl));
        }
        else {
          const disconnected = { ...loaded, activeProfileId: null };
          await saveConnectionSettings(disconnected);
          if (attempt !== loadAttempt.current) return;
          setSettings(disconnected);
          settingsRef.current = disconnected;
        }
      }
    } catch (reason) {
      if (attempt !== loadAttempt.current) return;
      setLoadError(reason instanceof Error ? reason.message : "Could not load saved Convex servers.");
    } finally {
      if (attempt === loadAttempt.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const previous = clientRef.current;
    if (previous === client) return;
    clientRef.current = client;
    previous?.close();
  }, [client]);

  useEffect(() => () => {
    clientRef.current?.close();
    clientRef.current = null;
  }, []);

  const persist = useCallback(async (next: ConnectionSettings) => {
    const wasConnected = Boolean(settingsRef.current?.activeProfileId);
    await saveConnectionSettings(next);
    settingsRef.current = next;
    setSettings(next);
    if (wasConnected && !next.activeProfileId) setClient(null);
  }, []);

  const setDarkMode = useCallback(async (darkMode: boolean) => {
    const current = settingsRef.current;
    if (!current) throw new Error("Server settings are still loading.");
    await persist({ ...current, darkMode });
  }, [persist]);

  const connect = useCallback(async (profileId: string) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;
    const profile = currentSettings.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error("The selected Convex server no longer exists.");
    const next = { ...currentSettings, activeProfileId: profileId };
    await persist(next);
    setClient(new ConvexReactClient(profile.clientUrl));
    setManagerOpen(false);
  }, [persist]);

  const logout = useCallback(async () => {
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;
    await persist({ ...currentSettings, activeProfileId: null });
    setManagerOpen(false);
  }, [persist]);

  const activeProfile = settings?.profiles.find((item) => item.id === settings.activeProfileId);

  if (loading) {
    return <div className="connection-page"><div className="connection-card"><p>Loading saved Convex servers…</p></div></div>;
  }
  if (loadError) {
    return (
      <div className="connection-page">
        <div className="connection-card">
          <h1>Could not load Convex servers</h1>
          <p className="connection-error">{loadError}</p>
          <button className="connection-primary" onClick={() => void load()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!settings) return null;

  if (!activeProfile || !client) {
    return (
      <DisconnectedRoot
        settings={settings}
        onSaveSettings={persist}
        onConnectServer={connect}
        onDisconnectServer={logout}
        onSetDarkMode={setDarkMode}
      />
    );
  }

  return (
    <>
      {children(
        client,
        activeProfile,
        () => setManagerOpen(true),
        settings.darkMode ?? false,
        setDarkMode,
        settings,
        persist,
        connect,
        logout,
      )}
      {managerOpen && (
        <LoginServerDialog
          settings={settings}
          darkMode={settings.darkMode ?? false}
          onSave={persist}
          onConnect={connect}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { AuthenticatedRoot } from "./components/AuthenticatedRoot";
import { ConnectionController } from "./components/ConnectionController";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConnectionController>
      {(client, profile, onManageServers, _onRememberAccount, _onForgetAccount, darkMode, onSetDarkMode, serverSettings, onSaveServerSettings, onConnectServer, onDisconnectServer) => (
        <ClerkConnection client={client} profileKey={`${profile.id}:${profile.clientUrl}`}>
          <AuthenticatedRoot
            serverProfile={profile}
            onManageServers={onManageServers}
            darkMode={darkMode}
            onSetDarkMode={onSetDarkMode}
            serverSettings={serverSettings}
            onSaveServerSettings={onSaveServerSettings}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
          />
        </ClerkConnection>
      )}
    </ConnectionController>
  </React.StrictMode>,
);

function ClerkConnection({ client, profileKey, children }: {
  client: import("convex/react").ConvexReactClient;
  profileKey: string;
  children: React.ReactNode;
}) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) return (
    <div className="connection-page"><div className="connection-card" role="alert">
      <h1>Sign-in is not configured</h1>
      <p>Set the Clerk publishable key for this app and restart it.</p>
    </div></div>
  );
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ConvexProviderWithClerk client={client} useAuth={useAuth} key={profileKey}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AuthenticatedRoot } from "./components/AuthenticatedRoot";
import { ConnectionController } from "./components/ConnectionController";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConnectionController>
      {(client, profile, onManageServers, onRememberAccount, onForgetAccount, darkMode, onSetDarkMode, serverSettings, onSaveServerSettings, onConnectServer, onDisconnectServer) => (
        <ConvexAuthProvider client={client} key={`${profile.id}:${profile.clientUrl}`}>
          <AuthenticatedRoot
            serverProfile={profile}
            onManageServers={onManageServers}
            onRememberAccount={onRememberAccount}
            onForgetAccount={onForgetAccount}
            darkMode={darkMode}
            onSetDarkMode={onSetDarkMode}
            serverSettings={serverSettings}
            onSaveServerSettings={onSaveServerSettings}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
          />
        </ConvexAuthProvider>
      )}
    </ConnectionController>
  </React.StrictMode>,
);

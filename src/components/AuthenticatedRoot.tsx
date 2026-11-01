import { SignIn, useAuth, useClerk } from "@clerk/react";
import { useConvexAuth, useQueries } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { ConvexServerProfile, ConnectionSettings } from "../connectionSettings";
import App from "../App";

type AuthenticatedRootProps = {
  serverProfile: ConvexServerProfile;
  onManageServers: () => void;
  darkMode: boolean;
  onSetDarkMode: (darkMode: boolean) => Promise<void>;
  serverSettings: ConnectionSettings;
  onSaveServerSettings: (settings: ConnectionSettings) => Promise<void>;
  onConnectServer: (profileId: string) => Promise<void>;
  onDisconnectServer: () => Promise<void>;
};

const accessQuery = { access: { query: api.auth.access, args: {} } };
const noQueries = {};

export function AuthenticatedRoot(props: AuthenticatedRootProps) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { access } = useQueries(isAuthenticated ? accessQuery : noQueries);
  const loading = isLoading || !isLoaded || (isAuthenticated && access === undefined);
  if (!loading && isAuthenticated && access === "allowed") return <App {...props} />;
  return (
    <div className={`connection-page${props.darkMode ? " dark" : ""}`}>
      <section className="connection-card auth-card">
        <h1>{loading ? "Checking access…" : !isSignedIn ? "Sign in" : "Access unavailable"}</h1>
        <div className="auth-server-summary">
          <span>{props.serverProfile.name}</span>
          <button className="subtle-button" onClick={props.onManageServers}>Change server</button>
        </div>
        {!loading && !isSignedIn && <SignIn routing="hash" appearance={{ elements: { rootBox: { width: "100%", marginTop: "16px" }, cardBox: { width: "100%" } } }} />}
        {!loading && isSignedIn && <>
          <p role="alert">{access instanceof Error
            ? "Could not check access. Check the server connection and backend version, then try again."
            : isAuthenticated
            ? "Your account has not been granted access to this server. Contact the administrator."
            : "Your sign-in could not be verified by this server. Check its Clerk configuration or try signing in again."}</p>
          <button className="subtle-button" onClick={() => void signOut()}>Sign out</button>
        </>}
      </section>
    </div>
  );
}

import { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { ConvexServerProfile } from "../connectionSettings";
import type { ConnectionSettings } from "../connectionSettings";
import App from "../App";

type AuthenticatedRootProps = {
  serverProfile: ConvexServerProfile;
  onManageServers: () => void;
  onRememberAccount: (email: string) => Promise<void>;
  onForgetAccount: (email: string) => Promise<void>;
  darkMode: boolean;
  onSetDarkMode: (darkMode: boolean) => Promise<void>;
  serverSettings: ConnectionSettings;
  onSaveServerSettings: (settings: ConnectionSettings) => Promise<void>;
  onConnectServer: (profileId: string) => Promise<void>;
  onDisconnectServer: () => Promise<void>;
};

export function AuthenticatedRoot({
  serverProfile,
  onManageServers,
  onRememberAccount,
  onForgetAccount,
  darkMode,
  onSetDarkMode,
  serverSettings,
  onSaveServerSettings,
  onConnectServer,
  onDisconnectServer,
}: AuthenticatedRootProps) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return <div className={`connection-page${darkMode ? " dark" : ""}`}><div className="connection-card"><p>Checking sign-in…</p></div></div>;
  }
  if (!isAuthenticated) {
    return (
      <SignInForm
        serverProfile={serverProfile}
        onManageServers={onManageServers}
        onRememberAccount={onRememberAccount}
        onForgetAccount={onForgetAccount}
        darkMode={darkMode}
      />
    );
  }
  return (
    <App
      serverProfile={serverProfile}
      darkMode={darkMode}
      onSetDarkMode={onSetDarkMode}
      serverSettings={serverSettings}
      onSaveServerSettings={onSaveServerSettings}
      onConnectServer={onConnectServer}
      onDisconnectServer={onDisconnectServer}
    />
  );
}

type SignInFormProps = {
  serverProfile: ConvexServerProfile;
  onManageServers: () => void;
  onRememberAccount: (email: string) => Promise<void>;
  onForgetAccount: (email: string) => Promise<void>;
  darkMode: boolean;
};

function SignInForm({ serverProfile, onManageServers, onRememberAccount, onForgetAccount, darkMode }: SignInFormProps) {
  const { signIn } = useAuthActions();
  const registrationAvailable = useQuery(api.auth.registrationAvailable, {});
  const accounts = serverProfile.accounts ?? [];
  const [email, setEmail] = useState(accounts[0] ?? "");
  const [selectedAccount, setSelectedAccount] = useState(accounts[0] ?? "");
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgetting, setForgetting] = useState(false);
  const activeFlow = registrationAvailable === true ? flow : "signIn";

  async function forgetSelectedAccount() {
    if (!email || !window.confirm(`Forget the saved account ${email} for this server?`)) return;
    setForgetting(true);
    setError("");
    try {
      await onForgetAccount(email);
      setEmail("");
      setSelectedAccount("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not forget this account.");
    } finally {
      setForgetting(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (activeFlow === "signUp" && password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      if (activeFlow === "signUp" && password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      const normalizedEmail = email.trim().toLowerCase();
      await signIn("password", { email: normalizedEmail, password, flow: activeFlow });
      await onRememberAccount(normalizedEmail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`connection-page${darkMode ? " dark" : ""}`}>
      <section className="connection-card auth-card" aria-labelledby="auth-title">
        <header className="view-heading auth-view-heading">
          <div>
            <span className="view-kicker">MASTERFLOW · {serverProfile.name.toUpperCase()}</span>
            <h1 id="auth-title">{activeFlow === "signIn" ? "Sign in" : "Create account"}</h1>
            <p>Sign in to the account connected to this Convex server.</p>
          </div>
        </header>
        <div className="auth-server-summary">
          <span>{serverProfile.clientUrl}</span>
          <button type="button" className="subtle-button" onClick={onManageServers}>Change server</button>
        </div>
        {registrationAvailable === true ? (
          <div className="auth-mode-tabs" role="tablist" aria-label="Account action">
            <button
              type="button"
              role="tab"
              aria-selected={activeFlow === "signIn"}
              className={activeFlow === "signIn" ? "selected" : ""}
              onClick={() => { setFlow("signIn"); setError(""); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFlow === "signUp"}
              className={activeFlow === "signUp" ? "selected" : ""}
              onClick={() => { setFlow("signUp"); setError(""); }}
            >
              Create the first account
            </button>
          </div>
        ) : registrationAvailable === undefined ? (
          <p className="auth-loading">Checking account availability…</p>
        ) : null}
        <form className="auth-admin-card auth-form" onSubmit={(event) => void submit(event)}>
          <div>
            <b>{activeFlow === "signIn" ? "Account credentials" : "Create the first account"}</b>
            <p>{activeFlow === "signIn" ? "Use the email and password for this server." : "This server allows a single account."}</p>
          </div>
          <div className="auth-login-fields">
            {accounts.length > 0 && (
              <label>
                Saved account
                <select
                  value={selectedAccount}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedAccount(value);
                    setEmail(value === "__other__" ? "" : value);
                  }}
                >
                  {accounts.map((account) => <option value={account} key={account}>{account}</option>)}
                  <option value="__other__">Use another account…</option>
                </select>
              </label>
            )}
            <label>
              Email
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  const normalizedValue = event.target.value.trim().toLowerCase();
                  setSelectedAccount(accounts.find((account) => account.toLowerCase() === normalizedValue) ?? "__other__");
                }}
                required
              />
            </label>
            <label>
              Password
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {activeFlow === "signUp" && (
              <label>
                Confirm password
                <input
                  autoComplete="new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
            )}
          </div>
          {error && <p className="auth-inline-error" role="alert">{error}</p>}
          <button type="submit" className="request-button auth-submit" disabled={busy || registrationAvailable === undefined}>
            {busy ? "Please wait…" : activeFlow === "signIn" ? "Sign in" : "Create the first account"}
          </button>
          {flow === "signIn" && accounts.some((account) => account.toLowerCase() === email.toLowerCase()) && (
              <button type="button" className="subtle-button auth-forget-account" onClick={() => void forgetSelectedAccount()} disabled={forgetting}>
                {forgetting ? "Forgetting…" : "Forget this saved account"}
              </button>
          )}
        </form>
        <p className="auth-admin-note">
          Accounts on this server share access to the same data. Passwords are never saved by MasterFlow.
        </p>
      </section>
    </div>
  );
}

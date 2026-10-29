import { invoke, isTauri } from "@tauri-apps/api/core";

export type ConvexServerProfile = {
  id: string;
  name: string;
  clientUrl: string;
  siteUrl: string;
  accounts?: string[];
};

export type ConnectionSettings = {
  profiles: ConvexServerProfile[];
  activeProfileId: string | null;
  darkMode?: boolean;
};

const browserStorageKey = "mu-masterflow:convex-connections";

function defaultSiteUrl(clientUrl: string): string {
  try {
    const url = new URL(clientUrl);
    if (url.hostname.endsWith(".convex.cloud")) {
      url.hostname = `${url.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
    } else if (url.port && Number.isInteger(Number(url.port))) {
      url.port = String(Number(url.port) + 1);
    }
    return url.origin;
  } catch {
    return clientUrl;
  }
}

function readLegacyEnvironment(): ConnectionSettings {
  const clientUrl = import.meta.env.VITE_CONVEX_URL?.trim();
  if (!clientUrl) return { profiles: [], activeProfileId: null };

  const profile: ConvexServerProfile = {
    id: crypto.randomUUID(),
    name: "Imported server",
    clientUrl: validateServerUrl(clientUrl, "Imported client/API URL"),
    siteUrl: validateServerUrl(
      import.meta.env.VITE_CONVEX_SITE_URL?.trim() || defaultSiteUrl(clientUrl),
      "Imported HTTP site URL",
    ),
  };
  return { profiles: [profile], activeProfileId: profile.id };
}

export async function loadConnectionSettings(): Promise<ConnectionSettings> {
  let settings: ConnectionSettings;
  if (isTauri()) {
    settings = await invoke<ConnectionSettings>("load_connection_settings");
  } else {
    const saved = window.localStorage.getItem(browserStorageKey);
    settings = saved ? JSON.parse(saved) as ConnectionSettings : { profiles: [], activeProfileId: null };
  }

  if (settings.profiles.length > 0) return settings;
  const imported = readLegacyEnvironment();
  if (imported.profiles.length > 0) {
    await saveConnectionSettings(imported);
    return imported;
  }
  return settings;
}

export async function saveConnectionSettings(settings: ConnectionSettings): Promise<void> {
  if (isTauri()) {
    await invoke("save_connection_settings", { settings });
    return;
  }
  window.localStorage.setItem(browserStorageKey, JSON.stringify(settings));
}

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createConvexProfile(input: Omit<ConvexServerProfile, "id">): ConvexServerProfile {
  return { ...input, id: crypto.randomUUID() };
}

export function validateServerUrl(value: string, label: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not include credentials, a query, or a fragment.`);
  }
  return parsed.origin;
}

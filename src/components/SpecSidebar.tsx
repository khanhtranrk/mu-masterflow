import { ActionMenu } from "./ui/ActionMenu";
import type { SpecItem } from "../types";
import "../sidebar-connection.css";

type SpecSidebarProps = {
  specs: SpecItem[];
  invalidSpecSlugs?: ReadonlySet<string>;
  activeSpec?: SpecItem;
  connected: boolean;
  appAvailable?: boolean;
  dark: boolean;
  serverName: string;
  specMenuSlug: string | null;
  activityActive?: boolean;
  onOpenActivity?: () => void;
  notificationsActive: boolean;
  settingsActive: boolean;
  notificationCount: number;
  onCreate: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onOpen: (spec: SpecItem) => void;
  onToggleMenu: (slug: string) => void;
  onRename: (spec: SpecItem) => void;
  onDelete: (spec: SpecItem) => void;
};

export function SpecSidebar({
  specs,
  invalidSpecSlugs,
  activeSpec,
  connected,
  appAvailable = true,
  serverName,
  specMenuSlug,
  activityActive = false,
  onOpenActivity,
  notificationsActive,
  settingsActive,
  notificationCount,
  onCreate,
  onOpenNotifications,
  onOpenSettings,
  onOpen,
  onToggleMenu,
  onRename,
  onDelete,
}: SpecSidebarProps) {
  return (
    <aside className="space-sidebar">
      <div className="desktop-brand">
        <span className="brand-icon">m</span>
        <span>MasterFlow</span>
        <span
          className={`server-name-badge ${connected ? "connected" : "disconnected"}`}
          title={`${serverName} · ${connected ? "Connected" : appAvailable ? "Connecting" : "Disconnected"}`}
          aria-label={`Convex server: ${serverName}`}
        >
          {serverName}
        </span>
      </div>
      <button className="new-space-button" onClick={onCreate} disabled={!appAvailable}><span>＋</span> New spec</button>
      <div className="spaces-heading">SPECS <span>{specs.length}</span></div>
      <div className="space-list">
        {specs.map((spec) => {
          const selected = activeSpec?.slug === spec.slug;
          return (
            <div key={spec.slug} className={`space-entry ${selected ? "selected" : ""}`}>
              <button className={`space-item ${selected ? "selected" : ""}`} onClick={() => onOpen(spec)}>
                <span className={`space-mark ${spec.color}`}>{spec.name.slice(0, 1).toUpperCase()}</span>
                <span className="space-name">{spec.name}</span>
                {invalidSpecSlugs?.has(spec.slug) && <span className="spec-validation-indicator sidebar-spec-warning" role="img" aria-label="Saved spec contains errors" title="Saved spec contains errors. Open YAML to inspect Problems.">⚠</span>}
              </button>
              <ActionMenu open={specMenuSlug === spec.slug} onOpenChange={next => { if (next !== (specMenuSlug === spec.slug)) onToggleMenu(spec.slug); }} label={`Actions for ${spec.name}`}
                trigger={<button className="space-menu-trigger" aria-label={`Actions for ${spec.name}`} title="Spec actions">···</button>}
                actions={[
                  { label: "Rename", onSelect: () => onRename(spec) },
                  { label: "Archive spec", danger: true, separator: true, onSelect: () => onDelete(spec) },
                ]} />
            </div>
          );
        })}
      </div>
      {specs.length === 0 && <div className="sidebar-empty">{appAvailable ? "Create a spec to get started." : "Connect a server to load specs."}</div>}
      <div className="sidebar-bottom">
        {appAvailable && <button className={`theme-button sidebar-utility-nav ${activityActive ? "selected" : ""}`} onClick={onOpenActivity}>
          <span aria-hidden="true">◉</span> Activity
        </button>}
        {appAvailable && <button className={`theme-button sidebar-utility-nav ${notificationsActive ? "selected" : ""}`} onClick={onOpenNotifications}>
          <span aria-hidden="true">♧</span> Notifications
          {notificationCount > 0 && <span className="sidebar-notification-count">{notificationCount > 99 ? "99+" : notificationCount}</span>}
        </button>}
        <button className={`theme-button sidebar-utility-nav ${settingsActive ? "selected" : ""}`} onClick={onOpenSettings}><span>⚙</span> Settings</button>
      </div>
    </aside>
  );
}

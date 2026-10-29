import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SpecItem } from "../types";
import "../sidebar-connection.css";

type SpecSidebarProps = {
  specs: SpecItem[];
  activeSpec?: SpecItem;
  connected: boolean;
  appAvailable?: boolean;
  dark: boolean;
  serverName: string;
  specMenuSlug: string | null;
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
  activeSpec,
  connected,
  appAvailable = true,
  dark,
  serverName,
  specMenuSlug,
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
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!specMenuSlug) return;
    const menuSlug = specMenuSlug;

    function dismissMenu(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && (target.closest(".space-menu") || target.closest(".space-menu-trigger"))) return;
      onToggleMenu(menuSlug);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggleMenu(menuSlug);
    }

    document.addEventListener("pointerdown", dismissMenu);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [specMenuSlug, onToggleMenu]);

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
              </button>
              <button
                className="space-menu-trigger"
                aria-label={`Actions for ${spec.name}`}
                title="Spec actions"
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenuPosition({
                    top: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 78)),
                    right: Math.max(8, window.innerWidth - bounds.right + 3),
                  });
                  onToggleMenu(spec.slug);
                }}
              >
                ···
              </button>
              {specMenuSlug === spec.slug && menuPosition && createPortal(
                <div className={`space-menu ${dark ? "dark" : ""}`} style={menuPosition}>
                  <button onClick={() => onRename(spec)}>Rename</button>
                  <button className="danger" onClick={() => onDelete(spec)}>Archive spec</button>
                </div>,
                document.body,
              )}
            </div>
          );
        })}
      </div>
      {specs.length === 0 && <div className="sidebar-empty">{appAvailable ? "Create a spec to get started." : "Connect a server to load specs."}</div>}
      <div className="sidebar-bottom">
        {appAvailable && <button className={`theme-button sidebar-utility-nav ${notificationsActive ? "selected" : ""}`} onClick={onOpenNotifications}>
          <span aria-hidden="true">♧</span> Notifications
          {notificationCount > 0 && <span className="sidebar-notification-count">{notificationCount > 99 ? "99+" : notificationCount}</span>}
        </button>}
        <button className={`theme-button sidebar-utility-nav ${settingsActive ? "selected" : ""}`} onClick={onOpenSettings}><span>⚙</span> Settings</button>
      </div>
    </aside>
  );
}

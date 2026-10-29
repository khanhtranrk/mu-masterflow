import type { SpecItem } from "../types";

type SpaceSidebarProps = {
  specs: SpecItem[];
  activeSpec?: SpecItem;
  connected: boolean;
  dark: boolean;
  spaceMenuSlug: string | null;
  onCreate: () => void;
  onOpen: (spec: SpecItem) => void;
  onToggleMenu: (slug: string) => void;
  onRename: (spec: SpecItem) => void;
  onDelete: (spec: SpecItem) => void;
  onToggleTheme: () => void;
};

export function SpaceSidebar({
  specs,
  activeSpec,
  connected,
  dark,
  spaceMenuSlug,
  onCreate,
  onOpen,
  onToggleMenu,
  onRename,
  onDelete,
  onToggleTheme,
}: SpaceSidebarProps) {
  return (
    <aside className="space-sidebar">
      <div className="desktop-brand">
        <span className="brand-icon">m</span>
        <span>MasterFlow</span>
        <span className={connected ? "connection-dot connected" : "connection-dot"} title={connected ? "Connected to Convex" : "Connecting to Convex"} />
      </div>
      <button className="new-space-button" onClick={onCreate}><span>＋</span> New spec</button>
      <div className="spaces-heading">SPACES <span>{specs.length}</span></div>
      <div className="space-list">
        {specs.map((spec) => {
          const selected = activeSpec?.slug === spec.slug;
          return (
            <div key={spec.slug} className={`space-entry ${selected ? "selected" : ""}`}>
              <button className={`space-item ${selected ? "selected" : ""}`} onClick={() => onOpen(spec)}>
                <span className={`space-mark ${spec.color}`}>{spec.name.slice(0, 1).toUpperCase()}</span>
                <span className="space-name">{spec.name}</span>
              </button>
              <button className="space-menu-trigger" aria-label={`Actions for ${spec.name}`} title="Space actions" onClick={() => onToggleMenu(spec.slug)}>···</button>
              {spaceMenuSlug === spec.slug && (
                <div className="space-menu">
                  <button onClick={() => onRename(spec)}>Rename</button>
                  <button className="danger" onClick={() => onDelete(spec)}>Delete space</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {specs.length === 0 && <div className="sidebar-empty">Create a spec to start a space.</div>}
      <div className="sidebar-bottom">
        <div className="sidebar-status">{connected ? "Convex connected" : "Connecting to Convex"}</div>
        <button className="theme-button" onClick={onToggleTheme}><span>{dark ? "☼" : "☾"}</span> {dark ? "Light appearance" : "Dark appearance"}</button>
      </div>
    </aside>
  );
}

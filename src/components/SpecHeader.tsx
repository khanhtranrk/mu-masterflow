import type { ConfigTab, SpecItem } from "../types";
import { tabs } from "../specUtils";

type SpecHeaderProps = {
  spec: SpecItem;
  dirty: boolean;
  saving: boolean;
  error: string;
  hasPipeline: boolean;
  onSave: () => void;
  onNewRequest: () => void;
};

export function SpecHeader({ spec, dirty, saving, error, hasPipeline, onSave, onNewRequest }: SpecHeaderProps) {
  return (
    <header className="work-header">
      <div className="space-heading">
        <span className={`space-mark large ${spec.color}`}>{spec.name.slice(0, 1).toUpperCase()}</span>
        <div><h1>{spec.name}</h1><p>{spec.description || spec.slug}</p></div>
      </div>
      <div className="header-actions">
        {dirty && <span className="unsaved-label">Unsaved changes</span>}
        <button className="save-button" onClick={onSave} disabled={!dirty || saving || Boolean(error)}>{saving ? "Saving…" : "Save changes"}</button>
        <button className="request-button" onClick={onNewRequest} disabled={!hasPipeline} title={dirty ? "Save a valid spec before creating requests" : undefined}>＋ New request</button>
      </div>
    </header>
  );
}

export function SectionTabs({
  activeTab,
  requestCount,
  onChange,
}: {
  activeTab: ConfigTab;
  requestCount: number;
  onChange: (tab: ConfigTab) => void;
}) {
  return (
    <nav className="section-tabs" aria-label="Spec sections">
      {tabs.map((tab) => (
        <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.id === "requests" && requestCount > 0 && <span className="tab-count">{requestCount}</span>}
        </button>
      ))}
    </nav>
  );
}

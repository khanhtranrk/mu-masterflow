import { Input, Textarea } from "./ui/Input";
import type { ChangeEvent } from "react";

type WorkloadsEditorProps = {
  names: string[];
  currentName: string;
  config: Record<string, any>;
  draft: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onChangeDraft: (value: string) => void;
  onChangeField: (field: "target" | "units", value: string | number) => void;
};

export function WorkloadsEditor({ names, currentName, config, draft, onSelect, onAdd, onRemove, onChangeDraft, onChangeField }: WorkloadsEditorProps) {
  return (
    <section className="editor-view">
      <div className="view-heading">
        <div><span className="view-kicker">EXECUTABLES</span><h2>Workloads</h2><p>Reusable subprocess commands called through node run.workload.</p></div>
        <button className="subtle-button" onClick={onAdd}>＋ Add workload</button>
      </div>
      {names.length > 0 ? (
        <div className="workload-layout">
          <div className="workload-list">
            {names.map((name) => <button key={name} className={name === currentName ? "chosen" : ""} onClick={() => onSelect(name)}><span className="workload-glyph">⌘</span>{name}</button>)}
          </div>
          <div className="workload-detail">
            <div className="workload-detail-title"><b>{currentName}</b><button className="icon-action" onClick={onRemove} aria-label="Remove workload">×</button></div>
            <div className="field-row">
              <label>Target<Input value={String(config.target ?? "")} onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeField("target", event.target.value)} placeholder="/path/to/executable" /></label>
              <label>GPU units (4 GiB)<Input type="number" min="0" step="any" value={Number(config.units ?? 0)} onChange={(event: ChangeEvent<HTMLInputElement>) => onChangeField("units", Number(event.target.value))} /></label>
            </div>
            <label className="advanced-label">
              Full workload definition
              <small>Declare params, target, argv args, env, device_args and units. units: 0 is CPU-only; use schedule templates only in device_args.</small>
              <Textarea aria-label="Full workload definition" className="code-editor workload-code" spellCheck={false} value={draft} onChange={(event) => onChangeDraft(event.target.value)} />
            </label>
          </div>
        </div>
      ) : (
        <div className="empty-editor">
          <span>⌘</span><b>No workloads yet</b><small>Add a workload that pipeline steps can call.</small>
          <button className="subtle-button" onClick={onAdd}>Add a workload</button>
        </div>
      )}
    </section>
  );
}

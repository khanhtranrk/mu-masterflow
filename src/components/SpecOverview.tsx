import { useState } from "react";
import { asObject } from "../specUtils";
import type { PipelineNode } from "../types";
import { DependencyGraph } from "./DependencyGraph";

// Render arbitrary YAML fields, including extensions, without imposing an editor schema.
function Value({ value, depth = 0, ancestors = [] }: { value: unknown; depth?: number; ancestors?: unknown[] }) {
  if (value === null || typeof value !== "object") return <code className="overview-value">{value === null ? "null" : String(value)}</code>;
  if (ancestors.includes(value)) return <code className="overview-value">↩ YAML alias</code>;
  const items = Object.entries(value);
  if (!items.length) return <span className="overview-empty">{Array.isArray(value) ? "No items" : "No fields"}</span>;
  if (depth > 12) return <span className="overview-empty">Open YAML to inspect deeper fields.</span>;
  return <div className={Array.isArray(value) ? "overview-sequence" : "overview-fields"}>
    {items.map(([key, item]) => {
      const complex = item !== null && typeof item === "object";
      const itemType = asObject(item).type;
      const label = Array.isArray(value) ? `${Number(key) + 1}${typeof itemType === "string" ? ` · ${itemType}` : " · item"}` : key;
      const kind = /condition|skip_if/.test(key) ? "condition" : /before_run|after_run|finally|prepare|initialization|finalization/.test(key) ? "action" : "field";
      return <div key={key} className={`overview-field overview-${kind}`}>
        {complex ? <details open={depth < 2}><summary>{label}<small>{Array.isArray(item) ? `${item.length} items` : "configuration"}</small></summary><Value value={item} depth={depth + 1} ancestors={[...ancestors, value]} /></details>
          : <><span className="overview-key">{label}</span><Value value={item} depth={depth + 1} /></>}
      </div>;
    })}
  </div>;
}

export function SpecOverview({ document, stale, dirty, onOpenYaml }: { document: Record<string, any>; stale: boolean; dirty: boolean; onOpenYaml: () => void }) {
  const pipelines = asObject(document.pipeline);
  const names = Object.keys(pipelines);
  const [selection, setSelection] = useState("");
  const [nodeSelection, setNodeSelection] = useState("");
  const name = names.includes(selection) ? selection : names[0] ?? "";
  const config = asObject(pipelines[name]);
  const nodes: PipelineNode[] = Array.isArray(config.nodes) ? config.nodes.filter((node: unknown): node is PipelineNode => typeof asObject(node).name === "string") : [];
  const selected = nodes.find(node => node.name === nodeSelection) ?? nodes[0];
  const workloads = asObject(document.workloads);
  const { nodes: _nodes, ...pipelineFields } = config;
  const extra = Object.fromEntries(Object.entries(document).filter(([key]) => !["entries", "pipeline", "workloads"].includes(key)));
  return <section className="spec-overview">
    <div className="view-heading"><div><span className="view-kicker">SPEC MAP · {dirty ? "UNSAVED DRAFT" : "SAVED SPEC"}</span><h2>Overview</h2><p>Explore the flow lifecycle, dependencies and configuration. Select a node to inspect its actions and conditions.</p></div><button className="subtle-button" onClick={onOpenYaml}>Edit YAML ↗</button></div>
    {stale && <p className="overview-warning" role="status">YAML contains an error. Showing the last valid document until it is fixed.</p>}
    <div className="overview-stats">{[[names.length, "Pipelines"], [Object.keys(workloads).length, "Workloads"], [Object.keys(asObject(document.entries)).length, "Entries"]].map(([count, label]) => <div key={label}><b>{count}</b><span>{label}</span></div>)}</div>
    <section className="overview-section"><div className="overview-section-heading"><h3>Entries</h3><p>Initialization → pipeline execution → finalization</p></div>
      <div className="overview-entry-grid">{Object.entries(asObject(document.entries)).map(([entry, value]) => <article className="overview-card" key={entry}><h4>{entry}</h4><Value value={value} /></article>)}</div>
      {!Object.keys(asObject(document.entries)).length && <p className="overview-empty">No entries defined.</p>}
    </section>
    <section className="overview-section"><div className="overview-section-heading"><h3>Pipelines</h3><p>Arrows represent depends_on. Independent branches can run in parallel.</p></div>
      <div className="overview-pipelines" aria-label="Choose pipeline">{names.map(item => <button className={item === name ? "chosen" : ""} aria-pressed={item === name} key={item} onClick={() => { setSelection(item); setNodeSelection(""); }}>{item}</button>)}</div>
      {name ? <><div className="overview-graph-layout"><div className="overview-card overview-graph"><h4>{name} <small>{nodes.length} nodes</small></h4>{nodes.length ? <DependencyGraph nodes={nodes} selected={selected?.name ?? ""} onSelect={setNodeSelection} /> : <p className="overview-empty">No nodes defined.</p>}</div><aside className="overview-card overview-inspector"><span className="view-kicker">SELECTED NODE</span><h4>{selected?.name ?? "No node selected"}</h4>{selected && <Value key={`${name}:${selected.name}`} value={selected} />}</aside></div>
        <details className="overview-card overview-pipeline-config" open><summary>Pipeline configuration <small>Parameters · context · preparation · custom fields</small></summary><Value key={name} value={pipelineFields} /></details></> : <p className="overview-empty">No pipelines defined.</p>}
    </section>
    <section className="overview-section"><div className="overview-section-heading"><h3>Workloads</h3><p>Execution targets, arguments, environment and device requirements.</p></div><div className="overview-entry-grid">{Object.entries(workloads).map(([key, value]) => <details className="overview-card" key={key}><summary>{key}</summary><Value value={value} /></details>)}</div>{!Object.keys(workloads).length && <p className="overview-empty">No workloads defined.</p>}</section>
    {Object.keys(extra).length > 0 && <section className="overview-section"><h3>Additional configuration</h3><Value value={extra} /></section>}
  </section>;
}

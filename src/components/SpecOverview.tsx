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
      const kind = /condition|skip_if/.test(key) ? "condition" : /^actions$|^run$|before_run|after_run|finally|prepare|initialization|finalization/.test(key) ? "action" : "field";
      return <div key={key} className={`overview-field overview-${kind}`}>
        {complex ? <details open={depth < 2}><summary>{label}<small>{Array.isArray(item) ? `${item.length} items` : "configuration"}</small></summary><Value value={item} depth={depth + 1} ancestors={[...ancestors, value]} /></details>
          : <><span className="overview-key">{label}</span><Value value={item} depth={depth + 1} /></>}
      </div>;
    })}
  </div>;
}

export function SpecOverview({ document, stale, onOpenYaml }: { document: Record<string, any>; stale: boolean; onOpenYaml: () => void }) {
  const pipelines = asObject(document.pipeline);
  const names = Object.keys(pipelines);
  const [selection, setSelection] = useState("");
  const [nodeSelection, setNodeSelection] = useState("");
  const name = names.includes(selection) ? selection : names[0] ?? "";
  const config = asObject(pipelines[name]);
  const nodes: PipelineNode[] = Array.isArray(config.nodes) ? config.nodes.filter((node: unknown): node is PipelineNode => typeof asObject(node).name === "string") : [];
  const selected = nodes.find(node => node.name === nodeSelection) ?? nodes[0];
  const routines = asObject(document.routines);
  const [routineSelection, setRoutineSelection] = useState("");
  const routineName = Object.prototype.hasOwnProperty.call(routines, routineSelection) ? routineSelection : Object.keys(routines)[0] ?? "";
  const routine = asObject(routines[routineName]);
  const calls: { name: string; path: string }[] = [];
  function findCalls(value: unknown, path: string, ancestors: unknown[] = []) {
    if (!value || typeof value !== "object" || ancestors.includes(value)) return;
    const item = asObject(value);
    if (item.type === "execute_routine" && typeof item.routine === "string") calls.push({ name: item.routine, path });
    Object.entries(value).forEach(([key, child]) => findCalls(child, `${path}.${key}`, [...ancestors, value]));
  }
  findCalls(document, "spec");
  const workloads = asObject(document.workloads);
  const { nodes: _nodes, ...pipelineFields } = config;
  const extra = Object.fromEntries(Object.entries(document).filter(([key]) => !["entries", "pipeline", "workloads", "routines"].includes(key)));
  return <section className="spec-overview">
    {stale && <p className="overview-warning" role="status">YAML contains an error. Showing the last valid document until it is fixed. <button className="subtle-button" onClick={onOpenYaml}>Edit YAML</button></p>}
    <section className="overview-section"><div className="overview-section-heading"><h3>Entries <span className="overview-count">{Object.keys(asObject(document.entries)).length}</span></h3><p>Initialization → pipeline execution → finalization</p></div>
      <div className="overview-entry-grid">{Object.entries(asObject(document.entries)).map(([entry, value]) => <article className="overview-card" key={entry}><h4>{entry}</h4><Value value={value} /></article>)}</div>
      {!Object.keys(asObject(document.entries)).length && <p className="overview-empty">No entries defined.</p>}
    </section>
    <section className="overview-section"><div className="overview-section-heading"><h3>Pipelines <span className="overview-count">{names.length}</span></h3><p>Arrows represent depends_on. Independent branches can run in parallel.</p></div>
      <div className="overview-pipelines" aria-label="Choose pipeline">{names.map(item => <button className={item === name ? "chosen" : ""} aria-pressed={item === name} key={item} onClick={() => { setSelection(item); setNodeSelection(""); }}><span>{item}</span><span className="overview-count">{Array.isArray(asObject(pipelines[item]).nodes) ? asObject(pipelines[item]).nodes.length : 0}</span></button>)}</div>
      {name ? <><div className="overview-graph-layout"><div className="overview-card overview-graph"><h4>Dependency graph <small>Select a node to inspect</small></h4>{nodes.length ? <DependencyGraph nodes={nodes} selected={selected?.name ?? ""} onSelect={setNodeSelection} /> : <p className="overview-empty">No nodes defined.</p>}</div><aside className="overview-card overview-inspector"><h4>{selected?.name ?? "No node selected"}</h4>{selected && <Value key={`${name}:${selected.name}`} value={selected} />}</aside></div>
        <details className="overview-card overview-pipeline-config" open><summary>Pipeline configuration <small>Parameters · context · preparation · custom fields</small></summary><Value key={name} value={pipelineFields} /></details></> : <p className="overview-empty">No pipelines defined.</p>}
    </section>
    <section className="overview-section"><div className="overview-section-heading"><h3>Workloads <span className="overview-count">{Object.keys(workloads).length}</span></h3><p>Execution targets, arguments, environment and device requirements.</p></div><div className="overview-entry-grid">{Object.entries(workloads).map(([key, value]) => <details className="overview-card" key={key}><summary>{key}</summary><Value value={value} /></details>)}</div>{!Object.keys(workloads).length && <p className="overview-empty">No workloads defined.</p>}</section>
    <section className="overview-section"><div className="overview-section-heading"><h3>Routines <span className="overview-count">{Object.keys(routines).length}</span></h3><p>Reusable action sequences. Calls run in an isolated context.</p><button className="subtle-button" onClick={onOpenYaml}>Edit YAML</button></div>
      <div className="overview-pipelines" aria-label="Choose routine">{Object.keys(routines).map(key => <button key={key} className={key === routineName ? "chosen" : ""} aria-pressed={key === routineName} onClick={() => setRoutineSelection(key)}>{key}<span className="overview-count">{Array.isArray(routines[key]?.actions) ? routines[key].actions.length : 0}</span></button>)}</div>
      {routineName ? <div className="overview-graph-layout"><article className="overview-card"><h4>{routineName} · Action sequence</h4>
        {Array.isArray(routine.actions) && routine.actions.length ? <ol className="routine-sequence">{routine.actions.map((action: unknown, index: number) => { const item = asObject(action); return <li key={index}><strong>{String(item.type ?? "Unknown action")}</strong>{item.type === "execute_routine" && <button className="subtle-button" disabled={!Object.prototype.hasOwnProperty.call(routines, item.routine)} onClick={() => setRoutineSelection(item.routine)}>→ {String(item.routine)}</button>}<Value value={action} /></li>; })}</ol> : <p className="overview-empty">No actions defined.</p>}
        </article><aside className="overview-card overview-inspector"><h4>Parameters and output</h4><Value value={Object.fromEntries(Object.entries(routine).filter(([key]) => key !== "actions"))} /><h4>Called from</h4>{calls.filter(call => call.name === routineName).map(call => <code className="overview-value" key={call.path}>{call.path}</code>)}{!calls.some(call => call.name === routineName) && <p className="overview-empty">No calls in this spec.</p>}</aside></div> : <p className="overview-empty">No routines defined.</p>}
    </section>
    {Object.keys(extra).length > 0 && <section className="overview-section"><h3>Additional configuration</h3><Value value={extra} /></section>}
  </section>;
}

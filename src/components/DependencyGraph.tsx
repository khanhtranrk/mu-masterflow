import type { NodeExecutionState, PipelineNode } from "../types";
import { asObject, layoutGraph, nodeDependencyNames } from "../specUtils";

type DependencyGraphProps = {
  nodes: PipelineNode[];
  selected: string;
  onSelect: (name: string) => void;
  nodeStates?: Record<string, NodeExecutionState>;
  readOnly?: boolean;
  interactive?: boolean;
};

const nodeLabels: Record<string, string> = {
  queue: "Queued",
  running: "Running",
  failed: "Failed",
  succeeded: "Succeeded",
  not_started: "Not started",
};

export function DependencyGraph({ nodes, selected, onSelect, nodeStates, readOnly = false, interactive = !readOnly }: DependencyGraphProps) {
  const { positions, width, height } = layoutGraph(nodes);
  const validNames = new Set(nodes.map((node) => String(node.name)));
  const runtimeView = nodeStates !== undefined || readOnly;

  return (
    <div className="graph-viewport">
      <div className="graph-canvas" style={{ width, height }}>
        <svg className="graph-edges" width={width} height={height} aria-hidden="true">
          <defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
          {nodes.flatMap((node) => nodeDependencyNames(node).filter((name) => validNames.has(name)).map((dependency) => {
            const from = positions.get(dependency);
            const to = positions.get(String(node.name));
            if (!from || !to) return null;
            const x1 = from.x + 190;
            const y1 = from.y + 42;
            const x2 = to.x;
            const y2 = to.y + 42;
            const bend = Math.max(35, (x2 - x1) / 2);
            return <path key={`${dependency}-${String(node.name)}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#graph-arrow)" />;
          }))}
        </svg>
        {nodes.map((node, index) => {
          const name = String(node.name || `node_${index + 1}`);
          const position = positions.get(name) ?? { x: 30, y: 34 };
          const run = node.run;
          const workload = asObject(run).workload;
          const runLabel = typeof workload === "string" ? workload : Array.isArray(run) ? `${run.length} actions` : run ? "Custom run" : "No run defined";
          const execution = nodeStates?.[name];
          const nodeStatus = execution?.status ?? (runtimeView ? "not_started" : "");

          return (
            <div
              key={`${name}-${index}`}
              className={`graph-node ${name === selected ? "selected" : ""} ${nodeStatus ? `execution-${nodeStatus}` : ""} ${interactive ? "" : "read-only"}`}
              style={{ left: position.x, top: position.y }}
              onClick={() => interactive && onSelect(name)}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={(event) => {
                if (interactive && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSelect(name);
                }
              }}
            >
              <span className="graph-node-index">{String(index + 1).padStart(2, "0")}</span>
              <b>{name}</b>
              <small>{runtimeView ? nodeLabels[nodeStatus] ?? "Not reported" : runLabel}</small>
              <span className="graph-node-meta">
                {runtimeView && execution?.device
                  ? `${execution.device.family ?? "device"} · ${execution.device.index ?? "?"}`
                  : runtimeView ? "No device reported" : nodeDependencyNames(node).length ? `← ${nodeDependencyNames(node).length} dependencies` : "Independent node"}
              </span>
            </div>
          );
        })}
        {nodes.length === 0 && <div className="graph-empty">No nodes in this pipeline yet.</div>}
      </div>
    </div>
  );
}

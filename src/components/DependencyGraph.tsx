import type { PipelineNode, RequestItem } from "../types";
import { asObject, layoutGraph, nodeDependencyNames } from "../specUtils";

type DependencyGraphProps = {
  nodes: PipelineNode[];
  selected: string;
  onSelect: (name: string) => void;
  plan?: RequestItem["plan"];
  readOnly?: boolean;
};

const nodeLabels: Record<string, string> = {
  queue: "Queued",
  running: "Running",
  failed: "Failed",
  succeeded: "Succeeded",
  not_started: "Not started",
};

export function DependencyGraph({ nodes, selected, onSelect, plan = [], readOnly = false }: DependencyGraphProps) {
  const { positions, width, height } = layoutGraph(nodes);
  const validNames = new Set(nodes.map((node) => String(node.name)));
  const planByNode = new Map(plan.map((item) => [item.nodeName, item]));

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
          const execution = planByNode.get(name);
          const nodeStatus = execution?.status ?? (plan.length ? "not_started" : "");

          return (
            <div
              key={`${name}-${index}`}
              className={`graph-node ${name === selected ? "selected" : ""} ${nodeStatus ? `execution-${nodeStatus}` : ""} ${readOnly ? "read-only" : ""}`}
              style={{ left: position.x, top: position.y }}
              onClick={() => !readOnly && onSelect(name)}
              role={readOnly ? undefined : "button"}
              tabIndex={readOnly ? undefined : 0}
              onKeyDown={(event) => {
                if (!readOnly && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSelect(name);
                }
              }}
            >
              <span className="graph-node-index">{String(index + 1).padStart(2, "0")}</span>
              <b>{name}</b>
              <small>{readOnly ? nodeLabels[nodeStatus] ?? "Not reported" : runLabel}</small>
              <span className="graph-node-meta">
                {readOnly && execution?.device
                  ? `${execution.device.family ?? "device"} · ${execution.device.index ?? "?"}`
                  : nodeDependencyNames(node).length ? `← ${nodeDependencyNames(node).length} dependencies` : "Independent node"}
              </span>
            </div>
          );
        })}
        {nodes.length === 0 && <div className="graph-empty">No nodes in this pipeline yet.</div>}
      </div>
    </div>
  );
}

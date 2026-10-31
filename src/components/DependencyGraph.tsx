import { Fragment, useEffect, useId, useRef } from "react";
import type { NodeExecutionState, PipelineNode } from "../types";
import { asObject, layoutGraph, nodeDependencyNames } from "../specUtils";

type DependencyGraphProps = {
  nodes: PipelineNode[];
  selected: string;
  onSelect: (name: string) => void;
  nodeStates?: Record<string, NodeExecutionState>;
  readOnly?: boolean;
  interactive?: boolean;
  artifactCounts?: Record<string, number>;
  artifactPanelId?: string;
  highlightedArtifactNode?: string;
  onShowArtifacts?: (name: string) => void;
};

const nodeLabels: Record<string, string> = {
  queue: "Queued",
  running: "Running",
  failed: "Failed",
  succeeded: "Succeeded",
  not_started: "Not started",
};

export function DependencyGraph({ nodes, selected, onSelect, nodeStates, readOnly = false, interactive = !readOnly, artifactCounts, artifactPanelId, highlightedArtifactNode, onShowArtifacts }: DependencyGraphProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const arrowId = useId();
  useEffect(() => {
    if (nodeStates === undefined) return;
    const element = Array.from(viewport.current?.querySelectorAll<HTMLElement>(".graph-node") ?? []).find(node => node.dataset.node === selected);
    if (element && viewport.current) {
      const container = viewport.current;
      container.scrollTo({ left: Math.max(0, element.offsetLeft - (container.clientWidth - element.offsetWidth) / 2), top: Math.max(0, element.offsetTop - (container.clientHeight - element.offsetHeight) / 2), behavior: "instant" });
    }
  }, [selected, nodeStates === undefined]);
  const { positions, width, height } = layoutGraph(nodes);
  const validNames = new Set(nodes.map((node) => String(node.name)));
  const runtimeView = nodeStates !== undefined || readOnly;

  return (
    <div className="graph-viewport" ref={viewport}>
      <div className="graph-canvas" style={{ width, height }}>
        <svg className="graph-edges" width={width} height={height} aria-hidden="true">
          <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
          {nodes.flatMap((node) => nodeDependencyNames(node).filter((name) => validNames.has(name)).map((dependency) => {
            const from = positions.get(dependency);
            const to = positions.get(String(node.name));
            if (!from || !to) return null;
            const x1 = from.x + 190;
            const y1 = from.y + 42;
            const x2 = to.x;
            const y2 = to.y + 42;
            const bend = Math.max(35, (x2 - x1) / 2);
            return <path key={`${dependency}-${String(node.name)}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} className={nodeStates ? `edge-${nodeStates[String(node.name)]?.status ?? "pending"}` : undefined} markerEnd={`url(#${arrowId})`} />;
          }))}
        </svg>
        {nodes.map((node, index) => {
          const name = String(node.name || `node_${index + 1}`);
          const position = positions.get(name) ?? { x: 30, y: 34 };
          const workloadNames = ["before_run", "run", "after_run"].flatMap(phase =>
            Array.isArray(node[phase]) ? node[phase].flatMap((action: unknown) => {
              const item = asObject(action);
              return item.type === "execute_workload" && typeof item.workload === "string" ? [item.workload] : [];
            }) : []);
          const runLabel = [...new Set(workloadNames)].join(" → ") || "Action-only node";
          const execution = nodeStates?.[name];
          const nodeStatus = execution?.status ?? (runtimeView ? "not_started" : "");

          const artifactCount = artifactCounts?.[name] ?? 0;
          return (
            <Fragment key={`${name}-${index}`}><div
              data-node={name}
              aria-label={`${name}${nodeStatus ? `: ${nodeLabels[nodeStatus] ?? nodeStatus}` : ""}`}
              aria-pressed={interactive ? name === selected : undefined}
              className={`graph-node ${name === selected ? "selected" : ""} ${nodeStatus ? `execution-${nodeStatus}` : ""} ${interactive ? "" : "read-only"} ${artifactCount && onShowArtifacts ? "has-artifacts" : ""}`}
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
                  : runtimeView ? runLabel : nodeDependencyNames(node).length ? `← ${nodeDependencyNames(node).length} dependencies` : "Independent node"}
              </span>
            </div>
            {artifactCount > 0 && onShowArtifacts && <button type="button" className="graph-artifact-count"
              style={{ left: position.x + 112, top: position.y + 59 }}
              aria-label={`Show ${artifactCount} ${artifactCount === 1 ? "artifact" : "artifacts"} from ${name}`} aria-controls={artifactPanelId}
              aria-pressed={highlightedArtifactNode === name} onClick={() => onShowArtifacts(name)}>
              {artifactCount} {artifactCount === 1 ? "artifact" : "artifacts"}
            </button>}
            </Fragment>
          );
        })}
        {nodes.length === 0 && <div className="graph-empty">No nodes in this pipeline yet.</div>}
      </div>
    </div>
  );
}

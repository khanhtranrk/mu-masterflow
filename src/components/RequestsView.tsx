import { useEffect, useRef, useState } from "react";
import type { PipelineNode, RequestItem } from "../types";
import { DependencyGraph } from "./DependencyGraph";
import { Status } from "./Status";

type RequestsViewProps = {
  pipelineNames: string[];
  currentPipelineName: string;
  requests: RequestItem[];
  canCreateRequest: boolean;
  pipelineNodes: PipelineNode[];
  selectedRequest: string | null;
  onSelectPipeline: (name: string) => void;
  onNewRequest: () => void;
  onEditRequest: (request: RequestItem) => void;
  onDuplicateRequest: (request: RequestItem) => void;
  onDeleteRequest: (request: RequestItem) => void;
};

function RequestExecution({ activeRequest, activeRequestPipelineNodes }: { activeRequest: RequestItem; activeRequestPipelineNodes: PipelineNode[] }) {
  const [selectedNode, setSelectedNode] = useState("");
  const [followExecution, setFollowExecution] = useState(true);
  const activeNodes = activeRequest?.nodeStates ?? {};
  const activeNodeNames = activeRequestPipelineNodes.map((node) => String(node.name));
  const runningNames = activeNodeNames.filter(name => activeNodes[name]?.status === "running");
  const failedNames = activeNodeNames.filter(name => activeNodes[name]?.status === "failed");
  const completedCount = activeNodeNames.filter(name => activeNodes[name]?.status === "succeeded").length;
  const focusNode = failedNames[0] ?? runningNames[0] ?? activeNodeNames.find(name => !activeNodes[name]?.status || activeNodes[name]?.status === "queue") ?? activeNodeNames[activeNodeNames.length - 1] ?? "";
  const activeNode = followExecution ? focusNode : activeNodeNames.includes(selectedNode) ? selectedNode : focusNode;
  const selectedNodeState = activeNodes[activeNode];

  return <div className="request-expanded">          <div className="request-execution-view">
            <div className="execution-toolbar"><div><b>{activeRequest.pipelineName || "Pipeline"}</b><small>Updates automatically as workers report</small></div><button className="subtle-button" aria-pressed={followExecution} onClick={() => setFollowExecution(!followExecution)}>{followExecution ? "◉ Following execution" : "Follow execution"}</button></div>
            <div className="execution-summary" aria-live="polite"><b>{completedCount} / {activeNodeNames.length} completed</b><span>{failedNames.length ? `${failedNames.length} failed · ${failedNames.join(", ")}` : runningNames.length ? `Running · ${runningNames.join(", ")}` : activeRequest.status === "waiting" ? "Waiting for a worker" : activeRequest.status === "succeeded" ? "Request completed" : "Waiting for worker updates"}</span></div>
            <progress className="execution-progress" value={completedCount} max={activeNodeNames.length || 1} aria-label="Completed pipeline nodes" />
            <DependencyGraph
              nodes={activeRequestPipelineNodes}
              selected={activeNode}
              onSelect={(name) => { setSelectedNode(name); setFollowExecution(false); }}
              nodeStates={activeNodes}
              interactive
            />
            {activeNode && (
              <div className="request-node-detail">
                <div className="request-node-heading">
                  <b>{activeNode}</b>
                  <Status status={selectedNodeState?.status ?? "not_reported"} />
                </div>
                {selectedNodeState?.device && (
                  <p className="request-node-device">Device · {selectedNodeState.device.family} {selectedNodeState.device.index}</p>
                )}
                {selectedNodeState?.artifacts && Object.keys(selectedNodeState.artifacts).length > 0 && (
                  <div className="request-node-section">
                    <b>Artifacts</b>
                    {Object.entries(selectedNodeState.artifacts).map(([name, artifact]) => (
                      <div className="request-artifact" key={name}><small>{name}</small><code>{artifact}</code></div>
                    ))}
                  </div>
                )}
                {selectedNodeState?.logs && selectedNodeState.logs.length > 0 && (
                  <div className="request-node-section">
                    <b>Logs</b>
                    <ol className="request-node-logs">{selectedNodeState.logs.map((log, index) => <li key={`${index}-${log}`}>{log}</li>)}</ol>
                  </div>
                )}
                {!selectedNodeState && <p className="request-node-empty">No runtime state has been reported for this node.</p>}
              </div>
            )}
          </div>

</div>;
}

function RequestActions({ request, open, onToggle, onClose, onEdit, onDuplicate, onDelete }: { request: RequestItem; open: boolean; onToggle: () => void; onClose: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, onClose]);
  return <div className="request-actions-dropdown" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose(); }}>
    <button ref={trigger} className="subtle-button request-manage-button" aria-label={`Actions for request ${request.title}`} aria-expanded={open} aria-controls={`actions-${request.convexId}`} onClick={onToggle}>•••</button>
    {open && <div className="request-actions-menu" id={`actions-${request.convexId}`}>
      <button disabled={request.status !== "waiting"} title={request.status !== "waiting" ? "Only waiting requests can be edited" : undefined} onClick={onEdit}>Edit</button>
      <button onClick={onDuplicate}>Duplicate</button>
      <button className="request-delete-action" onClick={onDelete}>Delete</button>
    </div>}
  </div>;
}

export function RequestsView({ pipelineNames, currentPipelineName, requests, canCreateRequest, pipelineNodes, selectedRequest, onSelectPipeline, onNewRequest, onEditRequest, onDuplicateRequest, onDeleteRequest }: RequestsViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionsId, setActionsId] = useState<string | null>(null);
  const filtered = requests.filter(request => (statusFilter === "all" || request.status === statusFilter) && `${request.title} ${request.id} ${request.convexId}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    if (selectedRequest) setExpanded(previous => ({ ...previous, [selectedRequest]: true }));
  }, [selectedRequest]);
  return <section className="editor-view requests-view request-hub request-accordion">
      <div className="view-heading">
        <div>
          <span className="view-kicker">RUNS</span>
          <h2>Requests</h2>
          <p>{currentPipelineName ? `${requests.length} requests · ${requests.filter(request => request.status === "waiting").length} waiting · ${currentPipelineName}` : "Save a pipeline to start creating requests."}</p>
        </div>
        <button className="request-button" onClick={onNewRequest} disabled={!currentPipelineName || !canCreateRequest}>＋ New request</button>
      </div>
      {pipelineNames.length > 1 && (
        <div className="pipeline-switcher request-pipelines">
          {pipelineNames.map((name) => <button key={name} className={currentPipelineName === name ? "chosen" : ""} onClick={() => onSelectPipeline(name)}>{name}</button>)}
        </div>
      )}
      <div className="request-filters"><label>Find a request<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or request ID" /></label><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{[...new Set(requests.map(request => request.status))].map(status => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}</select></label></div>
    <div className="request-monitor-list">
      {filtered.map(request => {
        const open = expanded[request.convexId] ?? (request.status === "processing" || request.status === "possessed");
        const completed = pipelineNodes.filter(node => request.nodeStates[node.name]?.status === "succeeded").length;
        const active = Object.entries(request.nodeStates).filter(([, state]) => state.status === "running" || state.status === "failed");
        return <article key={request.convexId} className="request-monitor-item" data-status={request.status}>
          <div className="request-monitor-header">
            <button className="request-expand-button" aria-expanded={open} aria-controls={`execution-${request.convexId}`} onClick={() => setExpanded(previous => ({ ...previous, [request.convexId]: !open }))}>
              <span className="request-expand-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
              <span className="request-monitor-title"><b>{request.title}</b><small>{request.id} · {new Date(request.createdAt).toLocaleString()}</small></span>
              <Status status={request.status} />
              <span className="request-monitor-progress"><b>{completed} / {pipelineNodes.length} nodes</b><small>{active.length ? active.map(([name, state]) => `${state.status === "failed" ? "Failed" : "Running"}: ${name}`).join(" · ") : request.status === "waiting" ? "Waiting for worker" : request.status === "succeeded" ? "Completed" : "No active nodes"}</small></span>
              <span className="request-monitor-worker">{request.unitId ?? "Unassigned"}</span>
            </button>
            <RequestActions request={request} open={actionsId === request.convexId} onToggle={() => setActionsId(current => current === request.convexId ? null : request.convexId)} onClose={() => setActionsId(null)} onEdit={() => { setActionsId(null); onEditRequest(request); }} onDuplicate={() => { setActionsId(null); onDuplicateRequest(request); }} onDelete={() => { setActionsId(null); onDeleteRequest(request); }} />
          </div>
          <div id={`execution-${request.convexId}`} hidden={!open}>{open && <RequestExecution activeRequest={request} activeRequestPipelineNodes={pipelineNodes} />}</div>
        </article>;
      })}
      {!filtered.length && <div className="empty-editor"><b>{requests.length ? "No requests match your filters" : "No requests yet"}</b><small>{requests.length ? "Try another name or status." : "Create a request to run this pipeline."}</small></div>}
    </div>

  </section>;
}

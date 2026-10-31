import { Input } from "./ui/Input";
import { SelectField } from "./ui/SelectField";
import { ActionMenu } from "./ui/ActionMenu";
import { useEffect, useId, useState } from "react";
import type { PipelineNode, RequestItem } from "../types";
import { DependencyGraph } from "./DependencyGraph";
import { DisplayModeSwitch, useDisplayMode } from "../requestPresentation";
import "../request-presentation.css";
import { Status } from "./Status";
import { RequestArtifacts } from "./RequestArtifacts";

type RequestsViewProps = {
  pipelineNames: string[];
  pipelineCounts: Record<string, number>;
  currentPipelineName: string;
  requests: RequestItem[];
  pipelineNodes: PipelineNode[];
  selectedRequest: string | null;
  onSelectPipeline: (name: string) => void;
  onEditRequest: (request: RequestItem) => void;
  onDuplicateRequest: (request: RequestItem) => void;
  onDeleteRequest: (request: RequestItem) => void;
};

function RequestExecution({ activeRequest, activeRequestPipelineNodes }: { activeRequest: RequestItem; activeRequestPipelineNodes: PipelineNode[] }) {
  const [selectedNode, setSelectedNode] = useState("");
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactFocus, setArtifactFocus] = useState<{ nodeName: string; version: number } | null>(null);
  const artifactPanelId = useId();
  function artifactIdsForNode(name: string) {
    const references = activeRequest.nodeStates[name]?.artifacts ?? (activeRequest.artifacts ?? []).filter(a => a.nodeName === name);
    const registered = new Set(activeRequest.artifacts?.map(a => a.id));
    return references.map(a => a.id).filter(id => registered.has(id));
  }
  function showNodeArtifacts(name: string) {
    setSelectedNode(name);
    setArtifactsOpen(true);
    setArtifactFocus(previous => ({ nodeName: name, version: (previous?.version ?? 0) + 1 }));
  }
  const activeNodes = activeRequest?.nodeStates ?? {};
  const activeNodeNames = activeRequestPipelineNodes.map((node) => String(node.name));
  const runningNames = activeNodeNames.filter(name => activeNodes[name]?.status === "running");
  const failedNames = activeNodeNames.filter(name => activeNodes[name]?.status === "failed");
  const focusNode = failedNames[0] ?? runningNames[0] ?? activeNodeNames.find(name => !activeNodes[name]?.status || activeNodes[name]?.status === "queue") ?? activeNodeNames[activeNodeNames.length - 1] ?? "";
  const activeNode = activeNodeNames.includes(selectedNode) ? selectedNode : focusNode;

  return <div className="request-expanded">          <div className="request-execution-view">
            <DependencyGraph
              nodes={activeRequestPipelineNodes}
              selected={activeNode}
              onSelect={setSelectedNode}
              nodeStates={activeNodes}
              artifactCounts={Object.fromEntries(activeNodeNames.map(name => [name, artifactIdsForNode(name).length]))}
              artifactPanelId={artifactPanelId}
              highlightedArtifactNode={artifactFocus?.nodeName}
              onShowArtifacts={showNodeArtifacts}
              interactive
            />
            <RequestArtifacts request={activeRequest} open={artifactsOpen} onToggle={() => setArtifactsOpen(value => !value)}
              panelId={artifactPanelId} highlightedNode={artifactFocus?.nodeName}
              highlightedIds={artifactFocus ? artifactIdsForNode(artifactFocus.nodeName) : []}
              focusVersion={artifactFocus?.version ?? 0} onClearHighlight={() => setArtifactFocus(null)} />
          </div>

</div>;
}

function RequestActions({ request, open, onToggle, onClose, onEdit, onDuplicate, onDelete }: { request: RequestItem; open: boolean; onToggle: () => void; onClose: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return <div className="request-actions-dropdown"><ActionMenu open={open} onOpenChange={next => { if (next !== open) { if (next) onToggle(); else onClose(); } }} label={`Actions for request ${request.title}`}
    trigger={<button className="subtle-button request-manage-button" aria-label={`Actions for request ${request.title}`}>•••</button>}
    actions={[
      { label: "Edit", disabled: request.status !== "waiting", onSelect: onEdit },
      { label: "Duplicate", onSelect: onDuplicate },
      { label: "Delete", danger: true, separator: true, onSelect: onDelete },
    ]} /></div>;
}

export function RequestsView({ pipelineNames, pipelineCounts, currentPipelineName, requests, pipelineNodes, selectedRequest, onSelectPipeline, onEditRequest, onDuplicateRequest, onDeleteRequest }: RequestsViewProps) {
  const [mode, setMode] = useDisplayMode("mu-masterflow:requests-layout", "list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionsId, setActionsId] = useState<string | null>(null);
  useEffect(() => {
    // Automatically reveal active runs once; completion must not collapse inspection.
    setExpanded(previous => {
      const active = requests.filter(request => (request.status === "processing" || request.status === "possessed") && previous[request.convexId] === undefined);
      return active.length ? { ...previous, ...Object.fromEntries(active.map(request => [request.convexId, true])) } : previous;
    });
  }, [requests]);
  const filtered = requests.filter(request => (statusFilter === "all" || request.status === statusFilter) && `${request.title} ${request.id} ${request.convexId}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => {
    if (selectedRequest) setExpanded(previous => ({ ...previous, [selectedRequest]: true }));
  }, [selectedRequest]);
  return <section className="editor-view requests-view request-hub request-accordion" data-layout={mode}>
    <div className="requests-toolbar" role="group" aria-label="Request filters and layout">
      <nav className="requests-toolbar-summary requests-pipeline-tabs" aria-label="Request pipelines">
        {pipelineNames.map(name => <button type="button" key={name} aria-pressed={name === currentPipelineName} title={name} onClick={() => { onSelectPipeline(name); setStatusFilter("all"); }}>
          <span className="requests-pipeline-name">{name}</span><span className="requests-pipeline-badge" aria-label={`${pipelineCounts[name] ?? 0} requests`}>{pipelineCounts[name] ?? 0}</span>
        </button>)}
        {!pipelineNames.length && <span className="requests-pipeline-name">No saved pipeline</span>}
      </nav>
      <div className="requests-toolbar-controls">
        {(search.trim() || statusFilter !== "all") && <span className="requests-result-count">{filtered.length} / {requests.length}</span>}
        <Input className="requests-search" type="search" aria-label="Find a request" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a request…" />
        <SelectField className="requests-status-select" label="Request status" value={statusFilter} onValueChange={setStatusFilter} options={[
          { value: "all", label: "All statuses" },
          ...[...new Set([...requests.map(request => request.status), ...(statusFilter === "all" ? [] : [statusFilter])])].map(status => ({ value: status, label: status.replace(/_/g, " ") })),
        ]} />
        <DisplayModeSwitch mode={mode} onChange={setMode} label="Request layout" />
      </div>
    </div>
    <div className={`request-monitor-list request-layout-${mode}`}>
      {filtered.map(request => {
        const open = expanded[request.convexId] ?? (request.status === "processing" || request.status === "possessed");
        const completed = pipelineNodes.filter(node => request.nodeStates[node.name]?.status === "succeeded").length;
        const active = Object.entries(request.nodeStates).filter(([, state]) => state.status === "running" || state.status === "failed");
        return <article key={request.convexId} className="request-monitor-item" data-status={request.status} data-expanded={open}>
          <div className="request-monitor-header">
            <button className="request-expand-button" aria-expanded={open} aria-controls={`execution-${request.convexId}`} onClick={() => setExpanded(previous => ({ ...previous, [request.convexId]: !open }))}>
              <span className="request-expand-chevron" aria-hidden="true">›</span>
              <span className="request-monitor-title"><b>{request.title}</b><small>{request.pipelineName} · {request.id} · {new Date(request.createdAt).toLocaleString()}</small></span>
              <Status status={request.status} />
              <span className="request-monitor-progress"><b>{completed} / {pipelineNodes.length} nodes</b><progress value={completed} max={pipelineNodes.length || 1} aria-label="Completed nodes" /><small>{active.length ? active.map(([name, state]) => `${state.status === "failed" ? "Failed" : "Running"}: ${name}`).join(" · ") : request.status === "waiting" ? "Waiting for worker" : request.status === "succeeded" ? "Completed" : "No active nodes"}</small></span>
              <span className="request-monitor-worker">{request.unitId ?? "Unassigned"}</span>
            </button>
            <RequestActions request={request} open={actionsId === request.convexId} onToggle={() => setActionsId(current => current === request.convexId ? null : request.convexId)} onClose={() => setActionsId(null)} onEdit={() => { setActionsId(null); onEditRequest(request); }} onDuplicate={() => { setActionsId(null); onDuplicateRequest(request); }} onDelete={() => { setActionsId(null); onDeleteRequest(request); }} />
          </div>
          <div id={`execution-${request.convexId}`} hidden={!open}>{open && <RequestExecution activeRequest={request} activeRequestPipelineNodes={pipelineNodes} />}</div>
        </article>;
      })}
      {!filtered.length && <div className="empty-editor"><b>{requests.length ? "No requests match your filters" : "No requests yet"}</b><small>{requests.length ? "Try another name or status." : currentPipelineName ? "Use New request above to run this pipeline." : "Save a pipeline in YAML to start creating requests."}</small></div>}
    </div>

  </section>;
}

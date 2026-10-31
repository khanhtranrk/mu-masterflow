import { Input } from "./ui/Input";
import { SelectField } from "./ui/SelectField";
import { ActionMenu } from "./ui/ActionMenu";
import { useEffect, useId, useRef, useState } from "react";
import type { PipelineNode, RequestItem } from "../types";
import { DependencyGraph } from "./DependencyGraph";
import { DisplayModeSwitch, useDisplayMode } from "../requestPresentation";
import "../request-presentation.css";
import { nodePresentation } from "../executionPresentation";
import { Status } from "./Status";
import { RequestArtifacts } from "./RequestArtifacts";

type RequestsViewProps = {
  specSlug: string;
  pipelineNames: string[];
  pipelineCounts: Record<string, number>;
  currentPipelineName: string;
  requests: RequestItem[];
  requestsLoading: boolean;
  pipelineNodes: PipelineNode[];
  selectedRequest: string | null;
  onSelectPipeline: (name: string) => void;
  onEditRequest: (request: RequestItem) => void;
  onDuplicateRequest: (request: RequestItem) => void;
  onDeleteRequest: (request: RequestItem) => void;
  onResetRequest: (request: RequestItem) => void;
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
              requestStatus={activeRequest.status}
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

function RequestActions({ request, open, onToggle, onClose, onEdit, onDuplicate, onDelete, onReset }: { request: RequestItem; open: boolean; onToggle: () => void; onClose: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onReset: () => void }) {
  return <div className="request-actions-dropdown"><ActionMenu open={open} onOpenChange={next => { if (next !== open) { if (next) onToggle(); else onClose(); } }} label={`Actions for request ${request.title}`}
    trigger={<button className="subtle-button request-manage-button" aria-label={`Actions for request ${request.title}`}>•••</button>}
    actions={[
      { label: "Edit", disabled: request.status !== "waiting", onSelect: onEdit },
      { label: "Duplicate", onSelect: onDuplicate },
      ...(request.status === "process_failed" || request.status === "retrieve_artifact_failed" ? [{ label: "Reset request", onSelect: onReset }] : []),
      { label: "Delete", danger: true, separator: true, onSelect: onDelete },
    ]} /></div>;
}

export function RequestsView({ specSlug, pipelineNames, pipelineCounts, currentPipelineName, requests, requestsLoading, pipelineNodes, selectedRequest, onSelectPipeline, onEditRequest, onDuplicateRequest, onDeleteRequest, onResetRequest }: RequestsViewProps) {
  const [mode, setMode] = useDisplayMode("mu-masterflow:requests-layout", "list");
  const [searchBySpec, setSearchBySpec] = useState<Record<string, string>>({});
  const [statusFilterBySpec, setStatusFilterBySpec] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [failedFlash, setFailedFlash] = useState<Record<string, boolean>>({});
  const previousStatuses = useRef(new Map<string, string>());
  const failedFlashTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const search = searchBySpec[specSlug] ?? "";
  const statusFilter = statusFilterBySpec[specSlug] ?? "all";
  const setSearch = (value: string) => setSearchBySpec(previous => ({ ...previous, [specSlug]: value }));
  const setStatusFilter = (value: string) => setStatusFilterBySpec(previous => ({ ...previous, [specSlug]: value }));
  useEffect(() => {
    const changed = requests.filter(request => previousStatuses.current.get(request.convexId) !== request.status);
    if (changed.length) {
      setExpanded(previous => {
        const next = { ...previous };
        for (const request of changed) {
          if (request.status === "processing") next[request.convexId] = true;
          if (request.status === "succeeded" || request.status === "process_failed") next[request.convexId] = false;
        }
        return next;
      });
      for (const request of changed) {
        const previousStatus = previousStatuses.current.get(request.convexId);
        const requestId = request.convexId;
        const existingTimer = failedFlashTimers.current.get(requestId);
        if (request.status !== "process_failed") {
          if (existingTimer) clearTimeout(existingTimer);
          failedFlashTimers.current.delete(requestId);
          setFailedFlash(previous => {
            if (!previous[requestId]) return previous;
            const next = { ...previous };
            delete next[requestId];
            return next;
          });
          continue;
        }
        if (previousStatus === undefined || previousStatus === "process_failed") continue;
        if (existingTimer) clearTimeout(existingTimer);
        setFailedFlash(previous => ({ ...previous, [requestId]: true }));
        failedFlashTimers.current.set(requestId, setTimeout(() => {
          setFailedFlash(previous => {
            const next = { ...previous };
            delete next[requestId];
            return next;
          });
          failedFlashTimers.current.delete(requestId);
        }, 3250));
      }
    }
    previousStatuses.current = new Map(requests.map(request => [request.convexId, request.status]));
  }, [requests]);
  useEffect(() => () => {
    for (const timer of failedFlashTimers.current.values()) clearTimeout(timer);
  }, []);
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
    <div className={`request-monitor-list request-layout-${mode}`} aria-busy={requestsLoading}>
      {requestsLoading ? <div className="request-loading-list" role="status" aria-label="Loading requests">
        <span>Loading requests…</span>
        {[0, 1, 2].map(item => <div className="request-loading-placeholder" key={item} aria-hidden="true">
          <i /><div><b /><small /></div><em /><span />
        </div>)}
      </div> : filtered.map(request => {
        const open = expanded[request.convexId] ?? request.status === "processing";
        const completed = pipelineNodes.filter(node => request.nodeStates[node.name]?.status === "succeeded").length;
        const createdAt = new Date(request.createdAt).toLocaleString();
        return <article key={request.convexId} className="request-monitor-item" data-status={request.status} data-expanded={open} data-failed-flash={failedFlash[request.convexId] || undefined}>
          <div className="request-monitor-header">
            <button className="request-expand-button" aria-label={`${open ? "Collapse" : "Expand"} ${request.title}`} aria-expanded={open} aria-controls={`execution-${request.convexId}`} onClick={() => setExpanded(previous => ({ ...previous, [request.convexId]: !open }))}>
              <span className="request-expand-chevron" aria-hidden="true">›</span>
              <span className="request-monitor-title">
                <b title={request.title}>{request.title}</b>
                <small>
                  <span title={`Pipeline: ${request.pipelineName}`}>{request.pipelineName}</span>
                  <span>{request.id}</span>
                  <span title={createdAt}>{createdAt}</span>
                </small>
              </span>
            </button>
            <div className="request-monitor-meta">
              <Status status={request.status} />
              <div className="request-monitor-nodes" aria-label={`${completed} of ${pipelineNodes.length} nodes succeeded`}>
                <span className="request-monitor-node-count">{completed}/{pipelineNodes.length}</span>
                <span className="request-monitor-node-dots">
                  {pipelineNodes.map(node => {
                    const presentation = nodePresentation(request.nodeStates[node.name], request.status);
                    const reason = presentation.reason && presentation.reason !== presentation.label ? `: ${presentation.reason}` : "";
                    const label = `${node.name} — ${presentation.label}${reason}`;
                    return <span key={node.name} className="request-monitor-node-dot" data-status={presentation.status} data-tooltip={label} title={label} aria-label={label} role="img" tabIndex={0} />;
                  })}
                </span>
              </div>
              <span className="request-monitor-worker">{request.unitId ?? "Unassigned"}</span>
            </div>
            <RequestActions request={request} open={actionsId === request.convexId} onToggle={() => setActionsId(current => current === request.convexId ? null : request.convexId)} onClose={() => setActionsId(null)} onEdit={() => { setActionsId(null); onEditRequest(request); }} onDuplicate={() => { setActionsId(null); onDuplicateRequest(request); }} onDelete={() => { setActionsId(null); onDeleteRequest(request); }} onReset={() => { setActionsId(null); onResetRequest(request); }} />
          </div>
          <div id={`execution-${request.convexId}`} hidden={!open}>{open && <RequestExecution key={`${request.convexId}:${request.resetVersion ?? 0}`} activeRequest={request} activeRequestPipelineNodes={pipelineNodes} />}</div>
        </article>;
      })}
      {!requestsLoading && !filtered.length && <div className="empty-editor"><b>{requests.length ? "No requests match your filters" : "No requests yet"}</b><small>{requests.length ? "Try another name or status." : currentPipelineName ? "Use New request above to run this pipeline." : "Save a pipeline in YAML to start creating requests."}</small></div>}
    </div>

  </section>;
}

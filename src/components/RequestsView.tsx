import { useEffect, useState } from "react";
import type { PipelineNode, RequestItem } from "../types";
import { DependencyGraph } from "./DependencyGraph";
import { Status } from "./Status";
import type { UnitItem } from "../types";

type RequestsViewProps = {
  pipelineNames: string[];
  currentPipelineName: string;
  requests: RequestItem[];
  units: UnitItem[];
  activeRequest?: RequestItem;
  activeRequestPipelineNodes: PipelineNode[];
  selectedRequest: string | null;
  onSelectPipeline: (name: string) => void;
  onSelectRequest: (id: string) => void;
  onNewRequest: () => void;
};

export function RequestsView({
  pipelineNames,
  currentPipelineName,
  requests,
  units,
  activeRequest,
  activeRequestPipelineNodes,
  selectedRequest,
  onSelectPipeline,
  onSelectRequest,
  onNewRequest,
}: RequestsViewProps) {
  const [selectedNode, setSelectedNode] = useState("");
  const activeNodes = activeRequest?.nodeStates ?? {};
  const activeNodeNames = activeRequestPipelineNodes.map((node) => String(node.name));
  const activeNode = activeNodeNames.includes(selectedNode) ? selectedNode : activeNodeNames[0] ?? "";
  const selectedNodeState = activeNodes[activeNode];
  const activeUnit = activeRequest?.unitId ? units.find((unit) => unit.unitId === activeRequest.unitId) : undefined;

  useEffect(() => {
    const runningNode = Object.entries(activeRequest?.nodeStates ?? {}).find(([, state]) => state.status === "running")?.[0];
    setSelectedNode(runningNode ?? activeRequestPipelineNodes[0]?.name ?? "");
  }, [activeRequest?.convexId]);

  const payloadEntries = (payload: unknown) =>
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.entries(payload as Record<string, unknown>)
      : [];

  const displayValue = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value) ?? String(value);

  return (
    <section className="editor-view requests-view">
      <div className="view-heading">
        <div>
          <span className="view-kicker">RUNS</span>
          <h2>Requests</h2>
          <p>{currentPipelineName ? `Requests attached to ${currentPipelineName}.` : "Add a pipeline before creating requests."}</p>
        </div>
        <button className="subtle-button primary-subtle" onClick={onNewRequest} disabled={!currentPipelineName}>＋ New request</button>
      </div>
      {pipelineNames.length > 1 && (
        <div className="pipeline-switcher request-pipelines">
          {pipelineNames.map((name) => <button key={name} className={currentPipelineName === name ? "chosen" : ""} onClick={() => onSelectPipeline(name)}>{name}</button>)}
        </div>
      )}
      {requests.length > 0 ? (
        <div className="request-list">
          {requests.map((request) => (
            <button key={request.convexId} className={`request-row ${selectedRequest === request.convexId ? "selected" : ""}`} onClick={() => onSelectRequest(request.convexId)}>
              <span className="request-icon">▤</span>
              <span className="request-copy">
                <b>{request.title}</b>
                <small>{request.id} · {payloadEntries(request.payload).map(([key, value]) => `${key}: ${displayValue(value)}`).slice(0, 2).join(" · ") || "No payload fields"}</small>
              </span>
              <Status status={request.status} />
              <span className="request-stage">{Object.entries(request.nodeStates).find(([, state]) => state.status === "running")?.[0] ?? "—"}</span>
              <span className="request-chevron">{selectedRequest === request.convexId ? "⌄" : "›"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-editor">
          <span>▤</span><b>No requests for {currentPipelineName || "this pipeline"}</b><small>Create a request to run this pipeline.</small>
          <button className="subtle-button" onClick={onNewRequest} disabled={!currentPipelineName}>Create request</button>
        </div>
      )}
      {activeRequest && (
        <div className="request-detail">
          <div><b>{activeRequest.title}</b><Status status={activeRequest.status} /></div>
          <p>{activeRequest.id} · Created {new Date(activeRequest.createdAt).toLocaleString()}</p>
          <div className="request-params">
            {payloadEntries(activeRequest.payload).map(([key, value]) => <span key={key}><small>{key}</small>{displayValue(value)}</span>)}
            {payloadEntries(activeRequest.payload).length === 0 && <span><small>Payload</small>{displayValue(activeRequest.payload)}</span>}
          </div>
          <div className="request-execution-view">
            <b>Pipeline execution · {activeRequest.pipelineName || pipelineNames[0] || "pipeline"}</b>
            <DependencyGraph
              nodes={activeRequestPipelineNodes}
              selected={activeNode}
              onSelect={setSelectedNode}
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
          <div className="request-unit-detail">
            <b>Worker</b>
            {activeRequest.unitId ? (
              activeUnit ? (
                <>
                  <div className="request-unit-heading"><span>{activeUnit.unitId}</span><Status status={activeUnit.status} /></div>
                  <p>{activeUnit.unitType} · Last seen {new Date(activeUnit.lastSeen).toLocaleString()}</p>
                  <small>{activeUnit.workingDir || "No working directory reported"}</small>
                  <div className="request-unit-devices">
                    {activeUnit.devices.length > 0
                      ? activeUnit.devices.map((device) => <span key={`${device.family}-${device.index}`}>{device.family} · {device.index}</span>)
                      : <span>No devices reported</span>}
                  </div>
                </>
              ) : <p>{activeRequest.unitId} · Worker details unavailable</p>
            ) : <p>Not assigned to a worker yet.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

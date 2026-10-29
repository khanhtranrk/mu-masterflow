import type { PipelineNode, RequestItem } from "../types";
import { DependencyGraph } from "./DependencyGraph";
import { Status } from "./Status";

type RequestsViewProps = {
  pipelineNames: string[];
  currentPipelineName: string;
  requests: RequestItem[];
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
  activeRequest,
  activeRequestPipelineNodes,
  selectedRequest,
  onSelectPipeline,
  onSelectRequest,
  onNewRequest,
}: RequestsViewProps) {
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
                <small>{request.id} · {Object.entries(request.params).map(([key, value]) => `${key}: ${String(value)}`).slice(0, 2).join(" · ") || "No parameters"}</small>
              </span>
              <Status status={request.status} />
              <span className="request-stage">{request.node}</span>
              <span className="request-progress"><i><b className={request.status} style={{ width: `${request.progress}%` }} /></i>{request.progress}%</span>
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
          <p>Current step: {activeRequest.node} · {activeRequest.unit}</p>
          <div className="request-params">
            {Object.entries(activeRequest.params).map(([key, value]) => <span key={key}><small>{key}</small>{String(value)}</span>)}
          </div>
          <div className="request-plan-view">
            <b>Pipeline execution · {activeRequest.pipelineName ?? pipelineNames[0] ?? "pipeline"}</b>
            <DependencyGraph nodes={activeRequestPipelineNodes} selected={activeRequest.node} onSelect={() => undefined} plan={activeRequest.plan} readOnly />
          </div>
        </div>
      )}
    </section>
  );
}

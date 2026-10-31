import type { NodeExecutionState, PipelineNode, RequestItem } from "./types";

const terminalRequests = new Set(["succeeded", "process_failed", "retrieve_artifact_failed", "artifact_available"]);
export function nodePresentation(state: NodeExecutionState | undefined, requestStatus?: string) {
  const status = state?.status ?? "not_started";
  if (requestStatus && terminalRequests.has(requestStatus) && ["running", "queue", "not_started"].includes(status)) {
    return { status: "unconfirmed", label: "Final state not reported", reason: `Last report: ${state?.status ?? "none"}. Request has ended.` };
  }
  const labels: Record<string, string> = {queue: "Queued", running: "Running", failed: "Failed", succeeded: "Succeeded", not_started: "Not started"};
  return {status, label: status === "failed" && state?.reason?.startsWith("Blocked:") ? "Blocked" : status === "queue" && state?.reason ? state.reason : labels[status] ?? "Not reported", reason: state?.reason ?? ""};
}

export function requestExecutionSummary(request: RequestItem, nodes: PipelineNode[]): string {
  const states = nodes.map(node => ({name: node.name, ...nodePresentation(request.nodeStates[node.name], request.status)}));
  const details = states.filter(state => ["running", "failed", "unconfirmed"].includes(state.status));
  if (details.length) return details.map(state => `${state.label}: ${state.name}${state.status === "failed" && state.reason ? ` (${state.reason})` : ""}`).join(" · ");
  const queued = states.filter(state => state.status === "queue");
  if (queued.length) return queued.map(state => `${state.name}: ${state.label}`).join(" · ");
  if (request.status === "waiting") return "Waiting for worker";
  if (request.status === "possessed") return "Queued on worker; no node running";
  if (request.status === "succeeded") return "Completed";
  if (request.status === "process_failed") return "Request failed";
  return "No node currently running";
}

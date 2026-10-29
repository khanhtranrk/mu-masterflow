const labels: Record<string, string> = {
  waiting: "Waiting",
  possessed: "Possessed",
  processing: "Processing",
  process_failed: "Process failed",
  artifact_available: "Artifact available",
  retrieve_artifact_failed: "Artifact retrieval failed",
  succeeded: "Succeeded",
};

export function Status({ status }: { status: string }) {
  return <span className={`status-tag ${status}`}><i />{labels[status] ?? status}</span>;
}

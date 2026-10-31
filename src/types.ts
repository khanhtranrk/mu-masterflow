export type ConfigTab = "pipeline" | "entries" | "workloads" | "spec-yaml" | "requests";

export type PipelineNode = Record<string, any> & { name: string };

export type NodeExecutionState = {
  status?: string;
  device?: { family: string; index: number };
  artifacts?: RequestArtifact[];
  logs?: string[];
};

export type RequestArtifact = {
  id: string;
  nodeName?: string;
  name: string;
  label?: string;
  storageId: string;
  contentType: string;
  size: number;
  createdAt: number;
};

export type RequestItem = {
  id: string;
  convexId: string;
  title: string;
  pipelineName: string;
  status: string;
  createdAt: number;
  payload: unknown;
  unitId?: string;
  nodeStates: Record<string, NodeExecutionState>;
  artifacts?: RequestArtifact[];
};

export type SpecItem = { _id: string; slug: string; name: string; description: string; yaml: string; color: string };

export type UnitItem = {
  unitId: string;
  unitType: string;
  status: "online" | "offline";
  workingDir: string;
  devices: { family: string; index: number }[];
  lastSeen: number;
};

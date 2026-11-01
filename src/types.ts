export type ConfigTab = "requests" | "overview" | "spec-yaml";

export type PipelineNode = Record<string, any> & { name: string };

export type NodeExecutionState = {
  status?: string;
  reason?: string;
  device?: { family: string; index: number };
  artifacts?: RequestArtifact[];
  logs?: string[];
};

export type RequestArtifact = {
  id: string;
  nodeName?: string;
  name: string;
  label?: string;
  storageId?: string;
  handler?: "s3";
  connectionId?: string;
  objectKey?: string;
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
  resetVersion?: number;
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

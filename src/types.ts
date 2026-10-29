export type ConfigTab = "pipeline" | "prepare" | "workloads" | "master-flow" | "spec-yaml" | "requests";

export type PipelineNode = Record<string, any> & { name: string };

export type NodeExecutionState = {
  status?: string;
  device?: { family: string; index: number };
  artifacts?: Record<string, string>;
  logs?: string[];
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

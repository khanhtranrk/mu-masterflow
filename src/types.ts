export type ConfigTab = "pipeline" | "prepare" | "workloads" | "master-flow" | "spec-yaml" | "requests";

export type PipelineNode = Record<string, any> & { name: string };

export type RequestItem = {
  id: string;
  convexId: string;
  title: string;
  spec: string;
  pipelineName?: string;
  status: string;
  node: string;
  unit: string;
  progress: number;
  createdAt: number;
  params: Record<string, unknown>;
  plan: Array<{ nodeName: string; status: string; device?: { family?: string; index?: number } }>;
};

export type SpecItem = { _id: string; slug: string; name: string; description: string; yaml: string; color: string };

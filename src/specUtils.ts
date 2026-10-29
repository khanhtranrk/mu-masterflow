import type { PipelineNode } from "./types";

export const tabs = [
  { id: "pipeline", label: "Pipeline" },
  { id: "prepare", label: "Prepare" },
  { id: "workloads", label: "Workloads" },
  { id: "master-flow", label: "Master flow" },
  { id: "spec-yaml", label: "Spec YAML" },
  { id: "requests", label: "Requests" },
] as const;

export const starterYaml = `master-flow:\n  requests: []\nprepare: []\nworkloads: {}\npipeline:\n  main:\n    params: {}\n    nodes: []\n`;

export const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export function nodeDependencyNames(node: PipelineNode): string[] {
  return (Array.isArray(node.depends_on) ? node.depends_on : [])
    .map((dependency: any) => typeof dependency === "string" ? dependency : String(dependency?.node ?? dependency?.name ?? ""))
    .filter(Boolean);
}

export function layoutGraph(nodes: PipelineNode[]) {
  const names = nodes.map((node, index) => String(node.name || `node_${index + 1}`));
  const rankCache = new Map<string, number>();
  const rankOf = (name: string, stack = new Set<string>()): number => {
    if (rankCache.has(name)) return rankCache.get(name)!;
    if (stack.has(name)) return 0;
    const node = nodes[names.indexOf(name)];
    const nextStack = new Set(stack).add(name);
    const rank = Math.max(0, ...nodeDependencyNames(node ?? {}).filter((dependency) => names.includes(dependency)).map((dependency) => rankOf(dependency, nextStack) + 1));
    rankCache.set(name, rank);
    return rank;
  };
  names.forEach((name) => rankOf(name));
  const columns = new Map<number, string[]>();
  names.forEach((name) => columns.set(rankCache.get(name)!, [...(columns.get(rankCache.get(name)!) ?? []), name]));
  const positions = new Map<string, { x: number; y: number }>();
  for (const [rank, column] of columns) column.forEach((name, index) => positions.set(name, { x: rank * 258 + 30, y: index * 126 + 34 }));
  const width = Math.max(1, ...Array.from(columns.keys())) * 258 + 250;
  const height = Math.max(1, ...Array.from(columns.values()).map((column) => column.length)) * 126 + 28;
  return { positions, width, height };
}

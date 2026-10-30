import type { PipelineNode } from "./types";

export const tabs = [
  { id: "pipeline", label: "Pipeline" },
  { id: "entries", label: "Entries" },
  { id: "workloads", label: "Workloads" },
  { id: "spec-yaml", label: "Spec YAML" },
  { id: "requests", label: "Requests" },
] as const;

export const starterYaml = `entries:\n  direct_flow:\n    initialization: []\n    finalization: []\n  master_flow:\n    initialization: []\n    finalization: []\nworkloads: {}\npipeline:\n  main:\n    prepare: []\n    params: {}\n    nodes: []\n`;

export const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export function nodeDependencyNames(node: PipelineNode): string[] {
  return (Array.isArray(node.depends_on) ? node.depends_on : [])
    .filter((dependency: unknown): dependency is string => typeof dependency === "string" && dependency.length > 0);
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

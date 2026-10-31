import { v, type Infer } from "convex/values";

// One contract for request files, node references, HTTP reports and responses.
export const artifact = v.object({
  id: v.string(), nodeName: v.optional(v.string()), name: v.string(),
  label: v.optional(v.string()), storageId: v.id("_storage"),
  contentType: v.string(), size: v.number(), createdAt: v.number(),
});
export type Artifact = Infer<typeof artifact>;
export const nodeUpdate = v.object({
  status: v.optional(v.union(v.literal("queue"), v.literal("running"), v.literal("failed"), v.literal("succeeded"))),
  reason: v.optional(v.string()),
  device: v.optional(v.object({ family: v.string(), index: v.number() })),
  artifacts: v.optional(v.array(artifact)),
  logs: v.optional(v.array(v.string())),
});
export type NodeUpdate = Infer<typeof nodeUpdate>;

export function isArtifactArray(value: unknown): value is Artifact[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const allowed = ["id", "nodeName", "name", "label", "storageId", "contentType", "size", "createdAt"];
    if (Object.keys(item).some(key => !allowed.includes(key))) return false;
    if (![item.id, item.name, item.storageId, item.contentType].every(v => typeof v === "string" && v.trim())) return false;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    return (item.nodeName === undefined || typeof item.nodeName === "string")
      && (item.label === undefined || typeof item.label === "string")
      && Number.isSafeInteger(item.size) && item.size >= 0
      && Number.isFinite(item.createdAt) && item.createdAt >= 0;
  });
}

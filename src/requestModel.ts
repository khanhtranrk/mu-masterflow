import { isMapping } from "./specModel";

export function payloadIssues(payload: unknown, schema: Record<string, any>): Record<string, string> {
  if (!isMapping(payload)) return { _payload: "Request inputs must be a JSON object." };
  const issues: Record<string, string> = {};
  for (const [name, raw] of Object.entries(schema)) {
    const definition = isMapping(raw) ? raw : {};
    if (!Object.prototype.hasOwnProperty.call(payload, name)) {
      if (!("default" in definition)) issues[name] = "This input is required.";
      continue;
    }
    if (definition.type === "number" && (typeof payload[name] !== "number" || !Number.isFinite(payload[name]))) issues[name] = "Enter a valid number.";
    if (definition.type === "string" && typeof payload[name] !== "string") issues[name] = "Enter text, not a number or another JSON type.";
  }
  for (const name of Object.keys(payload)) if (!Object.prototype.hasOwnProperty.call(schema, name)) issues[name] = "This input is not declared in the saved pipeline. Remove it in JSON mode.";
  return issues;
}

export type InputDraft = { enabled: boolean; value: string };
export function inputDrafts(schema: Record<string, any>, payload: unknown): Record<string, InputDraft> {
  const source = isMapping(payload) ? payload : {};
  return Object.fromEntries(Object.entries(schema).map(([name, raw]) => {
    const definition = isMapping(raw) ? raw : {};
    const supplied = Object.prototype.hasOwnProperty.call(source, name);
    return [name, { enabled: supplied || !("default" in definition), value: supplied ? String(source[name] ?? "") : "" }];
  }));
}

export function draftPayload(schema: Record<string, any>, drafts: Record<string, InputDraft>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(schema)) {
    const definition = isMapping(raw) ? raw : {};
    const field = drafts[name];
    if (!field?.enabled) continue;
    payload[name] = definition.type === "number" ? (field.value.trim() ? Number(field.value) : NaN) : field.value;
  }
  return payload;
}

export function requestTitle(payload: unknown, fallback: string): string {
  if (isMapping(payload)) for (const key of ["name", "title"]) if (typeof payload[key] === "string" && payload[key].trim()) return payload[key];
  return fallback;
}

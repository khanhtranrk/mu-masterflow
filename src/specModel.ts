import type { PipelineNode } from "./types";

export const isMapping = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const actionTypes = new Set(["execute_command", "execute_workload", "create_dir", "write_json", "send_http_request", "inspect_file", "execute_routine"]);
const conditionTypes = new Set(["and", "or", "file_exists", "folder_exists", "path_exists", "exit_code", "action_state", "node_state", "node_status"]);

/** Structural checks for the current Mu format; Mu owns execution semantics. */
export function specIssues(value: unknown): string[] {
  const issues: string[] = [];
  const fail = (path: string, message: string) => issues.push(`${path}: ${message}`);
  if (!isMapping(value)) return ["spec: expected a YAML mapping."];
  if ("prepare" in value) fail("prepare", "removed at spec root; move setup to pipeline.<name>.prepare or entries.<entry>.initialization.");
  if ("master-flow" in value) fail("master-flow", "removed; use entries.master_flow. Requests are claimed from the server.");
  function mapping(data: unknown, path: string) {
    if (!isMapping(data)) { fail(path, "expected a mapping."); return {}; }
    return data;
  }
  const routines = mapping(value.routines ?? {}, "routines");
  const workloads = mapping(value.workloads ?? {}, "workloads");
  function params(data: unknown, path: string) {
    for (const [name, declaration] of Object.entries(mapping(data, path))) {
      const item = mapping(declaration, `${path}.${name}`);
      if (item.type !== undefined && !["string", "number", "array", "object", "boolean"].includes(item.type)) fail(`${path}.${name}.type`, "expected string, number, array, object or boolean.");
      if ("default" in item && item.type && (item.type === "array" ? !Array.isArray(item.default) : item.type === "object" ? !isMapping(item.default) : typeof item.default !== item.type)) fail(`${path}.${name}.default`, `expected ${item.type}.`);
    }
  }
  function condition(data: unknown, path: string) {
    if (data === undefined || data === null) return;
    const item = mapping(data, path);
    if (!conditionTypes.has(item.operator)) fail(`${path}.operator`, "unknown condition operator.");
    if (["and", "or"].includes(item.operator)) {
      if (!Array.isArray(item.props)) fail(`${path}.props`, "expected a list of conditions.");
      else item.props.forEach((child: unknown, i: number) => condition(child, `${path}.props[${i}]`));
    }
    if (["action_state", "node_state"].includes(item.operator)) {
      if (!Array.isArray(item.target) || !item.target.length || item.target.some((key: unknown) => typeof key !== "string" || !key)) fail(`${path}.target`, "expected a non-empty list of string keys.");
      if (!("expected" in item)) fail(`${path}.expected`, "required.");
    }
  }
  function checks(item: Record<string, any>, path: string) {
    for (const key of ["skip_if", "precondition", "postcondition"]) condition(item[key], `${path}.${key}`);
    if (item.context !== undefined) mapping(item.context, `${path}.context`);
    if (item.ignore_error !== undefined && typeof item.ignore_error !== "boolean") fail(`${path}.ignore_error`, "expected a boolean.");
  }
  function actions(data: unknown, path: string, allowWorkload = false) {
    if (!Array.isArray(data)) { fail(path, "expected a list of actions; replace run: {workload, args} with a list containing type: execute_workload."); return; }
    data.forEach((raw, i) => {
      const at = `${path}[${i}]`, item = mapping(raw, at);
      if (!actionTypes.has(item.type)) fail(`${at}.type`, "unknown action type.");
      if ("action" in item || "save_response_to_context" in item) fail(at, "use type and save_state; legacy action fields were removed.");
      if (item.save_state !== undefined && (!["execute_command", "send_http_request", "inspect_file", "execute_routine"].includes(item.type) || typeof item.save_state !== "string" || !item.save_state.trim())) fail(`${at}.save_state`, "requires a non-empty name on a command, HTTP, inspect_file or execute_routine action.");
      if (item.type === "execute_command" && (typeof item.target !== "string" || !item.target.trim())) fail(`${at}.target`, "expected a non-empty executable.");
      if (item.type === "send_http_request" && (typeof item.url !== "string" || !item.url.trim())) fail(`${at}.url`, "expected a non-empty URL.");
      if (["create_dir", "write_json"].includes(item.type) && (typeof item.path !== "string" || !item.path.trim())) fail(`${at}.path`, "expected a non-empty path.");
      if (item.type === "send_http_request" && item.header !== undefined) mapping(item.header, `${at}.header`);
      if (item.type === "send_http_request") {
        if ("body" in item && "body_file" in item) fail(at, "body and body_file are mutually exclusive.");
        for (const field of ["body_file", "response_file"]) {
          if (item[field] !== undefined && (typeof item[field] !== "string" || !item[field].trim())) fail(`${at}.${field}`, "expected a non-empty file path.");
        }
        if (item.timeout !== undefined && (typeof item.timeout === "string" ? !item.timeout.includes("{") : typeof item.timeout !== "number" || !Number.isFinite(item.timeout) || item.timeout <= 0)) fail(`${at}.timeout`, "expected positive seconds or a template.");
      }
      if (item.type === "execute_command" && item.args !== undefined && !Array.isArray(item.args)) fail(`${at}.args`, "expected an argv list.");
      if (item.type === "execute_workload") {
        if (!allowWorkload) fail(at, "execute_workload is only supported in node before_run, run and after_run.");
        const name = item.workload;
        if (typeof name !== "string" || !name || /[{}]/.test(name)) fail(`${at}.workload`, "expected a literal non-empty workload name; templates cannot be scheduled.");
        else if (allowWorkload && !Object.prototype.hasOwnProperty.call(workloads, name)) fail(`${at}.workload`, `undefined workload ${name}. Select a declared workload.`);
        if (item.args !== undefined) mapping(item.args, `${at}.args`);
      }
      if (item.type === "inspect_file" && (typeof item.target !== "string" || !item.target.trim())) fail(`${at}.target`, "expected a non-empty file path.");
      if (item.type === "execute_routine") {
        if (typeof item.routine !== "string" || !item.routine.trim() || /[{}]/.test(item.routine)) fail(`${at}.routine`, "expected a literal routine name.");
        else if (!Object.prototype.hasOwnProperty.call(routines, item.routine)) fail(`${at}.routine`, `undefined routine ${item.routine}.`);
        if (item.args !== undefined) mapping(item.args, `${at}.args`);
      }
      checks(item, at);
    });
  }
  for (const [name, raw] of Object.entries(routines)) {
    const at = `routines.${name}`, item = mapping(raw, at);
    if (!name.trim()) fail(at, "expected a non-empty routine name.");
    params(item.params ?? {}, `${at}.params`);
    actions(item.actions, `${at}.actions`);
  }
  const routineVisiting = new Set<string>(), routineVisited = new Set<string>();
  function visitRoutine(name: string) {
    if (routineVisiting.has(name)) { fail(`routines.${name}`, "routine call cycle detected."); return; }
    if (routineVisited.has(name)) return;
    routineVisiting.add(name);
    const list = routines[name]?.actions;
    if (Array.isArray(list)) for (const action of list) {
      if (isMapping(action) && action.type === "execute_routine" && typeof action.routine === "string" && Object.prototype.hasOwnProperty.call(routines, action.routine)) visitRoutine(action.routine);
    }
    routineVisiting.delete(name); routineVisited.add(name);
  }
  Object.keys(routines).forEach(visitRoutine);
  for (const [name, raw] of Object.entries(mapping(value.entries ?? {}, "entries"))) {
    const at = `entries.${name}`, entry = mapping(raw, at);
    if (!["direct_flow", "master_flow"].includes(name)) fail(at, "expected direct_flow or master_flow.");
    for (const phase of ["initialization", "finalization"]) actions(entry[phase] ?? [], `${at}.${phase}`);
  }
  for (const [name, raw] of Object.entries(workloads)) {
    const at = `workloads.${name}`, item = mapping(raw, at);
    params(item.params ?? {}, `${at}.params`);
    if (typeof item.target !== "string" || !item.target.trim()) fail(`${at}.target`, "expected a non-empty executable.");
    for (const key of ["args", "device_args"]) if (item[key] !== undefined && !Array.isArray(item[key])) fail(`${at}.${key}`, "expected an argv list.");
    if (item.env !== undefined) mapping(item.env, `${at}.env`);
    if (item.units !== undefined && (typeof item.units !== "number" || !Number.isFinite(item.units) || item.units < 0)) fail(`${at}.units`, "expected a non-negative number; 0 is CPU-only.");
  }
  for (const [name, raw] of Object.entries(mapping(value.pipeline ?? {}, "pipeline"))) {
    const at = `pipeline.${name}`, item = mapping(raw, at);
    params(item.params ?? {}, `${at}.params`);
    if (item.context !== undefined) mapping(item.context, `${at}.context`);
    actions(item.prepare ?? [], `${at}.prepare`);
    if (!Array.isArray(item.nodes ?? [])) { fail(`${at}.nodes`, "expected a list."); continue; }
    const nodes: PipelineNode[] = (item.nodes ?? []).filter(isMapping);
    if (nodes.length !== (item.nodes ?? []).length) fail(`${at}.nodes`, "every node must be a mapping.");
    const names = nodes.map(node => node.name);
    if (names.some(n => typeof n !== "string" || !n.trim()) || new Set(names).size !== names.length) fail(`${at}.nodes`, "node names must be unique non-empty strings.");
    nodes.forEach((node, i) => {
      const path = `${at}.nodes[${i}]`;
      checks(node, path);
      for (const phase of ["before_run", "run", "after_run", "finally"]) actions(node[phase] === undefined ? [] : node[phase], `${path}.${phase}`, phase !== "finally");
      if (node.depends_on !== undefined && (!Array.isArray(node.depends_on) || node.depends_on.some((d: unknown) => typeof d !== "string" || !d))) fail(`${path}.depends_on`, "use a list of node names, e.g. [prepare, generate]; dependency objects/conditions are not supported.");
      else for (const dependency of node.depends_on ?? []) if (!names.includes(dependency)) fail(`${path}.depends_on`, `unknown node ${dependency}.`);

    });
    const visiting = new Set<string>(), visited = new Set<string>();
    function visit(n: string): boolean {
      if (visiting.has(n)) return true;
      if (visited.has(n)) return false;
      visiting.add(n);
      const node = nodes.find(node => node.name === n);
      for (const d of Array.isArray(node?.depends_on) ? node.depends_on : []) if (typeof d === "string" && names.includes(d) && visit(d)) return true;
      visiting.delete(n); visited.add(n); return false;
    }
    if (names.some(n => typeof n === "string" && visit(n))) fail(`${at}.nodes`, "dependency cycle detected.");
  }
  return issues;
}

export function nextName(prefix: string, names: string[]) {
  let index = 1;
  while (names.includes(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

export function renameNode(nodes: PipelineNode[], oldName: string, replacement: PipelineNode): PipelineNode[] {
  if (replacement.name !== oldName && nodes.some(node => node.name === replacement.name)) throw new Error(`Node ${replacement.name} already exists.`);
  return nodes.map(node => {
    const next = node.name === oldName ? replacement : node;
    return Array.isArray(next.depends_on) ? { ...next, depends_on: next.depends_on.map(d => d === oldName ? replacement.name : d) } : next;
  });
}

export function requestPayload(schema: Record<string, any>, data: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [name, declaration] of Object.entries(schema)) {
    const field = `param:${name}`;
    if (!data.has(field)) {
      if (isMapping(declaration) && "default" in declaration) continue;
      throw new Error(`${name}: required parameter.`);
    }
    const raw = String(data.get(field));
    if (declaration?.type === "number") {
      if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error(`${name}: enter a finite number.`);
      payload[name] = Number(raw);
    } else payload[name] = raw;
  }
  return payload;
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useConvexConnectionState } from "convex/react";
import { api } from "../convex/_generated/api";
import { parse, stringify } from "yaml";
import "./App.css";
import "./graph.css";
import "./space-actions.css";

type ConfigTab = "pipeline" | "prepare" | "workloads" | "master-flow" | "spec-yaml" | "requests";
type PipelineNode = Record<string, any> & { name: string };
type RequestItem = { id: string; convexId: string; title: string; spec: string; pipelineName?: string; status: string; node: string; unit: string; progress: number; createdAt: number; params: Record<string, unknown>; plan: Array<{ nodeName: string; status: string; device?: { family?: string; index?: number } }> };
type SpecItem = { _id: string; slug: string; name: string; description: string; yaml: string; color: string };
const tabs: Array<{ id: ConfigTab; label: string }> = [
  { id: "pipeline", label: "Pipeline" },
  { id: "prepare", label: "Prepare" },
  { id: "workloads", label: "Workloads" },
  { id: "master-flow", label: "Master flow" },
  { id: "spec-yaml", label: "Spec YAML" },
  { id: "requests", label: "Requests" },
];
const starterYaml = `master-flow:\n  requests: []\nprepare: []\nworkloads: {}\npipeline:\n  main:\n    params: {}\n    nodes: []\n`;
const asObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

function nodeDependencyNames(node: PipelineNode): string[] {
  return (Array.isArray(node.depends_on) ? node.depends_on : []).map((dependency: any) => typeof dependency === "string" ? dependency : String(dependency?.node ?? dependency?.name ?? "")).filter(Boolean);
}

function layoutGraph(nodes: PipelineNode[]) {
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

function AppContent() {
  const [activeSpecSlug, setActiveSpecSlug] = useState("");
  const [activePipeline, setActivePipeline] = useState("");
  const [selectedNodeName, setSelectedNodeName] = useState("");
  const [activeTab, setActiveTab] = useState<ConfigTab>("pipeline");
  const [yamlDraft, setYamlDraft] = useState("");
  const [selectedWorkload, setSelectedWorkload] = useState("");
  const [modal, setModal] = useState<"spec" | "request" | null>(null);
  const [specUploadName, setSpecUploadName] = useState("");
  const [specNameDraft, setSpecNameDraft] = useState("");
  const [renameTarget, setRenameTarget] = useState<SpecItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [spaceMenuSlug, setSpaceMenuSlug] = useState<string | null>(null);
  const [creatingSpec, setCreatingSpec] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [workloadDraft, setWorkloadDraft] = useState("");
  const [nodeDraft, setNodeDraft] = useState("");

  const remoteSpecs = useQuery(api.specs.list, {});
  const specs: SpecItem[] = (remoteSpecs ?? []).map((spec, index) => ({ ...spec, color: ["violet", "blue", "green", "orange"][index % 4] })) as SpecItem[];
  const activeSpec = specs.find((spec) => spec.slug === activeSpecSlug) ?? specs[0];
  const remoteRequests = useQuery(api.requests.list, activeSpec ? { specSlug: activeSpec.slug } : "skip");
  const createSpec = useMutation(api.specs.create);
  const updateSpec = useMutation(api.specs.update);
  const renameSpec = useMutation(api.specs.rename);
  const removeSpec = useMutation(api.specs.remove);
  const createRequest = useMutation(api.requests.create);
  const connection = useConvexConnectionState();
  const requests: RequestItem[] = (remoteRequests ?? []).map((request) => ({
    id: `REQ-${String(request._id).slice(-4).toUpperCase()}`,
    convexId: request._id,
    title: request.title,
    spec: request.specSlug,
    pipelineName: request.pipelineName,
    status: ({ queued: "waiting", received: "possessed", running: "processing", success: "succeeded", complete: "succeeded", completed: "succeeded", failed: "process_failed" } as Record<string, string>)[request.status] ?? request.status,
    node: request.plan?.find((node: any) => node.status === "running")?.nodeName ?? request.currentNode ?? "Waiting",
    unit: request.unitId ?? "Unassigned",
    progress: request.progress,
    createdAt: request._creationTime,
    params: request.params as Record<string, unknown>,
    plan: Array.isArray(request.plan) && request.plan.length ? request.plan : Object.entries(asObject(request.nodeStates)).map(([nodeName, state]) => ({
      nodeName,
      status: ({ queued: "queue", queue: "queue", running: "running", failed: "failed", success: "succeeded", succeeded: "succeeded" } as Record<string, string>)[String(asObject(state).status)] ?? "queue",
      ...(asObject(state).device ? { device: asObject(state).device as { family?: string; index?: number } } : {}),
    })),
  }));
  const parsed = useMemo(() => {
    try { return asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml)); }
    catch { return {}; }
  }, [yamlDraft, activeSpec?.yaml]);
  const pipelineMap = asObject(parsed.pipeline);
  const pipelineNames = Object.keys(pipelineMap);
  const currentPipelineName = pipelineNames.includes(activePipeline) ? activePipeline : pipelineNames[0] ?? "";
  const pipelineConfig = asObject(pipelineMap[currentPipelineName]);
  const nodes: PipelineNode[] = Array.isArray(pipelineConfig.nodes) ? pipelineConfig.nodes : [];
  const currentNode = nodes.find((node) => String(node.name) === selectedNodeName) ?? nodes[0];
  const workloadMap = asObject(parsed.workloads);
  const workloadNames = Object.keys(workloadMap);
  const currentWorkloadName = workloadNames.includes(selectedWorkload) ? selectedWorkload : workloadNames[0] ?? "";
  const workloadConfig = asObject(workloadMap[currentWorkloadName]);
  const pipelineRequests = requests.filter((request) => (request.pipelineName ?? pipelineNames[0]) === currentPipelineName);
  const activeRequest = requests.find((request) => request.convexId === selectedRequest);
  const activeRequestPipelineNodes: PipelineNode[] = activeRequest
    ? (Array.isArray(asObject(asObject(parsed.pipeline)[activeRequest.pipelineName ?? pipelineNames[0]]).nodes)
      ? asObject(asObject(parsed.pipeline)[activeRequest.pipelineName ?? pipelineNames[0]]).nodes as PipelineNode[] : [])
    : [];
  const dirty = hasEdits;

  useEffect(() => {
    if (specs.length === 0) { setActiveSpecSlug(""); return; }
    const nextSpec = specs.find((spec) => spec.slug === activeSpecSlug) ?? specs[0];
    if (nextSpec.slug !== activeSpecSlug) setActiveSpecSlug(nextSpec.slug);
  }, [remoteSpecs]);
  useEffect(() => {
    if (!activeSpec) { setYamlDraft(""); return; }
    setYamlDraft(activeSpec.yaml);
    setActivePipeline("");
    setSelectedWorkload("");
    setSelectedRequest(null);
    setSelectedNodeName("");
    setError("");
    setHasEdits(false);
  }, [activeSpec?._id]);
  useEffect(() => { setWorkloadDraft(stringify(asObject(asObject(asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml)).workloads)[currentWorkloadName])).trimEnd()); }, [activeSpec?._id, currentWorkloadName]);
  useEffect(() => {
    if (!nodes.some((node) => String(node.name) === selectedNodeName)) setSelectedNodeName(String(nodes[0]?.name ?? ""));
  }, [activeSpec?._id, currentPipelineName, nodes.map((node) => node.name).join("|")]);
  useEffect(() => { setNodeDraft(currentNode ? stringify(currentNode).trimEnd() : ""); }, [activeSpec?._id, currentPipelineName, currentNode?.name]);

  function notice(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2200); }
  function editDocument(update: (document: Record<string, any>) => void) {
    try {
      if (error) throw new Error("Fix the current YAML error before making another structured edit.");
      const document = asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml));
      document.pipeline = asObject(document.pipeline);
      document.workloads = asObject(document.workloads);
      if (currentPipelineName) {
        document.pipeline[currentPipelineName] = asObject(document.pipeline[currentPipelineName]);
      }
      if (currentWorkloadName) document.workloads[currentWorkloadName] = workloadDraft.trim() ? asObject(parse(workloadDraft)) : {};
      update(document);
      setYamlDraft(stringify(document));
      setHasEdits(true);
      setError("");
    } catch (e) { setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML"); }
  }
  function changeSection(section: "prepare" | "master-flow", text: string) {
    try {
      const value = text.trim() ? parse(text) : section === "prepare" ? [] : {};
      editDocument((document) => { document[section] = value; });
    } catch (e) { setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML"); }
  }
  function changeWholeSpec(text: string) {
    setYamlDraft(text);
    setHasEdits(true);
    try {
      const value = parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The spec root must be a YAML mapping.");
      const pipelines = asObject(asObject(value).pipeline);
      const activePipelineConfig = asObject(pipelines[currentPipelineName]);
      const activeNode = (Array.isArray(activePipelineConfig.nodes) ? activePipelineConfig.nodes : []).find((node: PipelineNode) => String(node.name) === selectedNodeName);
      if (activeNode) setNodeDraft(stringify(activeNode).trimEnd());
      const activeWorkload = asObject(asObject(value).workloads)[currentWorkloadName];
      if (activeWorkload) setWorkloadDraft(stringify(activeWorkload).trimEnd());
      setError("");
    } catch (e) { setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML"); }
  }
  function changeWorkloadText(text: string) {
    setWorkloadDraft(text);
    setHasEdits(true);
    try {
      const value = text.trim() ? parse(text) : {};
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A workload must be a YAML mapping.");
      const document = asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml));
      document.workloads = asObject(document.workloads);
      document.workloads[currentWorkloadName] = value;
      setYamlDraft(stringify(document));
      setError("");
    } catch (e) { setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML"); }
  }
  function changeNodeDraft(text: string) {
    setNodeDraft(text);
    setHasEdits(true);
    try {
      const value = parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value) || !String(value.name ?? "").trim()) throw new Error("A node must be a YAML mapping with a name.");
      const document = asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml));
      const config = asObject(asObject(document.pipeline)[currentPipelineName]);
      const list: PipelineNode[] = Array.isArray(config.nodes) ? [...config.nodes] : [];
      const index = list.findIndex((node) => String(node.name) === String(currentNode?.name));
      if (index < 0) throw new Error("Selected node no longer exists.");
      list[index] = value;
      config.nodes = list;
      document.pipeline[currentPipelineName] = config;
      setYamlDraft(stringify(document));
      setSelectedNodeName(String(value.name));
      setError("");
    } catch (e) { setError(e instanceof Error ? `Node YAML: ${e.message}` : "Invalid YAML"); }
  }
  function addNode() {
    const name = `node_${nodes.length + 1}`;
    editDocument((document) => {
      const config = asObject(document.pipeline?.[currentPipelineName]);
      const list = Array.isArray(config.nodes) ? [...config.nodes] : [];
      list.push({ name, run: { workload: workloadNames[0] ?? "" } });
      config.nodes = list;
      document.pipeline[currentPipelineName] = config;
    });
    setSelectedNodeName(name);
  }
  function removeNode(name: string) {
    editDocument((document) => {
      const config = asObject(document.pipeline?.[currentPipelineName]);
      config.nodes = (Array.isArray(config.nodes) ? config.nodes : []).filter((node: PipelineNode) => String(node.name) !== name).map((node: PipelineNode) => ({
        ...node,
        ...(Array.isArray(node.depends_on) ? { depends_on: node.depends_on.filter((dependency: any) => String(typeof dependency === "string" ? dependency : dependency?.node ?? dependency?.name) !== name) } : {}),
      }));
      document.pipeline[currentPipelineName] = config;
    });
    setSelectedNodeName(nodes.find((node) => String(node.name) !== name)?.name ?? "");
  }
  function toggleDependency(dependencyName: string, enabled: boolean) {
    if (!currentNode) return;
    editDocument((document) => {
      const config = asObject(document.pipeline?.[currentPipelineName]);
      const list: PipelineNode[] = Array.isArray(config.nodes) ? [...config.nodes] : [];
      const index = list.findIndex((node) => String(node.name) === String(currentNode.name));
      if (index < 0) return;
      const node = { ...list[index] };
      const dependencies = Array.isArray(node.depends_on) ? [...node.depends_on] : [];
      const existing = dependencies.findIndex((dependency: any) => String(typeof dependency === "string" ? dependency : dependency?.node ?? dependency?.name) === dependencyName);
      if (enabled && existing < 0) dependencies.push({ node: dependencyName, condition: { operator: "node_status", expected: "succeeded" } });
      if (!enabled && existing >= 0) dependencies.splice(existing, 1);
      if (dependencies.length) node.depends_on = dependencies;
      else delete node.depends_on;
      list[index] = node;
      config.nodes = list;
      document.pipeline[currentPipelineName] = config;
    });
  }
  function addPipeline() {
    const name = `pipeline_${pipelineNames.length + 1}`;
    editDocument((document) => { document.pipeline = { ...asObject(document.pipeline), [name]: { params: {}, nodes: [] } }; });
    setActivePipeline(name);
  }
  function removePipeline() {
    if (!currentPipelineName) return;
    editDocument((document) => { const next = { ...asObject(document.pipeline) }; delete next[currentPipelineName]; document.pipeline = next; });
    setActivePipeline(pipelineNames.find((name) => name !== currentPipelineName) ?? "");
  }
  function addWorkload() {
    const name = `workload_${workloadNames.length + 1}`;
    editDocument((document) => { document.workloads = { ...asObject(document.workloads), [name]: { target: "", units: 0 } }; });
    setSelectedWorkload(name);
  }
  function removeWorkload() {
    if (!currentWorkloadName) return;
    editDocument((document) => { const next = { ...asObject(document.workloads) }; delete next[currentWorkloadName]; document.workloads = next; });
    setSelectedWorkload(workloadNames.find((name) => name !== currentWorkloadName) ?? "");
  }
  async function saveSpec() {
    if (!activeSpec) return;
    try {
      const parsedDocument = parse(yamlDraft);
      if (!parsedDocument || typeof parsedDocument !== "object" || Array.isArray(parsedDocument)) throw new Error("The spec root must be a YAML mapping.");
      setSaving(true);
      const savedYaml = yamlDraft;
      await updateSpec({ id: activeSpec._id as never, name: activeSpec.name, description: activeSpec.description, yaml: savedYaml });
      setYamlDraft(savedYaml);
      setHasEdits(false);
      setError("");
      notice("Space saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this space"); }
    finally { setSaving(false); }
  }
  async function addSpec(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("specFile");
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    try {
      if (!name) throw new Error("Add a name for this spec space.");
      let yaml = starterYaml;
      let document: Record<string, any> = asObject(parse(starterYaml));
      if (file instanceof File && file.size > 0) {
        if (!/\.ya?ml$/i.test(file.name)) throw new Error("Choose a .yaml or .yml file.");
        yaml = await file.text();
        const parsedFile = parse(yaml);
        if (!parsedFile || typeof parsedFile !== "object" || Array.isArray(parsedFile)) throw new Error("The spec file must have a YAML mapping at its root.");
        document = parsedFile as Record<string, any>;
        if (document.pipeline !== undefined && (!document.pipeline || typeof document.pipeline !== "object" || Array.isArray(document.pipeline))) throw new Error("The pipeline section must be a mapping of pipeline names to definitions.");
      }
      const pipelines = asObject(document.pipeline);
      Object.entries(pipelines).forEach(([pipelineName, config]) => {
        const pipelineNodes = asObject(config).nodes;
        if (pipelineNodes !== undefined && !Array.isArray(pipelineNodes)) throw new Error(`pipeline.${pipelineName}.nodes must be a list.`);
      });
      const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `spec-${Date.now()}`;
      setCreatingSpec(true);
      await createSpec({ name, slug, description, yaml });
      setModal(null);
      setActiveSpecSlug(slug);
      setSpecUploadName("");
      setSpecNameDraft("");
      notice(file instanceof File && file.size > 0 ? "Spec uploaded to new space" : "Space created");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create space"); }
    finally { setCreatingSpec(false); }
  }
  function openSpecModal() { setError(""); setSpecUploadName(""); setSpecNameDraft(""); setModal("spec"); }
  async function addRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSpec || !currentPipelineName) return;
    const data = new FormData(event.currentTarget);
    const params: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) if (key.startsWith("param:")) params[key.slice(6)] = String(value);
    try {
      await createRequest({ specSlug: activeSpec.slug, pipelineName: currentPipelineName, title: String(data.get("title") || "New request"), params, status: "waiting" });
      setModal(null);
      notice("Request added");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create request"); }
  }
  function openSpec(spec: SpecItem) { setActiveSpecSlug(spec.slug); setActiveTab("pipeline"); setError(""); }
  function openRename(spec: SpecItem) { setError(""); setRenameTarget(spec); setRenameDraft(spec.name); setSpaceMenuSlug(null); setRenameOpen(true); }
  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;
    try {
      await renameSpec({ id: renameTarget._id as never, name: renameDraft.trim() });
      setRenameOpen(false);
      setRenameTarget(null);
      notice("Space renamed");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not rename space"); }
  }
  async function deleteSpace(spec: SpecItem) {
    setSpaceMenuSlug(null);
    if (!window.confirm(`Delete “${spec.name}” and all its requests? This cannot be undone.`)) return;
    try {
      const result = await removeSpec({ id: spec._id as never });
      if (activeSpec?.slug === spec.slug) {
        setActiveSpecSlug("");
        setSelectedRequest(null);
        setHasEdits(false);
      }
      notice(`Space deleted · ${result.deletedRequests} request${result.deletedRequests === 1 ? "" : "s"} removed`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete space"); }
  }

  return <div className={dark ? "desktop-shell dark" : "desktop-shell"}>
    <aside className="space-sidebar">
      <div className="desktop-brand"><span className="brand-icon">m</span><span>MasterFlow</span><span className={connection.isWebSocketConnected ? "connection-dot connected" : "connection-dot"} title={connection.isWebSocketConnected ? "Connected to Convex" : "Connecting to Convex"}/></div>
      <button className="new-space-button" onClick={openSpecModal}><span>＋</span> New spec</button>
      <div className="spaces-heading">SPACES <span>{specs.length}</span></div>
      <div className="space-list">{specs.map((spec) => <div key={spec.slug} className={`space-entry ${activeSpec?.slug === spec.slug ? "selected" : ""}`}><button className={`space-item ${activeSpec?.slug === spec.slug ? "selected" : ""}`} onClick={() => { openSpec(spec); setSpaceMenuSlug(null); }}><span className={`space-mark ${spec.color}`}>{spec.name.slice(0, 1).toUpperCase()}</span><span className="space-name">{spec.name}</span></button><button className="space-menu-trigger" aria-label={`Actions for ${spec.name}`} title="Space actions" onClick={() => setSpaceMenuSlug(spaceMenuSlug === spec.slug ? null : spec.slug)}>···</button>{spaceMenuSlug === spec.slug && <div className="space-menu"><button onClick={() => openRename(spec)}>Rename</button><button className="danger" onClick={() => void deleteSpace(spec)}>Delete space</button></div>}</div>)}</div>
      {specs.length === 0 && <div className="sidebar-empty">Create a spec to start a space.</div>}
      <div className="sidebar-bottom"><div className="sidebar-status">{connection.isWebSocketConnected ? "Convex connected" : "Connecting to Convex"}</div><button className="theme-button" onClick={() => setDark(!dark)}><span>{dark ? "☼" : "☾"}</span> {dark ? "Light appearance" : "Dark appearance"}</button></div>
    </aside>
    <main className="work-area">
      {activeSpec ? <>
        <header className="work-header"><div className="space-heading"><span className={`space-mark large ${activeSpec.color}`}>{activeSpec.name.slice(0, 1).toUpperCase()}</span><div><h1>{activeSpec.name}</h1><p>{activeSpec.description || activeSpec.slug}</p></div></div><div className="header-actions">{dirty && <span className="unsaved-label">Unsaved changes</span>}<button className="save-button" onClick={() => void saveSpec()} disabled={!dirty || saving || Boolean(error)}>{saving ? "Saving…" : "Save changes"}</button><button className="request-button" onClick={() => { setError(""); setModal("request"); }} disabled={!currentPipelineName}>＋ New request</button></div></header>
        <nav className="section-tabs" aria-label="Space sections">{tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => { setActiveTab(tab.id); setSelectedRequest(null); }}>{tab.label}{tab.id === "requests" && requests.length > 0 && <span className="tab-count">{requests.length}</span>}</button>)}</nav>
        <div className="editor-scroll">
          {activeTab === "pipeline" && <section className="editor-view">
            <div className="view-heading"><div><span className="view-kicker">DEPENDENCY GRAPH</span><h2>Pipeline graph</h2><p>Nodes run when their <code>depends_on</code> conditions are met. Unlinked nodes are independent.</p></div><button className="subtle-button" onClick={addPipeline}>＋ Add pipeline</button></div>
            {pipelineNames.length > 0 ? <>
              <div className="pipeline-switcher">{pipelineNames.map((name) => <button key={name} className={currentPipelineName === name ? "chosen" : ""} onClick={() => setActivePipeline(name)}>{name}</button>)}{pipelineNames.length > 1 && <button className="remove-pipeline" onClick={removePipeline}>Remove pipeline</button>}</div>
              <div className="graph-layout">
                <div className="graph-main">
                  <div className="graph-toolbar"><div><b>{nodes.length} nodes</b><small>Click a node to inspect its complete configuration.</small></div><button className="subtle-button" onClick={addNode}>＋ Add node</button></div>
                  <DependencyGraph nodes={nodes} selected={String(currentNode?.name ?? "")} onSelect={setSelectedNodeName}/>
                </div>
                <aside className="node-inspector">
                  {currentNode ? <>
                    <div className="inspector-heading"><div><span className="view-kicker">NODE CONFIGURATION</span><h3>{String(currentNode.name)}</h3></div><button className="icon-action" onClick={() => removeNode(String(currentNode.name))} aria-label={`Remove ${String(currentNode.name)}`}>×</button></div>
                    <p className="inspector-help">Edit the full node YAML. Conditions, context, hooks, workload/action runs, and custom fields are preserved.</p>
                    <label className="advanced-label">Depends on<small>Each edge defaults to predecessor status = succeeded. Edit its condition below as YAML.</small></label>
                    <div className="dependency-checks">{nodes.filter((node) => String(node.name) !== String(currentNode.name)).map((node) => <label key={String(node.name)}><input type="checkbox" checked={nodeDependencyNames(currentNode).includes(String(node.name))} onChange={(event) => toggleDependency(String(node.name), event.target.checked)}/><span>{String(node.name)}</span></label>)}</div>
                    <label className="advanced-label node-yaml-label">Full node definition<textarea className="code-editor node-code" spellCheck={false} value={nodeDraft} onChange={(event) => changeNodeDraft(event.target.value)} /></label>
                  </> : <div className="inspector-empty"><b>No node selected</b><small>Add nodes to make a pipeline graph.</small></div>}
                </aside>
              </div>
            </> : <div className="empty-editor"><span>⌘</span><b>No pipelines yet</b><small>Add a pipeline to define how requests are processed.</small><button className="subtle-button" onClick={addPipeline}>Add a pipeline</button></div>}
          </section>}
          {activeTab === "prepare" && <ConfigEditor title="Prepare" description="Pre-run actions, skip rules, preconditions, and postconditions." value={stringify(parsed.prepare ?? []).trimEnd()} onChange={(text) => changeSection("prepare", text)} placeholder={'- type: execute-commands\n  commands:\n    - target: hf\n      args: [download, repo, model.gguf]'} />}
          {activeTab === "master-flow" && <ConfigEditor title="Master flow" description="URL based request sources, pipeline assignment, headers, and refresh behavior." value={stringify(parsed["master-flow"] ?? {}).trimEnd()} onChange={(text) => changeSection("master-flow", text)} placeholder={'requests:\n  - url: "https://..."\n    header: {}\n    pipeline: song-with-cover\n    refresh_after_done: true'} />}
          {activeTab === "spec-yaml" && <ConfigEditor title="Complete spec.yaml" description="Edit every spec field directly. Fields not shown in other views stay here unchanged." value={yamlDraft} onChange={changeWholeSpec} placeholder={starterYaml} />}
          {activeTab === "workloads" && <section className="editor-view"><div className="view-heading"><div><span className="view-kicker">EXECUTABLES</span><h2>Workloads</h2><p>Reusable commands that pipeline steps can run.</p></div><button className="subtle-button" onClick={addWorkload}>＋ Add workload</button></div>{workloadNames.length > 0 ? <div className="workload-layout"><div className="workload-list">{workloadNames.map((name) => <button key={name} className={name === currentWorkloadName ? "chosen" : ""} onClick={() => setSelectedWorkload(name)}><span className="workload-glyph">⌘</span>{name}</button>)}</div><div className="workload-detail"><div className="workload-detail-title"><b>{currentWorkloadName}</b><button className="icon-action" onClick={removeWorkload} aria-label="Remove workload">×</button></div><div className="field-row"><label>Target<input value={String(workloadConfig.target ?? "")} onChange={(event) => editDocument((document) => { document.workloads[currentWorkloadName] = { ...asObject(document.workloads[currentWorkloadName]), target: event.target.value }; })} placeholder="/path/to/executable" /></label><label>Units<input type="number" min="0" value={Number(workloadConfig.units ?? 0)} onChange={(event) => editDocument((document) => { document.workloads[currentWorkloadName] = { ...asObject(document.workloads[currentWorkloadName]), units: Number(event.target.value) }; })} /></label></div><label className="advanced-label">Full workload definition<small>Edit params, args, environment, and device options as YAML.</small><textarea className="code-editor workload-code" spellCheck={false} value={workloadDraft} onChange={(event) => changeWorkloadText(event.target.value)} /></label></div></div> : <div className="empty-editor"><span>⌘</span><b>No workloads yet</b><small>Add a workload that pipeline steps can call.</small><button className="subtle-button" onClick={addWorkload}>Add a workload</button></div>}</section>}
          {activeTab === "requests" && <section className="editor-view requests-view"><div className="view-heading"><div><span className="view-kicker">RUNS</span><h2>Requests</h2><p>{currentPipelineName ? `Requests attached to ${currentPipelineName}.` : "Add a pipeline before creating requests."}</p></div><button className="subtle-button primary-subtle" onClick={() => setModal("request")} disabled={!currentPipelineName}>＋ New request</button></div>{pipelineNames.length > 1 && <div className="pipeline-switcher request-pipelines">{pipelineNames.map((name) => <button key={name} className={currentPipelineName === name ? "chosen" : ""} onClick={() => setActivePipeline(name)}>{name}</button>)}</div>}{pipelineRequests.length > 0 ? <div className="request-list">{pipelineRequests.map((request) => <button key={request.convexId} className={`request-row ${selectedRequest === request.convexId ? "selected" : ""}`} onClick={() => setSelectedRequest(selectedRequest === request.convexId ? null : request.convexId)}><span className="request-icon">▤</span><span className="request-copy"><b>{request.title}</b><small>{request.id} · {Object.entries(request.params).map(([key, value]) => `${key}: ${String(value)}`).slice(0, 2).join(" · ") || "No parameters"}</small></span><Status status={request.status}/><span className="request-stage">{request.node}</span><span className="request-progress"><i><b className={request.status} style={{ width: `${request.progress}%` }}/></i>{request.progress}%</span><span className="request-chevron">{selectedRequest === request.convexId ? "⌄" : "›"}</span></button>)}</div> : <div className="empty-editor"><span>▤</span><b>No requests for {currentPipelineName || "this pipeline"}</b><small>Create a request to run this pipeline.</small><button className="subtle-button" onClick={() => setModal("request")} disabled={!currentPipelineName}>Create request</button></div>}{activeRequest && <div className="request-detail"><div><b>{activeRequest.title}</b><Status status={activeRequest.status}/></div><p>Current step: {activeRequest.node} · {activeRequest.unit}</p><div className="request-params">{Object.entries(activeRequest.params).map(([key, value]) => <span key={key}><small>{key}</small>{String(value)}</span>)}</div><div className="request-plan-view"><b>Pipeline execution · {activeRequest.pipelineName ?? pipelineNames[0] ?? "pipeline"}</b><DependencyGraph nodes={activeRequestPipelineNodes} selected={activeRequest.node} onSelect={() => undefined} plan={activeRequest.plan} readOnly/></div></div>}</section>}
        </div>
        {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
      </> : <div className="welcome-view"><div className="welcome-mark">m</div><h1>What are you building?</h1><p>Create a spec to make a new space for your pipeline configuration and requests.</p><button className="request-button" onClick={openSpecModal}>＋ Create your first spec</button>{error && <div className="inline-error">{error}</div>}</div>}
    </main>
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><form className="simple-modal" onClick={(event) => event.stopPropagation()} onSubmit={modal === "spec" ? addSpec : addRequest}><div className="modal-top"><div className="modal-icon">{modal === "spec" ? "◫" : "▤"}</div><button type="button" className="icon-action" onClick={() => setModal(null)}>×</button></div><h2>{modal === "spec" ? "Create a spec" : "New request"}</h2><p>{modal === "spec" ? "Create a space from scratch or upload an existing spec.yaml." : `Add a request to ${currentPipelineName}.`}</p>{modal === "spec" ? <><label>Space name<input name="name" autoFocus required value={specNameDraft} onChange={(event) => setSpecNameDraft(event.target.value)} placeholder="e.g. Song with cover" /></label><label>Description<input name="description" placeholder="What does this spec do?" /></label><label className="spec-upload">Existing spec.yaml<span className="spec-upload-control"><span className="upload-glyph">↑</span><span><b>{specUploadName || "Choose a YAML file"}</b><small>{specUploadName ? "This file will be saved as the space spec." : "Upload .yaml or .yml from your computer"}</small></span><input name="specFile" type="file" accept=".yaml,.yml,application/yaml,text/yaml,text/plain" onChange={(event) => { const file = event.target.files?.[0]; setSpecUploadName(file?.name ?? ""); if (file && !specNameDraft) setSpecNameDraft(file.name.replace(/\.ya?ml$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())); }} /></span></label><div className="form-hint">The uploaded YAML is validated and kept as the full spec. Pipeline params and nodes are indexed for the editor.</div></> : <><label>Request name<input name="title" autoFocus required placeholder="Give this run a name" /></label>{Object.entries(asObject(pipelineConfig.params)).map(([name, raw]) => { const definition = asObject(raw); const multiline = definition.type === "string" && (name.toLowerCase().includes("prompt") || name.toLowerCase().includes("lyrics")); return <label key={name}>{name}{multiline ? <textarea name={`param:${name}`} rows={3} placeholder={`Enter ${name}`} /> : <input name={`param:${name}`} placeholder={`Enter ${name}`} />}</label>; })}{Object.keys(asObject(pipelineConfig.params)).length === 0 && <div className="form-hint">This pipeline has no declared parameters yet. You can add them in Spec YAML.</div>}</>}{modal === "spec" && error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={() => setModal(null)}>Cancel</button><button className="request-button" type="submit" disabled={creatingSpec}>{modal === "spec" ? creatingSpec ? "Creating…" : "Create space" : "Create request"}</button></div></form></div>}
    {renameOpen && <div className="modal-backdrop" onClick={() => setRenameOpen(false)}><form className="simple-modal" onClick={(event) => event.stopPropagation()} onSubmit={submitRename}><div className="modal-top"><div className="modal-icon">✎</div><button type="button" className="icon-action" onClick={() => setRenameOpen(false)}>×</button></div><h2>Rename space</h2><p>Choose a new name for this space.</p><label>Space name<input autoFocus required value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="subtle-button" onClick={() => setRenameOpen(false)}>Cancel</button><button className="request-button" type="submit" disabled={!renameDraft.trim()}>Rename space</button></div></form></div>}
    {toast && <div className="toast">✓ {toast}</div>}
  </div>;
}

function ConfigEditor({ title, description, value, onChange, placeholder }: { title: string; description: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <section className={`editor-view ${title === "Complete spec.yaml" ? "full-spec-view" : ""}`}><div className="view-heading"><div><span className="view-kicker">SPACE CONFIGURATION</span><h2>{title}</h2><p>{description}</p></div></div><div className="config-code-panel"><div className="editor-toolbar"><span className="file-dot"/><b>{title.toLowerCase().replace(/ /g, "-")}.yaml</b><small>YAML</small></div><textarea className="code-editor config-code" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/></div></section>;
}
function DependencyGraph({ nodes, selected, onSelect, plan = [], readOnly = false }: { nodes: PipelineNode[]; selected: string; onSelect: (name: string) => void; plan?: RequestItem["plan"]; readOnly?: boolean }) {
  const { positions, width, height } = layoutGraph(nodes);
  const validNames = new Set(nodes.map((node) => String(node.name)));
  const planByNode = new Map(plan.map((item) => [item.nodeName, item]));
  return <div className="graph-viewport"><div className="graph-canvas" style={{ width, height }}>
    <svg className="graph-edges" width={width} height={height} aria-hidden="true">
      <defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>
      {nodes.flatMap((node) => nodeDependencyNames(node).filter((name) => validNames.has(name)).map((dependency) => {
        const from = positions.get(dependency); const to = positions.get(String(node.name));
        if (!from || !to) return null;
        const x1 = from.x + 190; const y1 = from.y + 42; const x2 = to.x; const y2 = to.y + 42; const bend = Math.max(35, (x2 - x1) / 2);
        return <path key={`${dependency}-${String(node.name)}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd="url(#graph-arrow)"/>;
      }))}
    </svg>
    {nodes.map((node, index) => {
      const name = String(node.name || `node_${index + 1}`); const position = positions.get(name) ?? { x: 30, y: 34 };
      const run = node.run; const workload = asObject(run).workload;
      const runLabel = typeof workload === "string" ? workload : Array.isArray(run) ? `${run.length} actions` : run ? "Custom run" : "No run defined";
      const execution = planByNode.get(name);
      const nodeStatus = execution?.status ?? (plan.length ? "not_started" : "");
      const nodeLabel: Record<string, string> = { queue: "Queued", running: "Running", failed: "Failed", succeeded: "Succeeded", not_started: "Not started" };
      return <div key={`${name}-${index}`} className={`graph-node ${name === selected ? "selected" : ""} ${nodeStatus ? `execution-${nodeStatus}` : ""} ${readOnly ? "read-only" : ""}`} style={{ left: position.x, top: position.y }} onClick={() => !readOnly && onSelect(name)} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0} onKeyDown={(event) => { if (!readOnly && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(name); } }}>
        <span className="graph-node-index">{String(index + 1).padStart(2, "0")}</span><b>{name}</b><small>{readOnly ? nodeLabel[nodeStatus] ?? "Not reported" : runLabel}</small>
        <span className="graph-node-meta">{readOnly && execution?.device ? `${execution.device.family ?? "device"} · ${execution.device.index ?? "?"}` : nodeDependencyNames(node).length ? `← ${nodeDependencyNames(node).length} dependencies` : "Independent node"}</span>
      </div>;
    })}
    {nodes.length === 0 && <div className="graph-empty">No nodes in this pipeline yet.</div>}
  </div></div>;
}
function Status({ status }: { status: string }) { const labels: Record<string, string> = { waiting: "Waiting", possessed: "Possessed", processing: "Processing", process_failed: "Process failed", artifact_available: "Artifact available", retrieve_artifact_failed: "Artifact retrieval failed", succeeded: "Succeeded" }; return <span className={`status-tag ${status}`}><i/>{labels[status] ?? status}</span>; }
function App() { return <AppContent/>; }
export default App;

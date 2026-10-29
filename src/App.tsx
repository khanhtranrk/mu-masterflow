import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { parse, stringify } from "yaml";
import { ConfigEditor } from "./components/ConfigEditor";
import { PipelineEditor } from "./components/PipelineEditor";
import { RequestsView } from "./components/RequestsView";
import { NotificationsView } from "./components/NotificationsView";
import { SettingsView } from "./components/SettingsView";
import { SpecHeader, SectionTabs } from "./components/SpecHeader";
import { SpecSidebar } from "./components/SpecSidebar";
import { SpecDialogs } from "./components/SpecDialogs";
import { WorkloadsEditor } from "./components/WorkloadsEditor";
import { asObject, starterYaml } from "./specUtils";
import { sendSystemNotification } from "./systemNotifications";
import { useAuthActions } from "@convex-dev/auth/react";
import type { ConvexServerProfile } from "./connectionSettings";
import type { ConnectionSettings } from "./connectionSettings";
import type { ConfigTab, PipelineNode, RequestItem, SpecItem } from "./types";
import "./App.css";
import "./graph.css";
import "./space-actions.css";
import "./request-details.css";
import "./auth-tokens.css";
import "./notifications.css";
import "./settings.css";

type AppProps = {
  serverProfile: ConvexServerProfile;
  darkMode: boolean;
  onSetDarkMode: (darkMode: boolean) => Promise<void>;
  serverSettings: ConnectionSettings;
  onSaveServerSettings: (settings: ConnectionSettings) => Promise<void>;
  onConnectServer: (profileId: string) => Promise<void>;
  onDisconnectServer: () => Promise<void>;
};

function App({
  serverProfile,
  darkMode,
  onSetDarkMode,
  serverSettings,
  onSaveServerSettings,
  onConnectServer,
  onDisconnectServer,
}: AppProps) {
  const [activeSpecSlug, setActiveSpecSlug] = useState("");
  const [notificationsActive, setNotificationsActive] = useState(false);
  const [settingsActive, setSettingsActive] = useState(false);
  const [incomingNotification, setIncomingNotification] = useState<{ title: string; message: string } | null>(null);
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
  const [specMenuSlug, setSpecMenuSlug] = useState<string | null>(null);
  const [creatingSpec, setCreatingSpec] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [workloadDraft, setWorkloadDraft] = useState("");
  const [nodeDraft, setNodeDraft] = useState("");
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const { signOut } = useAuthActions();

  const remoteSpecs = useQuery(api.specs.list, {});
  const remoteNotifications = useQuery(api.notifications.list, { limit: 100 });
  const unreadNotificationCount = remoteNotifications?.filter((notification) => notification.readAt === undefined).length ?? 0;
  const specs: SpecItem[] = (remoteSpecs ?? []).map((spec, index) => ({
    ...spec,
    color: ["violet", "blue", "green", "orange"][index % 4],
  })) as SpecItem[];
  const activeSpec = specs.find((spec) => spec.slug === activeSpecSlug) ?? specs[0];
  const remoteRequests = useQuery(api.requests.list, activeSpec ? { specSlug: activeSpec.slug } : "skip");
  const remoteUnits = useQuery(api.units.list, {});
  const createSpec = useMutation(api.specs.create);
  const updateSpec = useMutation(api.specs.update);
  const renameSpec = useMutation(api.specs.rename);
  const removeSpec = useMutation(api.specs.remove);
  const createRequest = useMutation(api.requests.create);
  const connection = useConvexConnectionState();

  useEffect(() => {
    if (remoteNotifications === undefined) return;
    const currentIds = new Set(remoteNotifications.map((notification) => notification._id));
    if (seenNotificationIds.current === null) {
      seenNotificationIds.current = currentIds;
      return;
    }

    const newNotifications = remoteNotifications
      .filter((notification) => !seenNotificationIds.current?.has(notification._id))
      .reverse();
    seenNotificationIds.current = currentIds;
    if (newNotifications.length === 0) return;

    if (document.visibilityState === "visible" && document.hasFocus()) {
      const notification = newNotifications[newNotifications.length - 1];
      setIncomingNotification({ title: notification.title, message: notification.message });
    } else {
      for (const notification of newNotifications) {
        void sendSystemNotification(notification.title, notification.message).catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : "Could not send system notification.");
        });
      }
    }
  }, [remoteNotifications]);

  useEffect(() => {
    if (!incomingNotification) return;
    const timeout = window.setTimeout(() => setIncomingNotification(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [incomingNotification]);

  const requests: RequestItem[] = (remoteRequests ?? []).map((request) => {
    const id = `REQ-${String(request._id).slice(-4).toUpperCase()}`;
    const payload = request.payload;
    const payloadObject = asObject(payload);
    return {
      id,
      convexId: request._id,
      title: typeof payloadObject.title === "string" ? payloadObject.title : id,
      pipelineName: request.pipelineName,
      status: ({
        waitting: "waiting",
        queued: "waiting",
        received: "possessed",
        running: "processing",
        success: "succeeded",
        complete: "succeeded",
        completed: "succeeded",
        failed: "process_failed",
      } as Record<string, string>)[request.status] ?? request.status,
      createdAt: request._creationTime,
      payload,
      unitId: request.unitId,
      nodeStates: asObject(request.nodeStates) as RequestItem["nodeStates"],
    };
  });
  const parsed = useMemo(() => {
    try {
      return asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml));
    } catch {
      return {};
    }
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
    if (specs.length === 0) {
      setActiveSpecSlug("");
      return;
    }
    const nextSpec = specs.find((spec) => spec.slug === activeSpecSlug) ?? specs[0];
    if (nextSpec.slug !== activeSpecSlug) setActiveSpecSlug(nextSpec.slug);
  }, [remoteSpecs]);

  useEffect(() => {
    if (!activeSpec) {
      setYamlDraft("");
      return;
    }
    setYamlDraft(activeSpec.yaml);
    setActivePipeline("");
    setSelectedWorkload("");
    setSelectedRequest(null);
    setSelectedNodeName("");
    setError("");
    setHasEdits(false);
  }, [activeSpec?._id]);

  useEffect(() => {
    setWorkloadDraft(stringify(asObject(asObject(asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml)).workloads)[currentWorkloadName])).trimEnd());
  }, [activeSpec?._id, currentWorkloadName]);

  useEffect(() => {
    if (!nodes.some((node) => String(node.name) === selectedNodeName)) setSelectedNodeName(String(nodes[0]?.name ?? ""));
  }, [activeSpec?._id, currentPipelineName, nodes.map((node) => node.name).join("|")]);

  useEffect(() => {
    setNodeDraft(currentNode ? stringify(currentNode).trimEnd() : "");
  }, [activeSpec?._id, currentPipelineName, currentNode?.name]);

  function notice(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function editDocument(update: (document: Record<string, any>) => void) {
    try {
      if (error) throw new Error("Fix the current YAML error before making another structured edit.");
      const document = asObject(parse(yamlDraft || activeSpec?.yaml || starterYaml));
      document.pipeline = asObject(document.pipeline);
      document.workloads = asObject(document.workloads);
      if (currentPipelineName) document.pipeline[currentPipelineName] = asObject(document.pipeline[currentPipelineName]);
      if (currentWorkloadName) document.workloads[currentWorkloadName] = workloadDraft.trim() ? asObject(parse(workloadDraft)) : {};
      update(document);
      setYamlDraft(stringify(document));
      setHasEdits(true);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML");
    }
  }

  function changeSection(section: "prepare" | "master-flow", text: string) {
    try {
      const value = text.trim() ? parse(text) : section === "prepare" ? [] : {};
      editDocument((document) => { document[section] = value; });
    } catch (e) {
      setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML");
    }
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
    } catch (e) {
      setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML");
    }
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
    } catch (e) {
      setError(e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML");
    }
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
    } catch (e) {
      setError(e instanceof Error ? `Node YAML: ${e.message}` : "Invalid YAML");
    }
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
    editDocument((document) => {
      const next = { ...asObject(document.pipeline) };
      delete next[currentPipelineName];
      document.pipeline = next;
    });
    setActivePipeline(pipelineNames.find((name) => name !== currentPipelineName) ?? "");
  }

  function addWorkload() {
    const name = `workload_${workloadNames.length + 1}`;
    editDocument((document) => { document.workloads = { ...asObject(document.workloads), [name]: { target: "", units: 0 } }; });
    setSelectedWorkload(name);
  }

  function removeWorkload() {
    if (!currentWorkloadName) return;
    editDocument((document) => {
      const next = { ...asObject(document.workloads) };
      delete next[currentWorkloadName];
      document.workloads = next;
    });
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
      notice("Spec saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this spec");
    } finally {
      setSaving(false);
    }
  }

  async function addSpec(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("specFile");
    const name = String(data.get("name") || "").trim();
    const description = String(data.get("description") || "").trim();
    try {
      if (!name) throw new Error("Add a name for this spec.");
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
      notice(file instanceof File && file.size > 0 ? "Spec uploaded" : "Spec created");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create spec");
    } finally {
      setCreatingSpec(false);
    }
  }

  function openSpecModal() {
    setNotificationsActive(false);
    setSettingsActive(false);
    setError("");
    setSpecUploadName("");
    setSpecNameDraft("");
    setModal("spec");
  }

  async function addRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSpec || !currentPipelineName) return;
    const data = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) if (key.startsWith("param:")) payload[key.slice(6)] = String(value);
    try {
      await createRequest({ specSlug: activeSpec.slug, pipelineName: currentPipelineName, payload });
      setModal(null);
      notice("Request added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create request");
    }
  }

  function openSpec(spec: SpecItem) {
    setActiveSpecSlug(spec.slug);
    setNotificationsActive(false);
    setSettingsActive(false);
    setActiveTab("pipeline");
    setError("");
  }

  function openNotifications() {
    setNotificationsActive(true);
    setSettingsActive(false);
    setModal(null);
    setError("");
    setIncomingNotification(null);
  }

  function openSettings() {
    setSettingsActive(true);
    setNotificationsActive(false);
    setModal(null);
    setError("");
  }

  async function toggleTheme() {
    try {
      await onSetDarkMode(!darkMode);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save appearance settings.");
    }
  }

  function openRename(spec: SpecItem) {
    setError("");
    setRenameTarget(spec);
    setRenameDraft(spec.name);
    setSpecMenuSlug(null);
    setRenameOpen(true);
  }

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameTarget) return;
    try {
      await renameSpec({ id: renameTarget._id as never, name: renameDraft.trim() });
      setRenameOpen(false);
      setRenameTarget(null);
      notice("Spec renamed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename spec");
    }
  }

  async function archiveSpec(spec: SpecItem) {
    setSpecMenuSlug(null);
    if (!window.confirm(`Archive “${spec.name}”? It will be hidden from the specs list; its requests will be kept.`)) return;
    try {
      await removeSpec({ id: spec._id as never });
      if (activeSpec?.slug === spec.slug) {
        setActiveSpecSlug("");
        setSelectedRequest(null);
        setHasEdits(false);
      }
      notice("Spec archived");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive spec");
    }
  }

  function openRequestModal() {
    setError("");
    setModal("request");
  }

  async function signOutAccount() {
    try {
      await signOut();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign out.");
    }
  }

  return (
    <div className={darkMode ? "desktop-shell dark" : "desktop-shell"}>
      <SpecSidebar
        specs={specs}
        activeSpec={notificationsActive || settingsActive ? undefined : activeSpec}
        connected={connection.isWebSocketConnected}
        dark={darkMode}
        serverName={serverProfile.name}
        specMenuSlug={specMenuSlug}
        notificationsActive={notificationsActive}
        settingsActive={settingsActive}
        notificationCount={unreadNotificationCount}
        onCreate={openSpecModal}
        onOpenNotifications={openNotifications}
        onOpenSettings={openSettings}
        onOpen={(spec) => { openSpec(spec); setSpecMenuSlug(null); }}
        onToggleMenu={(slug) => setSpecMenuSlug(specMenuSlug === slug ? null : slug)}
        onRename={openRename}
        onDelete={(spec) => void archiveSpec(spec)}
      />
      <main className="work-area">
        {settingsActive ? (
          <SettingsView
            serverProfile={serverProfile}
            serverSettings={serverSettings}
            darkMode={darkMode}
            error={error}
            onSaveServerSettings={onSaveServerSettings}
            onConnectServer={onConnectServer}
            onDisconnectServer={onDisconnectServer}
            onToggleTheme={() => void toggleTheme()}
            onSignOut={() => void signOutAccount()}
          />
        ) : notificationsActive ? (
          <div className="editor-scroll">
            <NotificationsView />
            {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
          </div>
        ) : activeSpec ? (
          <>
            <SpecHeader
              spec={activeSpec}
              dirty={dirty}
              saving={saving}
              error={error}
              hasPipeline={Boolean(currentPipelineName)}
              onSave={() => void saveSpec()}
              onNewRequest={openRequestModal}
            />
            <SectionTabs
              activeTab={activeTab}
              requestCount={requests.length}
              onChange={(tab) => { setActiveTab(tab); setSelectedRequest(null); }}
            />
            <div className="editor-scroll">
              {activeTab === "pipeline" && (
                <PipelineEditor
                  pipelineNames={pipelineNames}
                  currentPipelineName={currentPipelineName}
                  nodes={nodes}
                  currentNode={currentNode}
                  nodeDraft={nodeDraft}
                  onSelectPipeline={setActivePipeline}
                  onAddPipeline={addPipeline}
                  onRemovePipeline={removePipeline}
                  onAddNode={addNode}
                  onSelectNode={setSelectedNodeName}
                  onRemoveNode={removeNode}
                  onToggleDependency={toggleDependency}
                  onChangeNodeDraft={changeNodeDraft}
                />
              )}
              {activeTab === "prepare" && (
                <ConfigEditor
                  title="Prepare"
                  description="Pre-run actions, skip rules, preconditions, and postconditions."
                  value={stringify(parsed.prepare ?? []).trimEnd()}
                  onChange={(text) => changeSection("prepare", text)}
                  placeholder={'- type: execute-commands\n  commands:\n    - target: hf\n      args: [download, repo, model.gguf]'}
                />
              )}
              {activeTab === "master-flow" && (
                <ConfigEditor
                  title="Master flow"
                  description="URL based request sources, pipeline assignment, headers, and refresh behavior."
                  value={stringify(parsed["master-flow"] ?? {}).trimEnd()}
                  onChange={(text) => changeSection("master-flow", text)}
                  placeholder={'requests:\n  - url: "https://..."\n    header: {}\n    pipeline: song-with-cover\n    refresh_after_done: true'}
                />
              )}
              {activeTab === "spec-yaml" && (
                <ConfigEditor
                  title="Complete spec.yaml"
                  description="Edit every spec field directly. Fields not shown in other views stay here unchanged."
                  value={yamlDraft}
                  onChange={changeWholeSpec}
                  placeholder={starterYaml}
                />
              )}
              {activeTab === "workloads" && (
                <WorkloadsEditor
                  names={workloadNames}
                  currentName={currentWorkloadName}
                  config={workloadConfig}
                  draft={workloadDraft}
                  onSelect={setSelectedWorkload}
                  onAdd={addWorkload}
                  onRemove={removeWorkload}
                  onChangeDraft={changeWorkloadText}
                  onChangeField={(field, value) => editDocument((document) => {
                    document.workloads[currentWorkloadName] = { ...asObject(document.workloads[currentWorkloadName]), [field]: value };
                  })}
                />
              )}
              {activeTab === "requests" && (
                <RequestsView
                  pipelineNames={pipelineNames}
                  currentPipelineName={currentPipelineName}
                  requests={pipelineRequests}
                  units={remoteUnits ?? []}
                  activeRequest={activeRequest}
                  activeRequestPipelineNodes={activeRequestPipelineNodes}
                  selectedRequest={selectedRequest}
                  onSelectPipeline={setActivePipeline}
                  onSelectRequest={(id) => setSelectedRequest(selectedRequest === id ? null : id)}
                  onNewRequest={openRequestModal}
                />
              )}
            </div>
            {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
          </>
        ) : (
          <div className="welcome-view">
            <div className="welcome-mark">m</div>
            <h1>What are you building?</h1>
            <p>Create a spec to manage pipeline configuration and requests.</p>
            <button className="request-button" onClick={openSpecModal}>＋ Create your first spec</button>
            {error && <div className="inline-error">{error}</div>}
          </div>
        )}
      </main>
      <SpecDialogs
        modal={modal}
        renameOpen={renameOpen}
        error={error}
        specNameDraft={specNameDraft}
        specUploadName={specUploadName}
        renameDraft={renameDraft}
        currentPipelineName={currentPipelineName}
        pipelineParams={pipelineConfig.params}
        creatingSpec={creatingSpec}
        onCloseModal={() => setModal(null)}
        onCloseRename={() => setRenameOpen(false)}
        onSubmitCreate={addSpec}
        onSubmitRename={submitRename}
        onSubmitRequest={addRequest}
        onSpecNameChange={setSpecNameDraft}
        onSpecFileChange={(event) => {
          const file = event.target.files?.[0];
          setSpecUploadName(file?.name ?? "");
          if (file && !specNameDraft) setSpecNameDraft(file.name.replace(/\.ya?ml$/i, "").replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()));
        }}
        onRenameChange={setRenameDraft}
      />
      {toast && <div className="toast">✓ {toast}</div>}
      {incomingNotification && (
        <div className="notification-toast" role="status" aria-live="polite">
          <button className="notification-toast-content" onClick={openNotifications}>
            <b>{incomingNotification.title}</b>
            <span>{incomingNotification.message}</span>
          </button>
          <button className="notification-toast-close" aria-label="Dismiss notification" onClick={() => setIncomingNotification(null)}>×</button>
        </div>
      )}
    </div>
  );
}

export default App;

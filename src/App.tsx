import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { parse } from "yaml";
import { SpecOverview } from "./components/SpecOverview";
import "./spec-overview.css";
const ConfigEditor = lazy(() => import("./components/ConfigEditor").then(module => ({ default: module.ConfigEditor })));
import "./yaml-editor.css";
import { RequestsView } from "./components/RequestsView";
import { NotificationsView } from "./components/NotificationsView";
import { SettingsView } from "./components/SettingsView";
import { SpecHeader, SectionTabs } from "./components/SpecHeader";
import { SpecSidebar } from "./components/SpecSidebar";
import { SpecDialogs } from "./components/SpecDialogs";
import { asObject, starterYaml } from "./specUtils";
import { isMapping, specIssues } from "./specModel";
import { RequestEditor, type RequestEditorSession } from "./components/RequestEditor";
import { requestTitle } from "./requestModel";
import "./request-editor.css";
import { sendSystemNotification } from "./systemNotifications";
import { useAuthActions } from "@convex-dev/auth/react";
import type { ConvexServerProfile } from "./connectionSettings";
import type { ConnectionSettings } from "./connectionSettings";
import type { ConfigTab, PipelineNode, RequestItem, SpecItem } from "./types";
import "./App.css";
import "./graph.css";
import "./space-actions.css";
import "./request-details.css";
import "./unit-tokens.css";
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
  const [activeTab, setActiveTab] = useState<ConfigTab>("requests");
  const [yamlDraft, setYamlDraft] = useState("");
  const [modal, setModal] = useState<"spec" | null>(null);
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
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [requestEditor, setRequestEditor] = useState<RequestEditorSession | null>(null);
  const lastParsed = useRef<Record<string, any>>({});
  const editRevision = useRef(0);
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
  const createSpec = useMutation(api.specs.create);
  const updateSpec = useMutation(api.specs.update);
  const renameSpec = useMutation(api.specs.rename);
  const removeSpec = useMutation(api.specs.remove);
  const createRequest = useMutation(api.requests.create);
  const editRequest = useMutation(api.requests.editPayload);
  const removeRequest = useMutation(api.requests.remove);
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
    return {
      id,
      convexId: request._id,
      title: requestTitle(payload, id),
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
      artifacts: request.artifacts,
      nodeStates: asObject(request.nodeStates) as RequestItem["nodeStates"],
    };
  });
  const parsed = useMemo(() => {
    try {
      const value = parse(yamlDraft || activeSpec?.yaml || starterYaml);
      if (isMapping(value)) lastParsed.current = value;
      return lastParsed.current;
    } catch {
      return lastParsed.current;
    }
  }, [yamlDraft, activeSpec?.yaml]);
  const savedDocument = useMemo(() => {
    try { return asObject(parse(activeSpec?.yaml ?? "{}")); } catch { return {}; }
  }, [activeSpec?.yaml]);
  const savedPipelines = asObject(savedDocument.pipeline);
  const savedPipelineNames = Object.keys(savedPipelines).filter(name => isMapping(savedPipelines[name]));
  const requestPipelineName = savedPipelineNames.includes(activePipeline) ? activePipeline : savedPipelineNames[0] ?? "";
  const visibleRequests = requests.filter(request => request.pipelineName === requestPipelineName);
  const savedRequestPipeline = asObject(savedPipelines[requestPipelineName]);
  const activeRequestPipelineNodes: PipelineNode[] = Array.isArray(savedRequestPipeline.nodes)
    ? savedRequestPipeline.nodes.filter((node: unknown): node is PipelineNode => isMapping(node) && typeof node.name === "string") : [];
  const dirty = hasEdits;
  const issues = specIssues(parsed);
  const draftError = Object.values(editorErrors)[0] ?? "";
  const editorBlocked = Boolean(draftError || issues.length);

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
    try { lastParsed.current = asObject(parse(activeSpec.yaml)); } catch { lastParsed.current = {}; }
    setYamlDraft(activeSpec.yaml);
    setActivePipeline("");
    setSelectedRequest(null);
    setRequestEditor(null);
    setError("");
    setHasEdits(false);
    setEditorErrors({});
  }, [activeSpec?._id]);

  function notice(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function changeWholeSpec(text: string) {
    editRevision.current++;
    setYamlDraft(text);
    setHasEdits(true);
    try {
      const value = parse(text);
      if (!isMapping(value)) throw new Error("The spec root must be a YAML mapping.");
      setEditorErrors({});
      setError("");
    } catch (e) {
      setEditorErrors(errors => ({ ...errors, spec: e instanceof Error ? `YAML: ${e.message}` : "Invalid YAML" }));
    }
  }

  async function saveSpec() {
    if (!activeSpec) return;
    try {
      if (draftError) throw new Error(draftError);
      const parsedDocument = parse(yamlDraft);
      const validation = specIssues(parsedDocument);
      if (validation.length) throw new Error(validation[0]);
      if (!parsedDocument || typeof parsedDocument !== "object" || Array.isArray(parsedDocument)) throw new Error("The spec root must be a YAML mapping.");
      setSaving(true);
      const savedYaml = yamlDraft;
      const savedRevision = editRevision.current;
      await updateSpec({ id: activeSpec._id as never, name: activeSpec.name, description: activeSpec.description, yaml: savedYaml });
      if (savedRevision === editRevision.current) setHasEdits(false);
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
      const validation = specIssues(document);
      if (validation.length) throw new Error(validation[0]);
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

  async function saveRequest(pipelineName: string, payload: Record<string, unknown>) {
    if (!activeSpec || !requestEditor) throw new Error("Select a spec and try again.");
    let id: string;
    if (requestEditor.mode === "edit") {
      id = await editRequest({ id: requestEditor.requestId as never, payload, expectedPayload: requestEditor.initialPayload });
    } else {
      id = await createRequest({ specSlug: activeSpec.slug, pipelineName, payload });
    }
    setRequestEditor(null);
    setActivePipeline(pipelineName);
    setActiveTab("requests");
    setSelectedRequest(id);
    notice(requestEditor.mode === "edit" ? "Request updated" : "Request added to waiting queue");
  }

  function openEditRequest(request: RequestItem) {
    if (request.status !== "waiting") { setError("Only waiting requests can be edited. Duplicate this request for a new run."); return; }
    setRequestEditor({ mode: "edit", pipelineName: request.pipelineName, requestId: request.convexId, initialPayload: request.payload });
  }

  async function deleteRequest(request: RequestItem) {
    if (!window.confirm(`Delete “${request.title}”? It will be hidden and cannot be claimed again. This does not stop a worker already running it.`)) return;
    try {
      await removeRequest({ id: request.convexId as never });
      setSelectedRequest(current => current === request.convexId ? null : current);
      setRequestEditor(current => current?.requestId === request.convexId ? null : current);
      notice("Request deleted");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not delete request.");
    }
  }

  function duplicateRequest(request: RequestItem) {
    if (!savedPipelineNames.includes(request.pipelineName)) { setError("This pipeline no longer exists in the saved spec."); return; }
    setRequestEditor({ mode: "create", pipelineName: request.pipelineName, initialPayload: request.payload, duplicate: true });
  }

  function openSpec(spec: SpecItem) {
    setActiveSpecSlug(spec.slug);
    setNotificationsActive(false);
    setSettingsActive(false);
    setActiveTab("requests");
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
    if (!requestPipelineName) { setError("Save a pipeline in this spec before creating requests."); return; }
    setError("");
    setRequestEditor({ mode: "create", pipelineName: requestPipelineName, initialPayload: {} });
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
          <div className="editor-scroll notifications-scroll">
            <NotificationsView />
            {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
          </div>
        ) : activeSpec ? (
          <>
            <SpecHeader
              spec={activeSpec}
              dirty={dirty}
              saving={saving}
              error={editorBlocked ? draftError || issues[0] : ""}
              hasPipeline={Boolean(requestPipelineName)}
              onSave={() => void saveSpec()}
              onNewRequest={openRequestModal}
            />
            <SectionTabs
              activeTab={activeTab}
              requestCount={requests.length}
              onChange={(tab) => { setActiveTab(tab); setSelectedRequest(null); }}
            />
            <div className={activeTab === "spec-yaml" ? "editor-scroll yaml-editor-area" : activeTab === "requests" ? "editor-scroll requests-editor-area" : "editor-scroll overview-editor-area"}>
              {activeTab !== "spec-yaml" && (draftError || issues.length > 0) && <div className="spec-issues" role="alert">
                <b>Spec needs attention</b>
                <ul>{[...Object.values(editorErrors), ...issues].slice(0, 8).map((issue, index) => <li key={index}>{issue}</li>)}</ul>
                {(issues.length + Object.keys(editorErrors).length > 8) && <p>More issues remain in this spec.</p>}
                <button className="subtle-button" onClick={() => setActiveTab("spec-yaml")}>Open Spec YAML</button>
              </div>}

              {activeTab === "overview" && <SpecOverview document={parsed} stale={Boolean(draftError)} onOpenYaml={() => setActiveTab("spec-yaml")} />}
              {activeTab === "spec-yaml" && (
                <Suspense fallback={<div className="yaml-workspace" role="status">Loading YAML editor…</div>}>
                <ConfigEditor
                  key={activeSpec._id}
                  dark={darkMode}
                  onSave={() => { if (dirty && !saving && !editorBlocked) void saveSpec(); }}
                  title="Complete spec.yaml"
                  description="Edit every spec field directly. Overview reflects this draft. Save changes to apply it to new requests."
                  value={yamlDraft}
                  onChange={changeWholeSpec}
                  placeholder={starterYaml}
                />
                </Suspense>
              )}
              {activeTab === "requests" && (
                <RequestsView
                  key={activeSpec._id}
                  pipelineNames={savedPipelineNames}
                  pipelineCounts={Object.fromEntries(savedPipelineNames.map(name => [name, requests.filter(request => request.pipelineName === name).length]))}
                  currentPipelineName={requestPipelineName}
                  requests={visibleRequests}
                  pipelineNodes={activeRequestPipelineNodes}
                  selectedRequest={selectedRequest}
                  onSelectPipeline={setActivePipeline}
                  onEditRequest={openEditRequest}
                  onDuplicateRequest={duplicateRequest}
                  onDeleteRequest={deleteRequest}
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
      {requestEditor && <RequestEditor key={`${activeSpec?._id}:${requestEditor.mode}:${requestEditor.requestId ?? requestEditor.pipelineName}:${requestEditor.duplicate ?? false}`} session={requestEditor} pipelines={savedPipelines} specName={activeSpec?.name ?? ""} hasUnsavedSpec={dirty} onClose={() => setRequestEditor(null)} onSave={saveRequest} />}
      <SpecDialogs
        modal={modal}
        renameOpen={renameOpen}
        error={error}
        specNameDraft={specNameDraft}
        specUploadName={specUploadName}
        renameDraft={renameDraft}
        creatingSpec={creatingSpec}
        onCloseModal={() => setModal(null)}
        onCloseRename={() => setRenameOpen(false)}
        onSubmitCreate={addSpec}
        onSubmitRename={submitRename}
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

import { useEffect, useRef, useState } from "react";
import { asObject } from "../specUtils";
import { draftPayload, inputDrafts, payloadIssues, type InputDraft } from "../requestModel";
import { isMapping } from "../specModel";

export type RequestEditorSession = { mode: "create" | "edit"; pipelineName: string; initialPayload: unknown; requestId?: string; duplicate?: boolean };
type Props = {
  session: RequestEditorSession;
  pipelines: Record<string, any>;
  specName: string;
  hasUnsavedSpec: boolean;
  onClose: () => void;
  onSave: (pipeline: string, payload: Record<string, unknown>) => Promise<void>;
};

const labelFor = (name: string) => name === "cover_with" ? "Cover width" : name.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

export function RequestEditor({ session, pipelines, specName, hasUnsavedSpec, onClose, onSave }: Props) {
  const [pipeline, setPipeline] = useState(session.pipelineName);
  const schema = asObject(asObject(pipelines[pipeline]).params);
  const [drafts, setDrafts] = useState<Record<string, InputDraft>>(() => inputDrafts(schema, session.initialPayload));
  const [mode, setMode] = useState<"form" | "json">(() => Object.keys(payloadIssues(session.initialPayload, schema)).some(key => key === "_payload" || !(key in schema)) ? "json" : "form");
  const [jsonText, setJsonText] = useState(JSON.stringify(session.initialPayload, null, 2));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const pipelineDrafts = useRef<Record<string, { drafts: Record<string, InputDraft>; jsonText: string; mode: "form" | "json" }>>({});
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = formRef.current;
    root?.querySelector<HTMLElement>("input:not(:disabled),textarea,select,button")?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab" && root) {
        const fields = [...root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex='0']")].filter(el => el.getClientRects().length > 0);
        const first = fields[0], last = fields[fields.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  function currentPayload() {
    return mode === "json" ? JSON.parse(jsonText) : draftPayload(schema, drafts);
  }
  function switchMode(next: "form" | "json") {
    if (next === mode) return;
    try {
      const payload = currentPayload();
      if (!isMapping(payload)) throw new Error("Inputs must be a JSON object.");
      if (next === "form" && Object.keys(payload).some(name => !(name in schema))) throw new Error("Remove undeclared inputs in JSON before switching to fields.");
      if (next === "json") {
        // Keep partially entered numeric fields editable when opening JSON.
        const partial = Object.fromEntries(Object.entries(payload).map(([name, value]) => [name, typeof value === "number" && !Number.isFinite(value) ? drafts[name]?.value ?? "" : value]));
        setJsonText(JSON.stringify(partial, null, 2));
      } else {
        const wrongTypes = Object.entries(payloadIssues(payload, schema)).filter(([name]) => Object.prototype.hasOwnProperty.call(payload, name));
        if (wrongTypes.length) { setErrors(Object.fromEntries(wrongTypes)); return; }
        setDrafts(inputDrafts(schema, payload));
      }
      setErrors({}); setServerError(""); setMode(next);
    } catch (e) { setServerError(e instanceof Error ? e.message : "Invalid JSON."); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    setServerError("");
    try {
      const payload = currentPayload();
      const issues = payloadIssues(payload, schema);
      setErrors(issues);
      if (Object.keys(issues).length) { formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(); return; }
      busyRef.current = true; setBusy(true);
      await onSave(pipeline, payload);
    } catch (e) { setServerError(e instanceof Error ? e.message : "Could not save request. Your inputs are still here."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function changePipeline(value: string) {
    pipelineDrafts.current[pipeline] = { drafts, jsonText, mode };
    const saved = pipelineDrafts.current[value];
    setPipeline(value);
    setDrafts(saved?.drafts ?? inputDrafts(asObject(asObject(pipelines[value]).params), {}));
    setJsonText(saved?.jsonText ?? "{}"); setMode(saved?.mode ?? "form");
    setErrors({}); setServerError("");
  }
  const optional = Object.entries(schema).filter(([, value]) => "default" in asObject(value));
  const fields = Object.entries(schema).filter(([, value]) => !("default" in asObject(value)));
  function field(name: string, raw: any) {
    const definition = asObject(raw), draft = drafts[name] ?? { enabled: true, value: "" };
    const numeric = definition.type === "number", hasDefault = "default" in definition;
    const long = !numeric && (/lyrics|prompt|style|description|text/i.test(name) || draft.value.includes("\n") || draft.value.length > 120);
    const id = `request-input-${name}`;
    const update = (value: string) => setDrafts(old => ({ ...old, [name]: { ...draft, value } }));
    return <div className={`composer-field ${/lyrics/i.test(name) ? "lyrics-field" : ""}`} key={name}>
      <div className="composer-field-title"><label htmlFor={id}>{labelFor(name)}</label><span>{numeric ? "Number" : "Text"}{!hasDefault ? " · Required" : " · Optional"}</span></div>
      {definition.description && <p>{String(definition.description)}</p>}
      {hasDefault && <label className="composer-default"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={e => setDrafts(old => ({ ...old, [name]: { ...draft, enabled: e.target.checked } }))} />Use custom value <small>Default: {String(definition.default)}</small></label>}
      {long ? <textarea id={id} rows={/lyrics/i.test(name) ? 15 : /prompt/i.test(name) ? 5 : 3} value={draft.value} disabled={busy || !draft.enabled} aria-invalid={Boolean(errors[name])} placeholder={/lyrics/i.test(name) ? "[Verse 1]\nWrite or paste the full lyrics here…\n\n[Chorus]\n…" : `Enter ${labelFor(name).toLowerCase()}`} onChange={e => update(e.target.value)} /> :
        <input id={id} type={numeric ? "number" : "text"} step={numeric ? "any" : undefined} value={draft.value} disabled={busy || !draft.enabled} aria-invalid={Boolean(errors[name])} onChange={e => update(e.target.value)} placeholder={hasDefault ? String(definition.default) : `Enter ${name}`} />}
      {errors[name] && <p className="composer-field-error" role="alert">{errors[name]}</p>}
      {long && <small className="composer-counter">{draft.value.length.toLocaleString()} characters{draft.value ? ` · ${draft.value.split("\n").length} lines` : ""}</small>}
    </div>;
  }
  return <div className="request-editor-backdrop">
    <form className="request-composer" role="dialog" aria-modal="true" aria-labelledby="request-editor-title" onSubmit={submit} ref={formRef} noValidate>
      <header className="composer-header"><div><span className="view-kicker">{specName} · {session.mode === "edit" ? "EDIT INPUTS" : session.duplicate ? "DUPLICATE REQUEST" : "NEW RUN"}</span><h2 id="request-editor-title">{session.mode === "edit" ? "Edit request" : "Create request"}</h2><p>{session.mode === "edit" ? "Update inputs before a worker picks up this request." : "Fill in the inputs below. The request will join the waiting queue."}</p></div><button type="button" className="composer-close" aria-label="Close request editor" disabled={busy} onClick={onClose}>×</button></header>
      <div className="composer-toolbar"><label>Pipeline<select value={pipeline} disabled={busy || session.mode === "edit"} onChange={e => changePipeline(e.target.value)}>{Object.keys(pipelines).map(name => <option key={name}>{name}</option>)}</select></label><div className="composer-modes" role="group" aria-label="Input format"><button type="button" aria-pressed={mode === "form"} disabled={busy} onClick={() => switchMode("form")}>Fields</button><button type="button" aria-pressed={mode === "json"} disabled={busy} onClick={() => switchMode("json")}>JSON</button></div></div>
      {hasUnsavedSpec && <p className="composer-notice">This form uses the saved spec. Unsaved spec changes do not affect this request.</p>}
      <div className={`composer-body ${mode === "json" ? "json-mode" : ""}`}>
        {mode === "json" ? <div className="composer-json"><label htmlFor="request-json">Request inputs as JSON</label><p>Use exact parameter names. Numbers remain numbers; omit optional inputs to use their defaults.</p><textarea id="request-json" spellCheck={false} value={jsonText} disabled={busy} onChange={e => setJsonText(e.target.value)} />{Object.entries(errors).map(([key, message]) => <p key={key} className="composer-field-error">{key}: {message}</p>)}</div> : <><div className="composer-main">{fields.map(([name, definition]) => field(name, definition))}{!fields.length && <p className="composer-empty">No required inputs for this pipeline.</p>}</div><aside className="composer-options"><h3>Options & defaults</h3><p>Keep defaults, or turn on a custom value for this run.</p>{optional.map(([name, definition]) => field(name, definition))}{!optional.length && <p>No optional inputs.</p>}<div className="composer-help"><b>What happens next?</b><p>{session.mode === "edit" ? "The request stays in the waiting queue. Execution state is not reset." : "A worker claims the request and runs this pipeline. You can edit it while it is waiting."}</p></div></aside></>}
      </div>
      {serverError && <div className="composer-error" role="alert">{serverError}</div>}
      <footer className="composer-footer"><span>{Object.keys(schema).length} declared inputs · {session.mode === "edit" ? "Waiting request" : "New request starts as waiting"}</span><div><button type="button" className="subtle-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="request-button" disabled={busy}>{busy ? "Saving…" : session.mode === "edit" ? "Save changes" : "Create request"}</button></div></footer>
    </form>
  </div>;
}

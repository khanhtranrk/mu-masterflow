import { useState, type FormEvent, type ChangeEvent } from "react";
import { asObject } from "../specUtils";

type SpecDialogsProps = {
  modal: "spec" | "request" | null;
  renameOpen: boolean;
  error: string;
  specNameDraft: string;
  specUploadName: string;
  renameDraft: string;
  currentPipelineName: string;
  pipelineParams: Record<string, any>;
  creatingSpec: boolean;
  creatingRequest: boolean;
  onCloseModal: () => void;
  onCloseRename: () => void;
  onSubmitCreate: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
  onSpecNameChange: (value: string) => void;
  onSpecFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRenameChange: (value: string) => void;
  onSubmitRequest: (event: FormEvent<HTMLFormElement>) => void;
};

function RequestParameter({ name, definition }: { name: string; definition: Record<string, any> }) {
  const hasDefault = Object.prototype.hasOwnProperty.call(definition, "default");
  const [override, setOverride] = useState(!hasDefault);
  const numeric = definition.type === "number";
  const multiline = !numeric && /prompt|lyrics/i.test(name);
  return <div className="request-param">
    <label>{name}<small>{numeric ? "number" : "string"} · {hasDefault ? "optional" : "required"}</small>
      {multiline ? <textarea name={`param:${name}`} rows={3} disabled={!override} placeholder={`Enter ${name}`} /> :
        <input name={`param:${name}`} type={numeric ? "number" : "text"} step={numeric ? "any" : undefined}
          required={numeric && override} disabled={!override} placeholder={`Enter ${name}`} />}
    </label>
    {definition.description && <p className="param-description">{String(definition.description)}</p>}
    {hasDefault && <label className="default-toggle"><input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)} />Override default: <code>{String(definition.default)}</code></label>}
  </div>;
}

function CreateDialog({ props }: { props: SpecDialogsProps }) {
  const { modal, error, specNameDraft, specUploadName, currentPipelineName, pipelineParams, creatingSpec } = props;
  if (!modal) return null;

  return (
    <div className="modal-backdrop" onClick={props.onCloseModal}>
      <form className="simple-modal" onClick={(event) => event.stopPropagation()} onSubmit={modal === "spec" ? props.onSubmitCreate : props.onSubmitRequest}>
        <div className="modal-top">
          <div className="modal-icon">{modal === "spec" ? "◫" : "▤"}</div>
          <button type="button" className="icon-action" onClick={props.onCloseModal}>×</button>
        </div>
        <h2>{modal === "spec" ? "Create a spec" : "New request"}</h2>
        <p>{modal === "spec" ? "Create a spec from scratch or upload an existing spec.yaml." : `Add a request to ${currentPipelineName}.`}</p>
        {modal === "spec" ? (
          <>
            <label>Spec name<input name="name" autoFocus required value={specNameDraft} onChange={(event) => props.onSpecNameChange(event.target.value)} placeholder="e.g. Song with cover" /></label>
            <label>Description<input name="description" placeholder="What does this spec do?" /></label>
            <label className="spec-upload">
              Existing spec.yaml
              <span className="spec-upload-control">
                <span className="upload-glyph">↑</span>
                <span><b>{specUploadName || "Choose a YAML file"}</b><small>{specUploadName ? "This file will be saved as the spec." : "Upload .yaml or .yml from your computer"}</small></span>
                <input name="specFile" type="file" accept=".yaml,.yml,application/yaml,text/yaml,text/plain" onChange={props.onSpecFileChange} />
              </span>
            </label>
            <div className="form-hint">The uploaded YAML is validated and kept as the full spec. Pipeline params and nodes are available in the editor.</div>
          </>
        ) : (
          <>
              <p className="form-hint">The submitted values become this request’s payload. Its request ID is used as the label.</p>
            {Object.entries(asObject(pipelineParams)).map(([name, raw]) => <RequestParameter key={`${currentPipelineName}:${name}`} name={name} definition={asObject(raw)} />)}
            {Object.keys(asObject(pipelineParams)).length === 0 && <div className="form-hint">This pipeline has no declared parameters. The request payload will be an empty mapping.</div>}
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="subtle-button" onClick={props.onCloseModal}>Cancel</button>
          <button className="request-button" type="submit" disabled={modal === "spec" ? creatingSpec : props.creatingRequest}>{modal === "spec" ? creatingSpec ? "Creating…" : "Create spec" : props.creatingRequest ? "Creating…" : "Create request"}</button>
        </div>
      </form>
    </div>
  );
}

function RenameDialog({ props }: { props: SpecDialogsProps }) {
  if (!props.renameOpen) return null;
  return (
    <div className="modal-backdrop" onClick={props.onCloseRename}>
      <form className="simple-modal" onClick={(event) => event.stopPropagation()} onSubmit={props.onSubmitRename}>
        <div className="modal-top">
          <div className="modal-icon">✎</div>
          <button type="button" className="icon-action" onClick={props.onCloseRename}>×</button>
        </div>
        <h2>Rename spec</h2>
        <p>Choose a new name for this spec.</p>
        <label>Spec name<input autoFocus required value={props.renameDraft} onChange={(event) => props.onRenameChange(event.target.value)} /></label>
        {props.error && <div className="form-error">{props.error}</div>}
        <div className="modal-actions">
          <button type="button" className="subtle-button" onClick={props.onCloseRename}>Cancel</button>
          <button className="request-button" type="submit" disabled={!props.renameDraft.trim()}>Rename spec</button>
        </div>
      </form>
    </div>
  );
}

export function SpecDialogs(props: SpecDialogsProps) {
  return (
    <>
      <CreateDialog props={props} />
      <RenameDialog props={props} />
    </>
  );
}

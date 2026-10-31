import { Input } from "./ui/Input";
import type { FormEvent, ChangeEvent } from "react";

type SpecDialogsProps = {
  modal: "spec" | null;
  renameOpen: boolean;
  error: string;
  specNameDraft: string;
  specUploadName: string;
  renameDraft: string;
  creatingSpec: boolean;
  onCloseModal: () => void;
  onCloseRename: () => void;
  onSubmitCreate: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitRename: (event: FormEvent<HTMLFormElement>) => void;
  onSpecNameChange: (value: string) => void;
  onSpecFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRenameChange: (value: string) => void;
};

function CreateDialog({ props }: { props: SpecDialogsProps }) {
  const { modal, error, specNameDraft, specUploadName, creatingSpec } = props;
  if (modal !== "spec") return null;

  return (
    <div className="modal-backdrop" onClick={props.onCloseModal}>
      <form className="simple-modal" onClick={(event) => event.stopPropagation()} onSubmit={props.onSubmitCreate}>
        <div className="modal-top">
          <div className="modal-icon">◫</div>
          <button type="button" className="icon-action" onClick={props.onCloseModal}>×</button>
        </div>
        <h2>Create a spec</h2>
        <p>Create a spec from scratch or upload an existing spec.yaml.</p>
        <>
            <label>Spec name<Input name="name" autoFocus required value={specNameDraft} onChange={(event) => props.onSpecNameChange(event.target.value)} placeholder="e.g. Song with cover" /></label>
            <label>Description<Input name="description" placeholder="What does this spec do?" /></label>
            <label className="spec-upload">
              Existing spec.yaml
              <span className="spec-upload-control">
                <span className="upload-glyph">↑</span>
                <span><b>{specUploadName || "Choose a YAML file"}</b><small>{specUploadName ? "This file will be saved as the spec." : "Upload .yaml or .yml from your computer"}</small></span>
                <Input name="specFile" type="file" accept=".yaml,.yml,application/yaml,text/yaml,text/plain" onChange={props.onSpecFileChange} />
              </span>
            </label>
            <div className="form-hint">The uploaded YAML is validated and kept as the full spec. Pipeline params and nodes are available in the editor.</div>
        </>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="subtle-button" onClick={props.onCloseModal}>Cancel</button>
          <button className="request-button" type="submit" disabled={creatingSpec}>{creatingSpec ? "Creating…" : "Create spec"}</button>
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
        <label>Spec name<Input autoFocus required value={props.renameDraft} onChange={(event) => props.onRenameChange(event.target.value)} /></label>
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

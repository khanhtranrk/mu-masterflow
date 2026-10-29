type ConfigEditorProps = {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export function ConfigEditor({ title, description, value, onChange, placeholder }: ConfigEditorProps) {
  return (
    <section className={`editor-view ${title === "Complete spec.yaml" ? "full-spec-view" : ""}`}>
      <div className="view-heading">
        <div>
          <span className="view-kicker">SPACE CONFIGURATION</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="config-code-panel">
        <div className="editor-toolbar"><span className="file-dot" /><b>{title.toLowerCase().replace(/ /g, "-")}.yaml</b><small>YAML</small></div>
        <textarea className="code-editor config-code" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      </div>
    </section>
  );
}

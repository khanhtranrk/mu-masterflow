type Props = {
  title: string;
  description: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
};

export function YamlSection({ title, description, value, error, onChange }: Props) {
  return <section className="yaml-section">
    <label className="field-heading"><b>{title}</b><small>{description}</small>
      <textarea aria-label={title} className="code-editor section-code" spellCheck={false} value={value}
        aria-invalid={Boolean(error)} onChange={event => onChange(event.target.value)} />
    </label>
    {error && <p className="section-error" role="alert">{error}</p>}
  </section>;
}

import { stringify } from "yaml";
import { asObject } from "../specUtils";
import { YamlSection } from "./YamlSection";

type Props = {
  entries: Record<string, any>;
  drafts: Record<string, string>;
  errors: Record<string, string>;
  onChange: (entry: "direct_flow" | "master_flow", phase: "initialization" | "finalization", text: string) => void;
};

export function EntriesEditor({ entries, drafts, errors, onChange }: Props) {
  return <section className="editor-view entries-view">
    <div className="view-heading"><div><span className="view-kicker">FLOW LIFECYCLE</span><h2>Entries</h2>
      <p>One initialization and finalization per command. Prepare individual pipelines in the Pipeline view.</p></div></div>
    {(["direct_flow", "master_flow"] as const).map(entry => <section className="entry-card" key={entry}>
      <div className="entry-heading"><h3>{entry}</h3><code>{entry === "direct_flow" ? "mu run" : "mu master-flow run <spec-slug>"}</code></div>
      {(["initialization", "finalization"] as const).map(phase => {
        const key = `entries.${entry}.${phase}`;
        return <YamlSection key={phase} title={`${entry} ${phase}`}
          description={phase === "initialization" ? "Runs once before executing requests; master flow runs this before claiming its first batch. Use type, target/args or url, and optional save_state on command/HTTP actions." : "Runs once when the flow ends, including failure or Ctrl+C. Request params are not available."}
          value={drafts[key] ?? stringify(asObject(entries[entry])[phase] ?? []).trimEnd()}
          error={errors[key]} onChange={text => onChange(entry, phase, text)} />;
      })}
    </section>)}
  </section>;
}

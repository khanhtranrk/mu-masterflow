import { useEffect, useId, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, placeholder as editorPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { yamlProblems, type YamlProblem } from "../yamlDiagnostics";
import "../yaml-editor.css";

type ConfigEditorProps = {
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  dark?: boolean;
  onSave?: () => void;
};

export function ConfigEditor({ title, description, value, onChange, placeholder, dark = false, onSave }: ConfigEditorProps) {
  const panelId = useId();
  const issueButton = useRef<HTMLButtonElement>(null);
  const [problems, setProblems] = useState<YamlProblem[]>([]);
  const [checking, setChecking] = useState(true);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const theme = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const [wrap, setWrap] = useState(false);
  const [position, setPosition] = useState({ line: 1, column: 1 });

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: value, extensions: [
        lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), rectangularSelection(),
        history(), foldGutter(), indentOnInput(), bracketMatching(), highlightSelectionMatches(),
        indentUnit.of("  "), EditorState.tabSize.of(2), yaml(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        editorPlaceholder(placeholder), EditorView.contentAttributes.of({ "aria-label": title, spellcheck: "false" }),
        theme.current.of(dark ? oneDark : []), wrapping.current.of([]),
        keymap.of([{ key: "Mod-s", run: () => { callbacks.current.onSave?.(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        lintGutter(), linter(editor => {
          const next = yamlProblems(editor.state.doc.toString());
          setProblems(next);
          setChecking(false);
          return next.flatMap(problem => problem.from === undefined ? [] : [{
            from: problem.from, to: problem.to ?? problem.from,
            severity: problem.severity, message: problem.message,
          }]);
        }, { delay: 600 }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            setChecking(true);
            callbacks.current.onChange(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            const cursor = update.state.selection.main.head;
            const line = update.state.doc.lineAt(cursor);
            setPosition({ line: line.number, column: cursor - line.from + 1 });
          }
        }),
      ] }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
    // The editor lives for one spec; prop updates are applied without resetting history.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => { view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) }); }, [dark]);
  useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);

  function closeProblems() {
    setProblemsOpen(false);
    issueButton.current?.focus();
  }

  function jumpToProblem(problem: YamlProblem) {
    const editor = view.current;
    if (!editor || checking || problem.from === undefined) return;
    editor.dispatch({ selection: { anchor: problem.from, head: problem.to ?? problem.from }, scrollIntoView: true });
    editor.focus();
  }

  return <section className="yaml-workspace" aria-label={title}>
    <div className="yaml-filebar"><b>spec.yaml</b><span>{description}</span>
      <div className="yaml-file-actions">
        <button className="subtle-button" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>Wrap lines {wrap ? "on" : "off"}</button>
        <button ref={issueButton} className={`subtle-button yaml-problems-toggle ${problems.length ? "has-problems" : ""}`} aria-expanded={problemsOpen} aria-controls={panelId} onClick={() => setProblemsOpen(open => !open)}>
          {problems.length ? `⚠ Problems (${problems.length})` : "✓ Problems (0)"}
        </button>
      </div>
    </div>
    <div className="yaml-editor-body">
      <div className="yaml-editor-host" ref={host} />
      {problemsOpen && <aside className="yaml-problems-panel" id={panelId} aria-label="YAML problems" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeProblems(); } }}>
        <div className="yaml-problems-heading"><h3>Problems ({problems.length})</h3><button className="subtle-button" aria-label="Close problems" onClick={closeProblems}>×</button></div>
        <p className="yaml-problems-status" role="status">{checking ? "Checking after typing…" : problems.length ? "Select a syntax issue to reveal it in the editor." : "No problems found."}</p>
        <ul aria-busy={checking}>{problems.map((problem, index) => {
          const line = problem.from === undefined ? undefined : view.current?.state.doc.lineAt(Math.min(problem.from, view.current.state.doc.length));
          const location = checking ? "Rechecking location…" : line && problem.from !== undefined ? `Line ${line.number}, column ${problem.from - line.from + 1}` : "See field path below";
          const content = <><span className={`yaml-problem-kind ${problem.severity}`}>{problem.kind === "syntax" ? "YAML syntax" : "Spec configuration"} · {problem.severity}</span><small>{location}</small><span className="yaml-problem-message">{problem.message}</span></>;
          return <li key={index}>{problem.from !== undefined ? <button disabled={checking} className="yaml-problem-item" onClick={() => jumpToProblem(problem)}>{content}</button> : <div className="yaml-problem-item">{content}</div>}</li>;
        })}</ul>
      </aside>}
    </div>
    <footer className="yaml-statusbar"><span>Ln {position.line}, Col {position.column}</span><span>Spaces: 2</span><span>YAML</span><span>Ctrl/⌘ F · Find &nbsp; Ctrl/⌘ S · Save &nbsp; Esc, Tab · Leave editor</span></footer>
  </section>;
}

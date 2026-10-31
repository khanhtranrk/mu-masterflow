import { Input, Textarea } from "./ui/Input";
import type { PipelineNode } from "../types";
import { nodeDependencyNames } from "../specUtils";
import { DependencyGraph } from "./DependencyGraph";

type PipelineEditorProps = {
  pipelineNames: string[];
  currentPipelineName: string;
  nodes: PipelineNode[];
  currentNode?: PipelineNode;
  nodeDraft: string;
  onSelectPipeline: (name: string) => void;
  onAddPipeline: () => void;
  onRemovePipeline: () => void;
  onAddNode: () => void;
  onSelectNode: (name: string) => void;
  onRemoveNode: (name: string) => void;
  onToggleDependency: (name: string, enabled: boolean) => void;
  onChangeNodeDraft: (value: string) => void;
};

export function PipelineEditor({
  pipelineNames,
  currentPipelineName,
  nodes,
  currentNode,
  nodeDraft,
  onSelectPipeline,
  onAddPipeline,
  onRemovePipeline,
  onAddNode,
  onSelectNode,
  onRemoveNode,
  onToggleDependency,
  onChangeNodeDraft,
}: PipelineEditorProps) {
  return (
    <section className="editor-view">
      <div className="view-heading">
        <div>
          <span className="view-kicker">DEPENDENCY GRAPH</span>
          <h2>Pipeline graph</h2>
          <p>Nodes run after all named dependencies succeed. Unlinked nodes are independent.</p>
        </div>
        <button className="subtle-button" onClick={onAddPipeline}>＋ Add pipeline</button>
      </div>
      {pipelineNames.length > 0 ? (
        <>
          <div className="pipeline-switcher">
            {pipelineNames.map((name) => <button key={name} className={currentPipelineName === name ? "chosen" : ""} onClick={() => onSelectPipeline(name)}>{name}</button>)}
            {pipelineNames.length > 1 && <button className="remove-pipeline" onClick={onRemovePipeline}>Remove pipeline</button>}
          </div>
          <div className="graph-layout">
            <div className="graph-main">
              <div className="graph-toolbar">
                <div><b>{nodes.length} nodes</b><small>Click a node to inspect its complete configuration.</small></div>
                <button className="subtle-button" onClick={onAddNode}>＋ Add node</button>
              </div>
              <DependencyGraph nodes={nodes} selected={String(currentNode?.name ?? "")} onSelect={onSelectNode} />
            </div>
            <aside className="node-inspector">
              {currentNode ? (
                <>
                  <div className="inspector-heading">
                    <div><span className="view-kicker">NODE CONFIGURATION</span><h3>{String(currentNode.name)}</h3></div>
                    <button className="icon-action" onClick={() => onRemoveNode(String(currentNode.name))} aria-label={`Remove ${String(currentNode.name)}`}>×</button>
                  </div>
                  <p className="inspector-help">Edit the full node YAML. Use run.workload with an args mapping, or omit run for action-only nodes. before_run, after_run, finally, conditions and custom fields are preserved.</p>
                  <label className="advanced-label">Depends on<small>Names only: depends_on: [node_a, node_b]. A dependency must succeed, including its finally actions.</small></label>
                  <div className="dependency-checks">
                    {nodes.filter((node) => String(node.name) !== String(currentNode.name)).map((node) => (
                      <label key={String(node.name)}>
                        <Input
                          type="checkbox"
                          checked={nodeDependencyNames(currentNode).includes(String(node.name))}
                          onChange={(event) => onToggleDependency(String(node.name), event.target.checked)}
                        />
                        <span>{String(node.name)}</span>
                      </label>
                    ))}
                  </div>
                  <label className="advanced-label node-yaml-label">
                    Full node definition
                    <Textarea aria-label="Full node definition" className="code-editor node-code" spellCheck={false} value={nodeDraft} onChange={(event) => onChangeNodeDraft(event.target.value)} />
                  </label>
                </>
              ) : <div className="inspector-empty"><b>No node selected</b><small>Add nodes to make a pipeline graph.</small></div>}
            </aside>
          </div>
        </>
      ) : (
        <div className="empty-editor">
          <span>⌘</span><b>No pipelines yet</b><small>Add a pipeline to define how requests are processed.</small>
          <button className="subtle-button" onClick={onAddPipeline}>Add a pipeline</button>
        </div>
      )}
    </section>
  );
}

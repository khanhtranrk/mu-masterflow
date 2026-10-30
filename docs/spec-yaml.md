# Spec YAML and pipeline graph

## Full YAML is authoritative

MasterFlow saves the entire spec document as the `yaml` string on its Convex `specs` document. A spec can contain sections beyond those currently rendered by the UI. Preserve these sections and unknown fields when editing one part.

The desktop has views for `entries`, `workloads`, `pipeline`, requests, and complete YAML editing. These are conveniences over the same YAML document, not separate storage models.

## Pipeline model

A pipeline is a directed dependency graph. Each node has a name and can include arbitrary configuration such as `run`, `depends_on`, `skip_if`, `precondition`, `postcondition`, hooks, context, and custom keys. `depends_on` defines incoming edges. Nodes without dependencies can run independently. A pipeline is not necessarily a linear step-by-step sequence.

Illustrative shape:

```yaml
pipeline:
  song-with-cover:
    params:
      name: { type: string }
      lyrics: { type: string }
    nodes:
      - name: generate-song
        run:
          workload: yue2
      - name: generate-cover
        run:
          workload: qwen-image
      - name: separate-vocals
        depends_on:
          - generate-song
        run:
          workload: demucs
```

This is a structural example only. Keep real spec conditions and commands intact; do not replace arbitrary nodes with a simplified fixed schema.

## UI graph behavior

`DependencyGraph` derives nodes from the selected pipeline's `nodes` array and edges from each node's `depends_on`. In the editor, the graph opens a full YAML node inspector. In request details, it overlays `requests.nodeStates` on the graph defined by that request's spec pipeline. Selecting a node shows its status, reported device, artifacts, and logs.

Runtime node statuses are `queue`, `running`, `failed`, and `succeeded`. Node states are keyed by node name; if a state is not reported, request detail shows it as not reported.

## Editing rules

- Do not sort nodes and treat array order as execution order.
- `depends_on` is a list of node-name strings. Dependencies require success; dependency objects and conditions are unsupported.
- Preserve node YAML and unknown keys when changing dependencies.
- Allow each spec to define arbitrary pipeline names and workloads.
- Do not mirror `params` or `nodes` into Convex spec fields; raw YAML is authoritative.
- Fields not rendered in a dedicated view must survive edits elsewhere and remain editable via full YAML.


## Worker lifecycle

Use `entries.direct_flow` and `entries.master_flow`, each with action lists
`initialization` and `finalization`. Root `prepare` and `master-flow.requests`
were removed from Mu. Put pipeline-specific preparation under
`pipeline.<name>.prepare`: it runs only when a valid request uses that pipeline,
once per worker invocation across batches. The Pipeline view edits preparation for the selected pipeline. Complete YAML editing preserves all
pipeline fields, including prepare. Existing stored YAML is not auto-migrated.


## Current editor behavior

- **Entries** edits initialization and finalization independently for `direct_flow`
  (`mu run`) and `master_flow` (`mu master-flow run <spec-slug>`).
- **Pipeline** includes the node graph and dedicated YAML sections for params,
  context and prepare. Prepare is lazy and shared across that pipeline's requests;
  entry and pipeline setup do not receive request params.
- Dependency checkboxes write string names. Renaming a node updates incoming
  references. Adding an edge that creates a cycle is rejected. New nodes without
  an available workload are action-only and omit `run`.
- **Workloads** uses target, argv args, params, env, device_args and GPU units in
  4 GiB bands. Zero units means CPU-only.
- YAML syntax errors keep the raw text visible in the section being edited.
  Structured edits cannot silently replace an invalid draft. Full YAML remains
  available to fix unsupported or legacy fields. Unknown keys are preserved.
- Upload and save check the supported format, unique names, dependency references
  and cycles, action lists, conditions and workload calls. Diagnostics name the
  field that needs correction. Runtime execution semantics remain owned by Mu.
- Requests require a saved valid spec. Number inputs create JSON numbers; strings
  remain strings. Parameters with defaults are omitted unless **Override default**
  is selected, leaving template/default resolution to the worker. Request errors
  appear in the dialog. Saving edits made during an in-flight save remains pending.

Legacy stored YAML is shown with diagnostics rather than migrated automatically.
Move root prepare actions deliberately to the correct entry or pipeline, and
replace dependency objects with a list of names before saving.

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
          - node: generate-song
            condition:
              operator: node_status
              expected: success
        run:
          workload: demucs
```

This is a structural example only. Keep real spec conditions and commands intact; do not replace arbitrary nodes with a simplified fixed schema.

## UI graph behavior

`DependencyGraph` derives nodes from the selected pipeline's `nodes` array and edges from each node's `depends_on`. In the editor, the graph opens a full YAML node inspector. In request details, it overlays `requests.nodeStates` on the graph defined by that request's spec pipeline. Selecting a node shows its status, reported device, artifacts, and logs.

Runtime node statuses are `queue`, `running`, `failed`, and `succeeded`. Node states are keyed by node name; if a state is not reported, request detail shows it as not reported.

## Editing rules

- Do not sort nodes and treat array order as execution order.
- Do not discard `depends_on` conditions when editing graph edges.
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

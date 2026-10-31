# Spec YAML and pipeline graph

## Full YAML is authoritative

MasterFlow saves the entire spec document as the `yaml` string on its Convex `specs` document. A spec can contain sections beyond those currently rendered by the UI. Preserve these sections and unknown fields when editing one part.

The spec workspace has three tabs: **Requests** (first and selected when opening a spec), **Overview**, and **YAML**. Overview visualizes entries, pipeline dependency graphs, selected-node actions and conditions, workloads, and arbitrary additional fields. Expand configuration groups to inspect their values. YAML edits the complete document; Overview reflects the unsaved draft, and shows a warning with the last valid document when syntax is invalid. Requests continue to use the saved spec.

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

`DependencyGraph` derives nodes from the selected pipeline's `nodes` array and edges from each node's `depends_on`. In Overview, selecting a graph node opens its structured, read-only configuration inspector. In request details, it overlays `requests.nodeStates` on the graph defined by that request's spec pipeline. Selecting a node shows its status, reported device, artifacts, and logs.

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
once per worker invocation across batches. The YAML tab edits preparation for each pipeline. Complete YAML editing preserves all
pipeline fields, including prepare. Existing stored YAML is not auto-migrated.


## Current editor behavior

- **Overview** is read-only. It displays the entry lifecycle, a dependency graph per pipeline, complete node configuration, pipeline params/context/prepare, workloads, and custom root fields. Conditions and action groups have distinct accents; nested lists preserve their YAML order. YAML aliases are guarded against recursive rendering.
- **YAML** uses a full-area CodeMirror editor beside the sidebar, with YAML highlighting, line numbers, folding, two-space indentation, undo/redo, search/replace (Ctrl/⌘ F), syntax diagnostics, optional line wrapping, and light/dark themes. Ctrl/⌘ S saves; Escape then Tab moves keyboard focus out of the editor. It edits all configuration. Unknown keys remain in the authoritative document. Save validates the complete draft before updating the spec.
- YAML syntax errors keep the raw text editable and prevent saving. Overview explicitly labels its last-valid-document fallback.
- Upload and save check the supported format, unique names, dependency references
  and cycles, action lists, conditions and workload calls. Diagnostics name the
  field that needs correction. Runtime execution semantics remain owned by Mu.
- Request forms use the saved spec independently of unsaved spec edits. Number inputs create JSON numbers; strings
  remain strings. Parameters with defaults are omitted unless **Override default**
  is selected, leaving template/default resolution to the worker. Request errors
  appear in the dialog. Saving edits made during an in-flight save remains pending.

Legacy stored YAML is shown with diagnostics rather than migrated automatically.
Move root prepare actions deliberately to the correct entry or pipeline, and
replace dependency objects with a list of names before saving.


## Creating and editing requests

The Requests view uses a wide list/detail layout with search and status filters.
Request names come from payload `name` or `title`, with the request ID as fallback.
Inputs are displayed as readable text blocks, including long multiline lyrics;
execution and worker information have a separate tab.

**New request** opens a wide dialog with pipeline selection, large text fields,
optional defaults in a separate column, field validation and JSON editing. It
uses the saved pipeline schema even while unrelated spec edits are pending.
Changing pipelines preserves the in-progress draft for each pipeline. JSON/form
switching keeps string/number types and multiline content. Errors retain inputs.

**Edit inputs** is available for waiting requests. `requests.editPayload` checks
in one transaction that the request is still waiting, its payload matches the
version originally opened, and the new inputs match the saved parameter schema.
It only updates payload; status, assignment and node state are preserved. If a
worker claims the request or another editor saves first, save is rejected with an
explanation. Close and reopen to load the latest inputs.

Use **Duplicate request** to prefill a new waiting request from any previous run.
Requests that have left the waiting queue are read-only in this editor; duplicate
them instead of changing inputs that a worker may already be executing.

### Following request execution

Requests appear as horizontal rows with status, creation time, node progress, and assigned worker. Expand each row independently to inspect its execution graph, node logs, and artifacts. Processing and possessed requests expand by default; opening another request never closes existing rows. Worker reports reactively update the graph and progress. Each expanded request has a collapsible Artifacts section. Clicking a node's artifact count opens that section and highlights its files in the shared request list; Clear highlight resets the emphasis. Each expanded request has its own Follow execution control, which centers on a failed node first, then a running node. Selecting a node pauses following. The row’s three-dot button opens a menu for editing waiting requests, duplicating, or deleting a request. Deleting does not stop an already running worker.

Requests can be deleted from the request details with confirmation. Deletion sets optional `requests.deletedAt` (Unix milliseconds) and preserves the record. It leaves the existing `status` unchanged; `deleted` is not a request status. Visibility and claim eligibility depend on `deletedAt`, independently of execution status. Deleted requests are excluded through indexes before list/inspection/claim limits and cannot be edited. Deletion is idempotent and does not cancel an already running worker; its reports remain accepted without clearing `deletedAt`.


## File artifacts and HTTP actions

File outputs belong to `requests.artifacts[]`, with an optional producing `nodeName`; `nodeStates.<name>.artifacts[]` uses the same metadata shape to reference those registered files; this metadata is runtime data and is not stored in the authoritative spec YAML. Mu HTTP actions support `body_file`, `response_file` and positive `timeout` seconds, while existing JSON `body` and `save_state` remain supported. `body` and `body_file` cannot be combined. See [Request artifacts](request-artifacts.md) for the API flow and the companion Mu executable example.

### YAML problem panel

The YAML tab keeps a fixed editor layout while validating drafts. Syntax diagnostics
and the Problems count update after 600 ms without typing. The Problems button in
the top right opens an overlay on the right; it never opens or closes automatically.
The panel lists all syntax errors/warnings and, when syntax is valid, structural spec
issues with their field paths. Syntax entries navigate to their line and column;
navigation waits for validation of the current draft. Escape or Close dismisses the
panel. Validation banners above the editor are hidden in the YAML tab. Save still
validates immediately and remains blocked for invalid drafts.

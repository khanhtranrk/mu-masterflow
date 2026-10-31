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
          - type: execute_workload
            workload: yue2
      - name: generate-cover
        run:
          - type: execute_workload
            workload: qwen-image
      - name: separate-vocals
        depends_on:
          - generate-song
        run:
          - type: execute_workload
            workload: demucs
```

This is a structural example only. Keep real spec conditions and commands intact; do not replace arbitrary nodes with a simplified fixed schema.

## UI graph behavior

`DependencyGraph` derives nodes from the selected pipeline's `nodes` array and edges from each node's `depends_on`. In Overview, selecting a graph node opens its structured, read-only configuration inspector. In request details, it overlays `requests.nodeStates` on the graph defined by that request's spec pipeline. Selecting a node highlights it in the graph. Status and reported device appear directly on the node; its artifact count opens the shared artifact section.

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

### Resetting a failed request

The request action menu offers **Reset request** only for `process_failed` and
`retrieve_artifact_failed` (legacy `failed` records are also supported). After
confirmation, `requests.reset` checks authentication and the latest status in one
transaction. Missing/deleted requests, unavailable specs/pipelines and every
non-failure status are rejected without changes.

Reset preserves the request ID, original creation time, spec, pipeline and payload;
it sets status to `waiting` and removes worker assignment, claim time, node states,
logs and artifact links. It creates no duplicate and preserves the original FIFO
creation order. The request can be claimed again normally. Previously stored file
bytes are retained, but upload receipts from earlier runs cannot register files
after reset. Uploads started after reset work as usual. The HTTP report contract
is unchanged; resetting a failure requeues it and does not cancel a worker that
is still reporting.

### Following request execution

Requests use the available workspace width. Switch between List rows and a responsive Grid of cards; the choice is remembered on this device. Both show status, pipeline, creation time, node progress, and assigned worker. In Grid, an expanded request spans the full row and moves subsequent cards to the next available row; collapsing restores its normal card width. Expand each row independently to inspect only its execution graph and artifacts. The expanded area has no summary header or node-detail/log panel. Requests start collapsed except while processing, which expands automatically; succeeded and process-failed requests collapse automatically. A newly process-failed request briefly flashes red. Opening another request never closes existing rows. Worker reports reactively update the graph and progress. Each expanded request has a collapsible Artifacts section. Clicking a node's artifact count opens that section and highlights its files in the shared request list; Clear highlight resets the emphasis. The graph initially focuses on a failed node first, then a running node. Selecting a node keeps focus on that node. The row’s three-dot button opens a menu for editing waiting requests, duplicating, or deleting a request. Deleting does not stop an already running worker.

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
panel. Validation lists are confined to the YAML Problems panel. Requests and Overview
do not render the shared validation banner. The YAML tab shows a warning icon
for an invalid current draft or saved document; saved invalid specs also have a
warning icon in the sidebar. Draft-only errors do not mark other saved specs. Save still
validates immediately and remains blocked for invalid drafts.

### Live request updates and artifact layouts

Worker reports update status colors, graph nodes, progress and artifacts immediately.
Requests have no layout transitions, disclosure fades, border sweeps, moving graph
edges, pulsing nodes or smooth auto-scroll. The processing card has a subtle glow;
new process failures briefly flash red. Hover remains a static whole-card cue.

Artifact sections default to a responsive Grid, with a List option for long file
names. Artifact layout is shared across expanded requests and remembered locally.
Node artifact links still open the same shared request artifact section and
highlight the relevant files. Upload/download behavior is unchanged.

The Requests header is a compact toolbar: clickable pipeline tabs, each with a
request-count badge, a short search field, status and List/Grid controls. Badges
count all loaded requests for their pipeline, independently of search/status filters.
While filtering, a separate filtered/total count appears beside the controls. It
wraps into two rows for narrower windows. Request creation stays in the spec
header; the content does not repeat the page title or creation button.

## Sequential node actions and workload scheduling

`before_run`, `run`, and `after_run` are separate ordered action lists. Each
accepts `execute_command`, `execute_workload`, `create_dir`, `write_json`, and
`send_http_request`. A node runs these phases in that order, then its
postcondition, then `finally`. The first unignored action failure stops the
remaining main actions and proceeds to `finally`. `run` may be omitted or `[]`.
Actions retain context, skip/pre/postconditions and `ignore_error` support.

```yaml
workloads:
  inspect:
    params:
      input: {type: string}
    target: python
    args: [-c, "import pathlib, sys; print(pathlib.Path(sys.argv[1]).stat().st_size)", "{params[input]}"]
    units: 0
pipeline:
  inspect-file:
    params:
      input: {type: string}
    nodes:
      - name: inspect
        run:
          - type: execute_workload
            workload: inspect
            args:
              input: "{params[input]}"
          - type: write_json
            path: "{session[output_dir]}/inspected.json"
            content: {status: completed}
```

`execute_workload.workload` is a literal name from `workloads`; templates in the
name are rejected because placement is decided before execution. Its `args` is
a mapping of workload parameters, distinct from command/workload argv lists.
Each call gets its own workload params; pipeline and sibling node params remain
isolated. `save_state` is supported only by command and HTTP actions.
`execute_workload` is not supported in node `finally`, pipeline `prepare`, or
entry initialization/finalization.

Mu reserves the **maximum** workload `units` across all three main phases before
any node action starts. Conditional/skipped workload calls still contribute to
this maximum. The assigned GPU is held through `finally`; sequential workloads
share it. `units: 0` workloads remain CPU-only and receive neither device args nor
schedule context. Nodes without GPU demand wait only for successful dependencies
and the worker's concurrency limit (32 nodes). `node.total_units` is available
from node start. MasterFlow validates declarations; Mu owns actual scheduling,
parameter resolution, device placement and execution.

### Migrating old specs

The former mapping is rejected with a field-path diagnostic:

```yaml
# Old
run:
  workload: inspect
  args: {input: "{params[input]}"}
# New
run:
  - type: execute_workload
    workload: inspect
    args: {input: "{params[input]}"}
```

Migrate each node deliberately; stored YAML is not automatically rewritten.
The same validator drives upload, save and the YAML Problems panel. Overview
preserves every action and graph labels collect workload names from all three
main phases. Unknown unrelated keys remain intact.

### Media artifact example

The companion Mu `examples/song-with-cover/spec.yaml` uses `run` for generation
followed by hashing/sizing, receipt creation, binary upload and completion:

| Node | Uploaded files | Stable artifact IDs |
|---|---|---|
| `generate-song` | MP3 and ABC notation | `song-mp3`, `song-abc` |
| `generate-cover` | PNG | `cover-png` |
| `separate-vocals` | None; WAV stays local | None |
| `transcribe-vocals` | `transcript/vocals.json` | `transcript-json` |

Generation checks belong on the workload action's `skip_if`, so cached files
still reach subsequent upload actions. Upload errors fail the node before its
automatic terminal report. Upload completion attaches `nodeName`; the following node report
inherits the registered artifact references. A stable ID replaces that file on
the same request. Send the worker token only to the application API, never to
native storage upload URLs. See [request artifacts](request-artifacts.md) for
endpoint contracts and limits. Media examples require MasterFlow context and
must not be run as routine validation: they download models and use GPU resources.

## Scheduler state in request items

The request badge describes the request, not every node. `possessed` is labeled
`Queued on worker`; `processing` is `Processing request` and begins with the first
node dispatch. Node reasons explain dependency/resource/slot waits. A `running`
node already owns its scheduler reservation, including before_run and uploads.
Final states follow finally. Blocked nodes are failed with a Blocked label and
explanation. Request summaries count only nodes in the current pipeline.

For an ended request, stale `queue`/`running` or absent node reports are displayed
as `Final state not reported`; neither node nor edge appears actively running.
The desktop does not rewrite those records or assume which nodes failed. Known
succeeded/failed nodes retain their actual outcomes. Request completion does not
wait for unrelated requests from the same worker batch. Specs should leave
lifecycle reporting to Mu and use hooks for business notifications instead.

import { Component, useMemo, type ReactNode } from "react";
import { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { Status } from "./Status";
import "../activity.css";

export function ActivityView({ connected }: { connected: boolean }) {
  return <ActivityRenderBoundary><ActivityContent connected={connected} /></ActivityRenderBoundary>;
}

// Query errors are handled below; this also contains unexpected render errors
// (for example malformed legacy data), keeping the sidebar usable for diagnosis.
class ActivityRenderBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div className="editor-scroll activity-scroll">
        <h1>Activity</h1>
        <div className="activity-query-error" role="alert">
          <p>Activity could not be displayed.</p>
          <pre>{this.state.error.message}</pre>
        </div>
      </div>;
    }
    return this.props.children;
  }
}

function ActivityContent({ connected }: { connected: boolean }) {
  // useQueries returns query errors as values so each section can report its
  // own failure without unmounting the desktop shell.
  // Keep the subscription configuration stable across renders. A new object
  // makes useQueries rebuild its subscription and schedule another render.
  const queries = useMemo(() => ({
    units: { query: api.units.list, args: {} },
    activity: { query: api.requests.listActive, args: {} },
  }), []);
  const results = useQueries(queries);
  const unitsError = results.units instanceof Error ? results.units : undefined;
  const activityError = results.activity instanceof Error ? results.activity : undefined;
  const units = (unitsError ? undefined : results.units) as Doc<"units">[] | undefined;
  const activity = (activityError ? undefined : results.activity) as FunctionReturnType<typeof api.requests.listActive> | undefined;
  const sortedUnits = units?.slice().sort((a, b) =>
    Number(b.status === "online") - Number(a.status === "online") || a.unitId.localeCompare(b.unitId));

  return (
    <div className="editor-scroll activity-scroll">
      <header className="activity-header">
        <h1>Activity</h1>
        <span className="activity-muted">{connected ? "Live updates" : "Connecting… Data may be out of date."}</span>
      </header>
      <section className="activity-section" aria-labelledby="activity-units">
        <h2 id="activity-units">Units {units !== undefined && <span>{units.length}</span>}</h2>
        {unitsError ? <ActivityQueryError label="units" error={unitsError} /> : sortedUnits === undefined ? <p role="status">Loading units…</p> : sortedUnits.length === 0 ? <p>No units registered.</p> : (
          <div className="activity-table-wrap"><table className="activity-table">
            <thead><tr><th>Unit ID</th><th>Status</th><th>Devices</th><th>Last seen</th></tr></thead>
            <tbody>{sortedUnits.map(unit => <tr key={unit._id}>
              <td><code>{unit.unitId}</code></td>
              <td><span className={`activity-presence ${unit.status}`}>{unit.status === "online" ? "Online" : "Offline"}</span></td>
              <td>{unit.devices.length ? unit.devices.map(device => `${device.family}:${device.index}`).join(", ") : "—"}</td>
              <td><time dateTime={new Date(unit.lastSeen).toISOString()}>{new Date(unit.lastSeen).toLocaleString()}</time></td>
            </tr>)}</tbody>
          </table></div>
        )}
        {units?.length === 200 && <p className="activity-muted">Showing the latest 200 registered units.</p>}
      </section>
      <section className="activity-section" aria-labelledby="activity-requests">
        <h2 id="activity-requests">Active Requests {activity !== undefined && <span>{activity.requests.length}</span>}</h2>
        {activityError ? <ActivityQueryError label="active requests" error={activityError} /> : activity === undefined ? <p role="status">Loading active requests…</p> : activity.requests.length === 0 ? <p>No requests are currently possessed or processing.</p> : (
          <div className="activity-table-wrap"><table className="activity-table">
            <thead><tr><th>Request ID</th><th>Status</th><th>Assigned unit</th><th>Nodes</th><th>Claimed at</th></tr></thead>
            <tbody>{activity.requests.map(request => <tr key={request._id}>
              <td><code>{request._id}</code></td>
              <td><span className={`status-tag ${request.status}`}><i />{request.status === "possessed" ? "Possessed" : "Processing"}</span></td>
              <td><code>{request.unitId ?? "—"}</code></td>
              <td>{request.nodes.length ? <div className="activity-nodes">{request.nodes.map(node => (
                <span className="activity-node" key={node.name}><span>{node.name}</span><Status status={node.status} /></span>
              ))}</div> : <span className="activity-muted">No node status reported</span>}</td>
              <td>{request.claimedAt === undefined ? "—" : <time dateTime={new Date(request.claimedAt).toISOString()}>{new Date(request.claimedAt).toLocaleString()}</time>}</td>
            </tr>)}</tbody>
          </table></div>
        )}
        {activity?.truncated && <p className="activity-muted">Showing the first 500 requests per active status.</p>}
      </section>
    </div>
  );
}

function ActivityQueryError({ label, error }: { label: string; error: Error }) {
  const missingFunction = error.message.includes("Could not find public function");
  return (
    <div className="activity-query-error" role="alert">
      <p>Could not load {label}. {missingFunction
        ? "The connected Convex server is missing an Activity query. Sync the backend functions and reopen Activity."
        : "The connected Convex server returned an error."}</p>
      <details><summary>Error details</summary><pre>{error.message}</pre></details>
    </div>
  );
}

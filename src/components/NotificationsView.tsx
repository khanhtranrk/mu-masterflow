import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { enableSystemNotifications, systemNotificationsEnabled } from "../systemNotifications";

type NotificationItem = {
  _id: Id<"notifications">;
  title: string;
  message: string;
  tags?: string[];
  createdAt: number;
  readAt?: number;
};

export function NotificationsView() {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const notifications = useQuery(api.notifications.list, { limit: 100 });
  const markRead = useMutation(api.notifications.markRead);
  const removeNotification = useMutation(api.notifications.remove);
  const unreadCount = notifications?.filter((notification) => notification.readAt === undefined).length ?? 0;

  useEffect(() => {
    let active = true;
    void systemNotificationsEnabled()
      .then((enabled) => {
        if (active) setPermissionGranted(enabled);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not check notification permission.");
      });
    return () => { active = false; };
  }, []);

  async function enableNotifications() {
    setError("");
    try {
      setPermissionGranted(await enableSystemNotifications());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not enable system notifications.");
    }
  }

  async function markAsRead(notification: NotificationItem) {
    setError("");
    try {
      await markRead({ id: notification._id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not mark notification as read.");
    }
  }

  async function deleteNotification(notification: NotificationItem) {
    setError("");
    try {
      await removeNotification({ id: notification._id });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete notification.");
    }
  }

  return (
    <section className="editor-view notifications-view">
      <header className="notifications-toolbar">
        <h1>Notifications {notifications !== undefined && <span className="notification-unread-summary">{unreadCount} unread</span>}</h1>
        <div className="notification-permission" title="System notifications are delivered when MasterFlow is not focused.">
          <span>System notifications: <b>{permissionGranted === null ? "Checking…" : permissionGranted ? "Enabled" : "Off"}</b></span>
          {permissionGranted === false && <button className="subtle-button" onClick={() => void enableNotifications()}>Enable</button>}
        </div>
      </header>

      {error && <div className="inline-error">{error}<button onClick={() => setError("")}>×</button></div>}
      {notifications === undefined ? (
        <div className="empty-editor"><small>Loading notifications…</small></div>
      ) : notifications.length === 0 ? (
        <div className="empty-editor"><small>No notifications yet. Worker updates will appear here.</small></div>
      ) : (
        <div className="notification-list">
          {notifications.map((notification) => (
            <article className={`notification-card ${notification.readAt === undefined ? "unread" : ""}`} key={notification._id}>
              <span className="notification-unread-dot" aria-label={notification.readAt === undefined ? "Unread" : "Read"} />
              <div className="notification-content">
                <div className="notification-card-heading">
                  <h3>{notification.title}</h3>
                  <time dateTime={new Date(notification.createdAt).toISOString()}>{new Date(notification.createdAt).toLocaleString()}</time>
                </div>
                <p>{notification.message}</p>
                {notification.tags && notification.tags.length > 0 && (
                  <div className="notification-tags">
                    {notification.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}
                  </div>
                )}
              </div>
              <div className="notification-actions">
                {notification.readAt === undefined && (
                  <button className="subtle-button" onClick={() => void markAsRead(notification)}>Mark read</button>
                )}
                <button className="subtle-button danger" aria-label={`Delete ${notification.title}`} onClick={() => void deleteNotification(notification)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

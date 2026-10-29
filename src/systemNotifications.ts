import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function systemNotificationsEnabled() {
  if (isTauri()) return await isPermissionGranted();
  return "Notification" in window && window.Notification.permission === "granted";
}

export async function enableSystemNotifications() {
  if (isTauri()) return (await requestPermission()) === "granted";
  if (!("Notification" in window)) return false;
  return (await window.Notification.requestPermission()) === "granted";
}

export async function sendSystemNotification(title: string, body: string) {
  if (!(await systemNotificationsEnabled())) return;
  if (isTauri()) {
    sendNotification({ title, body });
  } else {
    new window.Notification(title, { body });
  }
}

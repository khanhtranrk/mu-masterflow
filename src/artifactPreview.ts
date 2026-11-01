import { invoke, isTauri } from "@tauri-apps/api/core";
export type PreviewKind = "image" | "audio" | "video" | "text" | "pdf" | "unsupported";
export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export const PDF_PREVIEW_LIMIT = 16 * 1024 * 1024;
export function artifactPreviewKind(name: string, contentType: string): PreviewKind {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "image/svg+xml" || ["svg", "html", "htm", "xml"].includes(ext)) return "text";
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"].includes(mime)) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || /(?:json|javascript|yaml|toml|xml)/.test(mime)) return "text";
  if (!mime || mime === "application/octet-stream") {
    if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"].includes(ext)) return "image";
    if (["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"].includes(ext)) return "audio";
    if (["mp4", "webm", "mov", "mkv"].includes(ext)) return "video";
    if (ext === "pdf") return "pdf";
    if (["txt", "log", "json", "jsonl", "yaml", "yml", "csv", "tsv", "md", "srt", "vtt", "py", "js", "ts", "toml"].includes(ext)) return "text";
  }
  return "unsupported";
}
export async function readPreviewBytes(url: string, kind: "text" | "pdf", signal: AbortSignal) {
  if (isTauri()) {
    const result = await invoke<{ base64: string; truncated: boolean }>("read_artifact_preview", { url, kind });
    if (signal.aborted) throw new DOMException("Preview closed", "AbortError");
    return { bytes: Uint8Array.from(atob(result.base64), c => c.charCodeAt(0)), truncated: result.truncated };
  }
  const limit = kind === "text" ? TEXT_PREVIEW_LIMIT : PDF_PREVIEW_LIMIT;
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Could not load preview (HTTP ${response.status}).`);
  if (!response.body) throw new Error("This browser cannot read file previews.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0, truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      const keep = Math.min(value.length, limit - size);
      if (keep) { chunks.push(value.slice(0, keep)); size += keep; }
      if (keep < value.length) { truncated = true; break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, truncated };
}
export function previewText(bytes: Uint8Array, name: string, mime: string, truncated: boolean) {
  const text = new TextDecoder().decode(bytes);
  if (!truncated && (name.toLowerCase().endsWith(".json") || mime.includes("json"))) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* Display malformed JSON as its original text. */ }
  }
  return text;
}

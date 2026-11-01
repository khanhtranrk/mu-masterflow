/** Legacy files are served by the same Convex API selected in the connection profile.
 * S3 signatures bind the host, so their URLs must remain byte-for-byte unchanged. */
export function artifactDownloadUrl(result: { url: string; legacy: boolean }, clientUrl: string): string {
  const url = new URL(result.url);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("The server returned an invalid download URL.");
  if (result.legacy && url.pathname.startsWith("/api/storage/")) {
    const server = new URL(clientUrl);
    url.protocol = server.protocol;
    url.host = server.host;
    return url.href;
  }
  return result.url;
}

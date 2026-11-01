import { ConvexError } from "convex/values";

// Actions aren't automatically retried like queries. Retry only Convex's transient
// query transport failure; each retry reruns authorization in the original query.
export async function retryDownloadQuery<T>(operation: () => Promise<T>, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Transient error while running query")) throw error;
      if (attempt === 2) throw new ConvexError("Download could not be prepared because the server is temporarily unavailable. Please try again.");
      console.warn(`Transient Convex download query failure; retrying (${attempt + 2}/3).`);
      await wait(attempt === 0 ? 200 : 500);
    }
  }
}

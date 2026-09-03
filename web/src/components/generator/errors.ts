/** Turns a thrown fetch/parse error into one plain line. The vite proxy returns an empty non-JSON body when the API is down. */
export function describeFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/JSON/i.test(msg)) return "the extraction API did not answer (no JSON from /api/extract). Is the server running?";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "network error reaching /api/extract.";
  return msg;
}

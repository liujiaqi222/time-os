/** Next may reconstruct request.url with an internal hostname. The HTTP Host
 * header retains the authority the browser actually requested.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const incoming = new URL(request.url);
    const target = new URL(
      `${incoming.protocol}//${request.headers.get("host") ?? incoming.host}`,
    );
    return origin === target.origin;
  } catch {
    return false;
  }
}

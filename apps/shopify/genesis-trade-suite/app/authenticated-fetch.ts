/** Refresh the token for each app request, including React Router Request objects. */
export function createAuthenticatedFetch(
  fetchRequest: typeof fetch,
  origin: string,
  getToken: () => Promise<string>,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin || !url.pathname.startsWith("/app")) return fetchRequest(input, init);
    const request = new Request(url, input instanceof Request ? input : undefined);
    const updated = new Request(request, init);
    const headers = new Headers(updated.headers);
    headers.set("Authorization", `Bearer ${await getToken()}`);
    return fetchRequest(new Request(updated, { headers }));
  };
}

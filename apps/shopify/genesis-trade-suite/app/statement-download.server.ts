export async function forwardStatementDownload(
  request: Request,
  options: { apiUrl?: string; fetchRequest?: typeof fetch } = {},
): Promise<Response> {
  const apiUrl = options.apiUrl ?? process.env.TRADE_API_URL;
  if (!apiUrl) return new Response("Statement API is unavailable", { status: 503 });

  const source = new URL(request.url);
  const target = new URL(`${apiUrl.replace(/\/$/, "")}/v1/statements/download`);
  for (const name of ["key", "expires", "signature", "tenant"]) {
    const value = source.searchParams.get(name);
    if (value !== null) target.searchParams.set(name, value);
  }

  try {
    const upstream = await (options.fetchRequest ?? fetch)(target, {
      redirect: "manual",
      signal: request.signal,
    });
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const name of ["Content-Type", "Content-Disposition", "Location"]) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response("Statement API could not be reached", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

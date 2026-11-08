export const onRequest: PagesFunction = async ({ request, next }) => {
  const requestHeaders = new Headers(request.headers);
  const ifNoneMatch = requestHeaders.get("If-None-Match");
  requestHeaders.delete("If-None-Match");
  // Resolve the representation first: Pages can otherwise return a bodyless 304 for its HTML fallback.
  const asset = await next(new Request(request, { headers: requestHeaders }));
  if (asset.status === 404 || asset.headers.get("Content-Type")?.toLowerCase().startsWith("text/html")) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", asset.ok ? "public, max-age=31536000, immutable" : "no-store");
  const etag = headers.get("ETag");
  const notModified = asset.ok && (request.method === "GET" || request.method === "HEAD") &&
    ifNoneMatch !== null && ifNoneMatch.split(",").some(value =>
      value.trim() === "*" || (etag !== null && value.trim().replace(/^W\//, "") === etag.replace(/^W\//, "")));
  return new Response(notModified ? null : asset.body, {
    status: notModified ? 304 : asset.status, statusText: notModified ? "Not Modified" : asset.statusText, headers,
  });
};

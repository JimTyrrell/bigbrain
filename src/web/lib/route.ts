// URL hash reflects the selection: #/b/<brainId>/c/<convId>
export type Route = { brainId: string | null; convId: string | null };

export function parseHash(hash = window.location.hash): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const r: Route = { brainId: null, convId: null };
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] === "b") r.brainId = parts[i + 1] ?? null;
    if (parts[i] === "c") r.convId = parts[i + 1] ?? null;
  }
  if (!r.brainId) r.convId = null;
  return r;
}

export function buildHash(r: Route): string {
  if (!r.brainId) return "#/";
  let h = `#/b/${encodeURIComponent(r.brainId)}`;
  if (r.convId) h += `/c/${encodeURIComponent(r.convId)}`;
  return h;
}

export function writeHash(r: Route, replace = false) {
  const h = buildHash(r);
  if (window.location.hash === h) return;
  if (replace) history.replaceState(null, "", h);
  else history.pushState(null, "", h);
}

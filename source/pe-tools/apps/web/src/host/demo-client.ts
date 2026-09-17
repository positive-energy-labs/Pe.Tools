/**
 * The live demo lane. `?demo=<seed>&live=1` runs a route's real code against the host's simulated
 * owner (`/demo/instances/<id>`): every host read and write the page makes is rewritten to that
 * owner, so capture files a member into the instance's own pod and apply files a run receipt
 * there. Without `live`, `?demo=<seed>` stays a frozen, read-only seed. The owner outlives a page
 * load for the tab (sessionStorage), so `/pods?demo=…&live=1` browses what a route just wrote.
 */
import { address, exportSeed, type DemoSeed } from "@pe/agent-contracts";

const search = () =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search);

/** The seed a page mounts frozen; null in the live lane and outside the demo lane. */
export const frozenDemo = (): string | null => {
  const params = search();
  return params?.has("live") ? null : (params?.get("demo") ?? null);
};

/** The paths a page reaches the host on; everything else (documents, schemas) stays put. */
const HOST_PATH =
  /^\/(?:call|actions|family\/readings|schedules\/readings|pe\/resources|pe\/route-state\/)/;

const schemaUrl = (path: string) => `${location.origin}/schemas/settings/${path}`;
const common = {
  version: 1,
  namespace: "isolated-demo",
  failure: { kind: "none" },
  originalEvidence: null,
} as const;
const FAMILIES = ["Fan Coil Unit - Ducted", "Heat Pump - Split"];

/** A family document holding one saved model; `/family` works here. */
const familySeed = (): DemoSeed => ({
  ...common,
  route: "family",
  seedAddress: address("C:/demo/live-family.rfa"),
  work: {
    key: { route: "family", target: null, work: "live" },
    revision: 0,
    candidate: { basis: null, fields: {} },
  },
  readings: {
    captures: [],
    files: [
      {
        member: { pod: "demo", path: "settings/family/box.json" },
        rawContent: JSON.stringify({
          $schema: schemaUrl("FamilyFoundry/models.json"),
          family: { name: "Box", category: "Generic Models", template: "Generic Model" },
          types: {},
          parameters: {},
        }),
      },
    ],
  },
  page: { inputBuffer: null, armed: false },
  scenario: "success",
});

/** A project document with two loaded families, a scope, and one saved families spec. */
const projectSeed = (): DemoSeed => ({
  ...common,
  route: "families",
  seedAddress: address("C:/demo/live-project.rvt"),
  work: {
    key: { route: "families", target: null },
    revision: 0,
    candidate: {
      scope: {
        categoryNames: ["Mechanical Equipment"],
        familyNames: FAMILIES,
        placementScope: "AllLoaded",
      },
      excludedIds: [],
    },
  },
  readings: {
    profile: { $schema: schemaUrl("FamilyFoundry/patches.json"), patch: { types: {} } },
    member: { pod: "demo", path: "settings/families/mech-standard.json" },
    families: FAMILIES,
  },
  page: { armed: false },
  scenario: "success",
});

type Kind = "family" | "project";
const stored = (kind: Kind | "last") => {
  try {
    return sessionStorage.getItem(`pe-demo-live:${kind}`);
  } catch {
    return null;
  }
};
const store = (kind: Kind, base: string) => {
  try {
    sessionStorage.setItem(`pe-demo-live:${kind}`, base);
    sessionStorage.setItem("pe-demo-live:last", base);
  } catch {
    /* the owner still serves this load */
  }
};

async function createOwner(kind: Kind, fetchHost: typeof fetch) {
  const response = await fetchHost("/demo/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: exportSeed(kind === "family" ? familySeed() : projectSeed()) }),
  });
  if (!response.ok) throw Error(`demo owner refused: ${await response.text()}`);
  const owner = (await response.json()) as { id: string; base: string };
  if (!/^\/demo\/instances\/demo-[\w-]+$/.test(owner.base)) throw Error("not a demo owner");
  return owner.base;
}

/**
 * Route this page's host traffic to one owner. The owner admits only action ids it minted the
 * prefix for (imported ids are never executable), so a request id gets the owner's prefix here.
 */
function install(owner: Promise<string>) {
  const fetchHost = window.fetch.bind(window);
  const Source = window.EventSource;
  let known = "/demo/instances/pending";
  void owner.then((base) => (known = base));
  const rewrite = (url: URL, base: string) => new URL(`${base}${url.pathname}${url.search}`, url);
  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== location.origin || !HOST_PATH.test(url.pathname)) return fetchHost(request);
    const base = await owner;
    const id = base.slice("/demo/instances/".length);
    const own = (value: string) => (value.startsWith(`${id}:`) ? value : `${id}:${value}`);
    const target = rewrite(url, base);
    if (url.pathname.startsWith("/actions") && target.searchParams.has("id"))
      target.searchParams.set("id", own(target.searchParams.get("id")!));
    let body = request.method === "GET" || request.method === "HEAD" ? null : await request.text();
    if (body && url.pathname.startsWith("/actions")) {
      const admission = JSON.parse(body) as { id?: string };
      if (admission.id) body = JSON.stringify({ ...admission, id: own(admission.id) });
    }
    return fetchHost(target, {
      method: request.method,
      headers: request.headers,
      body,
      signal: request.signal,
    });
  };
  window.EventSource = class extends Source {
    constructor(url: string | URL, init?: EventSourceInit) {
      const parsed = new URL(url, location.href);
      super(
        parsed.origin === location.origin && HOST_PATH.test(parsed.pathname)
          ? rewrite(parsed, known)
          : parsed,
        init,
      );
    }
  };
  return fetchHost;
}

/** Boot the lane once per page load, before any route reads the host. */
function boot() {
  const params = search();
  if (typeof window === "undefined" || !params?.has("live") || !params.has("demo")) return;
  const path = location.pathname;
  const kind: Kind | "last" = /^\/family(?:\/|$)/.test(path)
    ? "family"
    : path.startsWith("/pods")
      ? "last"
      : "project";
  const known = stored(kind);
  let resolve!: (base: string) => void;
  const owner = new Promise<string>((done) => (resolve = done));
  const fetchHost = install(owner);
  const retarget = (base: string) => {
    const url = new URL(location.href);
    url.searchParams.set("target", base.slice("/demo/instances/".length));
    location.replace(url);
  };
  if (known && kind !== "last" && params.get("target") !== known.slice("/demo/instances/".length))
    return retarget(known);
  if (known) {
    resolve(known);
    // A host restart retires every owner; start over rather than talk to a dead one.
    void fetchHost(`${known}/description`).then((response) => {
      if (response.ok) return;
      for (const key of ["family", "project", "last"])
        sessionStorage.removeItem(`pe-demo-live:${key}`);
      location.reload();
    });
    return;
  }
  void createOwner(kind === "last" ? "project" : kind, fetchHost).then((base) => {
    store(kind === "last" ? "project" : kind, base);
    // Bind the route to the owner's one session; the reload mounts every reading against it.
    if (kind === "last") location.reload();
    else retarget(base);
  });
}

boot();

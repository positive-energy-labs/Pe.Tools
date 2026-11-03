import { useEffect, useReducer, useState } from "react";
import { createRoute, useRouter, useRouterState } from "@tanstack/react-router";
import { routeSearch } from "../shell/owner";
import { Route as root } from "../routes/__root";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { capturesSources } from "./sources";
import { CapturesList } from "./list";
import { admitCaptures, capturesArtifact } from "./admission";
import { createCapturesMount } from "./mount";
import { captureId } from "./kernel";
import { identityCodecs } from "../shell/page-port";
export const capturesAdapters = { sources: capturesSources() };
function Captures() {
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.search });
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const [mount, setMount] = useState<ReturnType<typeof createCapturesMount> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let retired = false;
    let owned: ReturnType<typeof createCapturesMount> | undefined;
    void admitCaptures().then((route) => {
      if (retired) return;
      const source = capturesAdapters.sources["captures.list"];
      if (source.kind !== "use") throw Error("Captures needs a read source");
      owned = createCapturesMount(route, capturesArtifact.fingerprint, source, search, changed);
      setMount(owned);
    }).catch((cause: unknown) => { if (!retired) setError(String(cause)); });
    return () => { retired = true; owned?.close(); };
  }, []);
  useEffect(() => {
    if (!mount) return;
    try { mount.restore(search); } catch (cause) { setError(String(cause)); }
  }, [mount, search]);
  if (error) return <OutcomeLine kind="error" label="captures refused" says={error} />;
  if (!mount) return <p>Reading captures...</p>;
  const { page, reading } = mount.read();
  const captures = reading.value ?? [];
  return <>
    <Button label="refresh" onClick={() => void mount.refresh().catch((cause: unknown) => setError(String(cause)))}>refresh</Button>
    {!reading.current && <p>{reading.reason}</p>}
    <CapturesList captures={captures} focus={page.sha ? identityCodecs.local.parts(page.sha).subject : undefined}
      open={page.open.kind === "all" ? captures.map((c) => c.sha) : page.open.ids}
      onPage={(next) => {
        if (next.sha !== undefined) {
          mount.ports.controls.subject(captureId(next.sha));
          mount.ports.page.select([{ kind: "capture", id: captureId(next.sha) }]);
        }
        if (next.open) mount.ports.page.pose({ open: { kind: "ids", ids: next.open } }, "named");
        const current = mount.read().page;
        const params = new URLSearchParams({ sha: current.sha ?? "", selected: JSON.stringify(current.selected), open: JSON.stringify(current.open) });
        router.history.push(`/captures?${params}`);
        void router.load();
      }} />
  </>;
}
export const capturesRoute = createRoute({ getParentRoute: () => root, path: "/captures",
  validateSearch: (search: Record<string, unknown>) => ({ ...routeSearch(search),
    ...(typeof search.sha === "string" ? { sha: search.sha } : {}),
    ...(search.open !== undefined ? { open: typeof search.open === "string" ? search.open : JSON.stringify(search.open) } : {}),
    ...(search.selected !== undefined ? { selected: typeof search.selected === "string" ? search.selected : JSON.stringify(search.selected) } : {}),
    ...(typeof search.fixture === "string" ? { fixture: search.fixture } : {}),
  }), component: Captures });

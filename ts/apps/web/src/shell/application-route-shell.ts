import { createElement, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { createRouteShell } from "./admitted-mount";
import { AdmittedPane, type AdmittedPaneProps } from "./admitted-pane";
import { sourceRouteServices } from "./source-route-services";
import { admittedSources } from "./admitted-sources";
import { useRouteTarget } from "../route/route-target";
import { appAtomRegistry } from "./owner";
import { fixtureName } from "./fixture-lane";

/** Reuse the selected-document owner. A new target replaces the shell through AdmittedPane's
 * effect cleanup/remount boundary, so old reads, Work and reviews retire together. */
function ApplicationRouteShell({ route, address, pane }: Omit<AdmittedPaneProps, "shell">) {
  const search = useSyncExternalStore(
    (notify) => address.subscribe(notify),
    () => address.read().toString(),
    () => address.read().toString(),
  );
  const params = new URLSearchParams(search);
  const fixture = fixtureName(Object.fromEntries(params));
  const selected = useRouteTarget(
    { needs: route.data.needs === "nothing" ? undefined : route.data.needs },
    appAtomRegistry,
    fixture !== null || route.data.needs === "nothing" ? {} : undefined,
    params.get("target"),
  );
  const resolved = selected.resolution.kind === "resolved" ? selected.resolution.target : null;
  const workOpen = resolved?.kind === "document" ? resolved.ref : selected.workOpen;
  const openKey = workOpen && JSON.stringify([workOpen.session, workOpen.openId]);
  const retained = useRef({ openKey, address: selected.workAddress });
  // Retain the Address only for this exact lifetime, never native execution authority.
  const workAddress =
    selected.workAddress ??
    (openKey && retained.current.openKey === openKey ? retained.current.address : null);
  useLayoutEffect(() => {
    retained.current = { openKey, address: workAddress };
  }, [openKey, workAddress]);
  const targetKey = JSON.stringify([resolved, workAddress, workOpen]);
  const shell = useMemo(
    () =>
      createRouteShell(sourceRouteServices(admittedSources(route), { target: () => resolved }), {
        workAddress,
        workOpen,
      }),
    [targetKey, route],
  );
  if (!resolved && !workAddress && !workOpen)
    return createElement(OutcomeLine, {
      kind: "error",
      label: "Choose a document",
      says: selected.resolution.kind,
    });
  return createElement(AdmittedPane, { shell, route, address, pane, writable: resolved !== null });
}

export { ApplicationRouteShell as applicationRouteShell };

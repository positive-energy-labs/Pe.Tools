import { createElement, useMemo, useSyncExternalStore } from "react";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { createRouteShell } from "./admitted-mount";
import { AdmittedPane, type AdmittedPaneProps } from "./admitted-pane";
import { sourceRouteServices } from "./source-route-services";
import { capturesSources } from "../captures/sources";
import { useRouteTarget } from "../route/route-target";
import { appAtomRegistry } from "./owner";
import { fixtureName } from "./fixture-lane";

// One application inventory. Domain sources own transport; routes only name admitted entries.
export const applicationSources = { ...capturesSources() };

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
  const target = selected.resolution.kind === "resolved" ? selected.resolution.target : null;
  const targetKey = JSON.stringify(target);
  const shell = useMemo(
    () => createRouteShell(sourceRouteServices(applicationSources, { target: () => target })),
    [targetKey],
  );
  if (!target)
    return createElement(OutcomeLine, {
      kind: "error",
      label: "Choose a document",
      says: selected.resolution.kind,
    });
  return createElement(AdmittedPane, { key: targetKey, shell, route, address, pane });
}

export { ApplicationRouteShell as applicationRouteShell };

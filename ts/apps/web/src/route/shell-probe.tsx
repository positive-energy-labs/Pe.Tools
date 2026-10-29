import { createRoute, useSearch } from "@tanstack/react-router";
import { Route as rootRoute } from "../routes/__root";
import { defineRoute } from "./manifest";
import { routeSearch } from "./route-owner";

export const shellProbe = {
  path: "/shell-probe",
  manifest: defineRoute({
    key: "shell-probe",
    name: "Shell probe",
    docs: "Deterministic spike for manifest and file-route coexistence.",
  }),
} as const;

export function routeFromManifest<const Path extends string>(spec: {
  path: Path;
  manifest: { key: string; name: string };
}) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path: spec.path,
    validateSearch: routeSearch,
    component: () => <ShellProbe name={spec.manifest.name} />,
  });
}

export function ShellProbe({ name = shellProbe.manifest.name }: { name?: string }) {
  const search = useSearch({ strict: false });
  return <output aria-label={name}>{JSON.stringify(search)}</output>;
}

export const ShellProbeRoute = routeFromManifest(shellProbe);

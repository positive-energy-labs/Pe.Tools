import { identityCodecs } from "@pe/agent-contracts";
import type {
  IdentityId,
  Many,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { openSet } from "../shell/open-set.neutral.ts";
export { localId, namesOf } from "../route/typed-route.ts";
import { localId } from "../route/typed-route.ts";
export const localSubject = (id: IdentityId<"local">) => identityCodecs.local.parts(id).subject;
export const activeName = (value: Many<IdentityId<"local">>, roster: readonly string[]) => {
  const id = openSet(
    (id: IdentityId<"local">) => id,
    roster.map((name) => localId("ducts-system", name)),
  ).active(value);
  return id ? localSubject(id) : "";
};
export type DuctsDestination = { kind: "route" } | { kind: "rule"; key: string };
export function ductsLink(
  ids: readonly string[],
  search: Readonly<Record<string, unknown>>,
  destination: DuctsDestination = { kind: "route" },
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  if (ids.length)
    params.set(
      "system",
      JSON.stringify({ kind: "ids", ids: ids.map((id) => localId("ducts-system", id)) }),
    );
  if (destination.kind === "rule")
    params.set(
      "selected",
      JSON.stringify([{ kind: "focus", id: localId("ducts-focus", `rule:${destination.key}`) }]),
    );
  return `/ducts?${params}`;
}

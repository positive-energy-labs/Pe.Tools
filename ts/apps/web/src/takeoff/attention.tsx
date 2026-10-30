import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { useMemo, type ReactNode } from "react";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { AttentionScope } from "#/attention";
import type { TakeoffsController } from "./controller";

// Like /rooms, zones and rooms carry Pe region GUIDs, not Revit UniqueIds.
export const regionKey = (guid: string): SubjectKey => `room:${guid}`;
export const regionTarget = (region: { guid: string; elementId: number | null }): SubjectKey =>
  region.elementId === null ? regionKey(region.guid) : elementKey(region.elementId);

export function TakeoffAttention({
  store,
  children,
}: {
  store: Pick<TakeoffsController, "handle" | "world" | "savedCapture">;
  children: ReactNode;
}) {
  const target = store.handle.resolution;
  const doc = store.savedCapture
    ? `capture:takeoffs:${store.savedCapture.id}`
    : !store.handle.demo && target.kind === "resolved" && target.target.kind === "document"
      ? `${target.target.ref.session}/${target.target.ref.openId}`
      : "fixture:takeoffs:plan";
  const selected = useMemo(
    () =>
      Atom.make((get): ReadonlySet<SubjectKey> => {
        const { zone, room } = get<{ page: { zone: string; room: string } }>(
          store.handle.pageState,
        ).page;
        return new Set([zone, room].filter(Boolean).map(regionKey));
      }),
    [store.handle.pageState],
  );
  const members = useMemo(() => {
    const regions = store.world.zones.flatMap((zone) => [zone.zone, ...zone.rooms]);
    // A region with no Revit room is its own leaf: declaring it as its own member would loop.
    return new Map(
      regions
        .filter((region) => region.elementId !== null)
        .map((region) => [regionKey(region.guid), [regionTarget(region)]]),
    );
  }, [store.world]);
  return (
    <RegistryContext value={store.handle.registry}>
      <AttentionScope doc={doc} selected={selected} members={members}>
        {children}
      </AttentionScope>
    </RegistryContext>
  );
}

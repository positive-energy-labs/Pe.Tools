/**
 * The Works the Chat head summarizes: every route Work keyed to the thread head's document. Each
 * is read by key (`useRouteWork`), the same Work atom the route's pane reads, and every exit opens
 * that route in the plugin pane.
 *
 * ponytail: only `families` keys its Work by the document itself. `family` keys by a captured
 * family's work id and `schedules` by a schedule workspace id, and no reading lists a document's
 * Works yet; each joins here when one does (a document → Work-keys listing is the upgrade path).
 */
import { useState } from "react";
import {
  familiesRouteState,
  instancesRouteState,
  takeoffDecisionAddress,
  takeoffEditAddress,
  takeoffsRouteState,
  type Address,
  type AppliedFilter,
  type RouteStatePatch,
  type InstancesLaunch,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";

import { filterWords } from "#/families/scope-band";
import { familiesGroupOf } from "#/families/staged";
import { INSTANCES_WORK } from "#/instances/manifest";
import { useRouteWork } from "#/route/use-route";
import type { ChatPluginRoute } from "#/workbench/chat-plugins";

import type { HeadWork } from "./proposal-head";

export interface HeadExits {
  open: (route: ChatPluginRoute, focus?: readonly string[]) => void;
  planIn: (route: ChatPluginRoute) => void;
}

/** The takeoffs cell families as the head groups them. */
const TAKEOFF_FAMILIES = [
  {
    segment: "edits",
    noun: "room edits",
    groupOf: (key: string) => [takeoffEditAddress(key).roomId],
  },
  { segment: "adopt", noun: "adoption", groupOf: (key: string) => [key.split(":")[0]!] },
  {
    segment: "decisions",
    noun: "flag verdicts",
    groupOf: (key: string) => [takeoffDecisionAddress(key).roomGuid],
  },
  {
    segment: "reviewFlags",
    noun: "review flags",
    groupOf: (key: string) => [(JSON.parse(key) as string[])[0]!],
  },
] as const;

const familiesShow = (value: unknown) =>
  typeof value === "object" && value !== null && "value" in value
    ? String((value as { value: unknown }).value)
    : String(value);

export function useHeadWorks(
  address: Address | null,
  subject: string,
  exits: HeadExits,
): HeadWork[] {
  const work = useRouteWork(
    familiesRouteState,
    address ? { route: "families", target: address } : null,
  );
  // The host-wide instances Work (a launch Pea may propose) belongs to no document: always read.
  const instances = useRouteWork(instancesRouteState, INSTANCES_WORK);
  // The document's takeoffs Work: its four cell families, each a head Work while it has pending.
  const takeoffs = useRouteWork(
    takeoffsRouteState,
    address ? { route: "takeoffs", target: address } : null,
  );
  // A refused bound write is a foreign write landing first: say it, and offer reload.
  const [conflict, setConflict] = useState(false);
  const launch: HeadWork[] = instances.doc
    ? [
        {
          id: "instances",
          route: instancesRouteState.title,
          subject: "Revit sessions",
          cells: { launch: instances.doc.launch as TrichotomyCellLike },
          // The launch cell sits at the Work's root.
          wire: { segment: null, revision: instances.revision, write: instances.write },
          groupOf: () => ["launch"],
          show: (value) => {
            const launch = value as InstancesLaunch;
            return launch.kind === "open" ? `open ${launch.document}` : `start ${launch.year}`;
          },
          stale: instances.stale,
          reload: instances.reload,
          commit: { word: "open", run: () => exits.open("instances") },
          open: (focus) => exits.open("instances", focus),
        },
      ]
    : [];
  const takeoffDoc = takeoffs.doc;
  const takeoffWorks: HeadWork[] = takeoffDoc
    ? TAKEOFF_FAMILIES.flatMap(({ segment, noun, groupOf }) => {
        const cells = takeoffDoc[segment] as Record<string, TrichotomyCellLike>;
        if (!Object.values(cells).some((cell) => cell.proposal != null || cell.staged != null))
          return [];
        return [
          {
            id: `takeoffs:${address}:${segment}`,
            route: takeoffsRouteState.title,
            subject: noun,
            cells,
            wire: {
              segment,
              revision: takeoffs.revision,
              write: async (patches, expectedRevision) => {
                // A room edit's staged rung needs its room's base, read from the world in the
                // route: the head counts edits but does not stage one whose room has no base.
                const unbased = patches.some(
                  (patch) =>
                    patch.path[0] === "edits" &&
                    patch.path[2] === "staged" &&
                    !takeoffDoc.bases[takeoffEditAddress(String(patch.path[1])).roomId],
                );
                if (unbased)
                  return {
                    code: "not-ready",
                    message:
                      "accept a room's first edit in Takeoffs, where the room's base is read",
                  };
                return takeoffs.write(patches, expectedRevision);
              },
            },
            groupOf,
            show: (value) => (typeof value === "string" ? value : JSON.stringify(value)),
            stale: takeoffs.stale,
            reload: takeoffs.reload,
            commit: { word: "open", run: () => exits.open("takeoffs") },
            open: (focus) => exits.open("takeoffs", focus),
          },
        ];
      })
    : [];
  if (!address || !work.doc) return [...launch, ...takeoffWorks];
  const wire = {
    revision: work.revision,
    write: async (patches: RouteStatePatch[], expectedRevision?: number) => {
      const refusal = await work.write(patches, expectedRevision);
      setConflict(refusal?.code === "stale-revision");
      return refusal;
    },
  };
  const exitsOf = {
    stale: work.stale,
    conflict,
    reload: () => {
      setConflict(false);
      work.reload();
    },
    commit: { word: "plan", run: () => exits.planIn("families") },
    open: (focus?: readonly string[]) => exits.open("families", focus),
  };
  return [
    ...launch,
    ...takeoffWorks,
    // The audited scope is a root cell Pea proposes (F-J1-10): its own group, beside the cells.
    {
      id: `families-scope:${address}`,
      route: familiesRouteState.title,
      subject,
      cells: { scope: work.doc.scope as TrichotomyCellLike },
      wire: { ...wire, segment: null },
      groupOf: () => ["scope"],
      show: (value) => filterWords(value as AppliedFilter),
      ...exitsOf,
      // The scope band heads the pane; a ["scope"] focus would match no type row.
      open: () => exits.open("families"),
    },
    {
      id: `families:${address}`,
      route: familiesRouteState.title,
      subject,
      cells: work.doc.cells as Record<string, TrichotomyCellLike>,
      wire: { ...wire, segment: "cells" },
      groupOf: familiesGroupOf,
      show: familiesShow,
      ...exitsOf,
    },
  ];
}

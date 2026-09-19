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
  type Address,
  type InstancesLaunch,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";

import { familiesGroupOf } from "#/families/staged";
import { INSTANCES_WORK } from "#/instances/manifest";
import { useRouteWork } from "#/route/use-route";
import type { ChatPluginRoute } from "#/workbench/chat-plugins";

import type { HeadWork } from "./proposal-head";

export interface HeadExits {
  open: (route: ChatPluginRoute, focus?: readonly string[]) => void;
  planIn: (route: ChatPluginRoute) => void;
}

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
  if (!address || !work.doc) return launch;
  return [
    ...launch,
    {
      id: `families:${address}`,
      route: familiesRouteState.title,
      subject,
      cells: work.doc.cells as Record<string, TrichotomyCellLike>,
      wire: {
        segment: "cells",
        revision: work.revision,
        write: async (patches, expectedRevision) => {
          const refusal = await work.write(patches, expectedRevision);
          setConflict(refusal?.code === "stale-revision");
          return refusal;
        },
      },
      groupOf: familiesGroupOf,
      show: familiesShow,
      stale: work.stale,
      conflict,
      reload: () => {
        setConflict(false);
        work.reload();
      },
      commit: { word: "plan", run: () => exits.planIn("families") },
      open: (focus) => exits.open("families", focus),
    },
  ];
}

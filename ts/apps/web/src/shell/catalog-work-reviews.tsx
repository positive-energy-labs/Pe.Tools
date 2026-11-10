import { useContext, useMemo } from "react";
import { z } from "zod";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { catalogWorkCommands, catalogWorks, refusalText, workKey, workHandleSchema } from "@pe/agent-contracts";
import { CatalogWorkReview, type CatalogWorkClient } from "../components/work/catalog-work";
import { peReadings } from "#/host/resource-stream";
import { browserWorkPorts } from "./work-feed-client";
import type { TypedMount } from "./typed-mount";
import { RouteVisibility } from "../route/activity";
import { consentThread } from "./situation-band";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { projectTimeline, type TimelineEntry } from "./timeline";
import { secondsLeft } from "@pe/kit/lang/consent-sweep";

const catalogSnapshot = z.object({ doc: z.unknown(), handle: workHandleSchema });
const catalogClient: CatalogWorkClient = {
  watch: (key, receive, fail) => peReadings.subscribe({ ...key, kind: "work" }, (frame) => {
    if (frame.kind === "failure") return fail(frame.error);
    if (frame.kind === "gap" || ("stale" in frame && frame.stale)) return fail("Read the current Work before editing");
    if (frame.kind !== "snapshot") return;
    const parsed = catalogSnapshot.safeParse(frame.value);
    if (parsed.success) receive(parsed.data);
    else fail("Work could not be read. Refresh this page to reconnect.");
  }),
  write: async (handle, patches, label) => {
    const result = await browserWorkPorts.write(handle.key, {
      kind: "apply", press: crypto.randomUUID(), expectedRevision: handle.revision,
      patches, label,
    });
    return result.ok ? null : { code: "refused", message: refusalText(result) };
  },
  submit: async (admission) => {
    const result = await browserWorkPorts.submit(admission);
    if (result.state === "detached") throw Error("Write transport detached; inspect History before retrying");
    return result;
  },
};

export function CatalogWorkReviews({ mount }: { mount: Pick<TypedMount,"work"|"workBasis"> & { timeline(): readonly TimelineEntry[]; page:{read():Readonly<Record<string,unknown>>}} }) {
  const visible = useContext(RouteVisibility);
  const key = mount.work()?.handle.key;
  const target = mount.workBasis()?.token.scope.identity.target;
  const identity = key ? workKey(key) : null;
  const owners = useMemo(() => key
    ? (Object.keys(catalogWorks) as (keyof typeof catalogWorks)[]).map((owner) => ({ owner, at: { ...key, route: owner } }))
    : [], [identity]);
  if (!visible || !key || target?.kind !== "document") return null;
  return <Popover>
    <PopoverTrigger aria-label="Open Work">Work</PopoverTrigger>
    <SubjectPopoverContent aria-label="Work" className="max-h-(--available-height) overflow-y-auto p-(--gutter)">
    {owners.map(({ owner, at }) => {
      const apply = Object.entries(catalogWorkCommands).find(([, command]) =>
        command.work.route === owner && command.writeBoundary.phase === "apply")![0];
      return <CatalogWorkReview key={owner} owner={owner} at={at} target={target.ref} client={catalogClient}
        reject={writeReject(mount.timeline(), [apply], (thread, requestId) =>
          void harnessClient(resolveWorkbenchConfig().origin).permission(thread, requestId, "stop_writes"),
          typeof mount.page.read().thread === "string" ? String(mount.page.read().thread) : undefined)} />;
    })}
    </SubjectPopoverContent>
  </Popover>;
}

/** The open Reject? window on this verb's receipt; the ActionJournal receipt is its only source. */
export function writeReject(
  entries: readonly TimelineEntry[],
  ids: readonly string[],
  reject: (thread: string, requestId: string) => void,
  boundThread?: string,
) {
  const open = projectTimeline(entries, {}).find((row) => {
    const key = (row.entry.basis as { receipt?: { key?: string } } | undefined)?.receipt?.key;
    return row.kind === "consent" && ids.includes(key ?? row.entry.verb ?? "");
  });
  if (!open) return null;
  const thread = consentThread(open.entry, boundThread);
  if (!thread) return null;
  const requestId = open.outcome!.consentWindow!.requestId;
  return {
    until: open.consentUntil ? `${secondsLeft(open.consentUntil)}s` : "awaiting approval",
    run: () => reject(thread, requestId),
  };
}

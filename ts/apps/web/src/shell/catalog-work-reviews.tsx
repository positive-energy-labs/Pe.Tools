import { useContext, useMemo } from "react";
import { z } from "zod";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { catalogWorks, refusalText, workKey, workHandleSchema } from "@pe/agent-contracts";
import { CatalogWorkReview, type CatalogWorkClient } from "../components/work/catalog-work";
import { peReadings } from "#/host/resource-stream";
import { browserWorkPorts } from "./work-feed-client";
import type { TypedMount } from "./typed-mount";
import { RouteVisibility } from "@pe/web-kernel/route/activity";

const catalogSnapshot = z.object({ doc: z.unknown(), handle: workHandleSchema });
const catalogClient: CatalogWorkClient = {
  watch: (key, receive, fail) =>
    peReadings.subscribe({ ...key, kind: "work" }, (frame) => {
      if (frame.kind === "failure") return fail(frame.error);
      if (frame.kind === "gap" || ("stale" in frame && frame.stale))
        return fail("Read the current Work before editing");
      if (frame.kind !== "snapshot") return;
      const parsed = catalogSnapshot.safeParse(frame.value);
      if (parsed.success) receive(parsed.data);
      else fail("Work could not be read. Refresh this page to reconnect.");
    }),
  write: async (handle, patches, label) => {
    const result = await browserWorkPorts.write(handle.key, {
      kind: "apply",
      press: crypto.randomUUID(),
      expectedRevision: handle.revision,
      patches,
      label,
    });
    return result.ok ? null : { code: "refused", message: refusalText(result) };
  },
  submit: async (admission) => {
    const result = await browserWorkPorts.submit(admission);
    if (result.state === "answered") throw Error("A Work review requires a journaled command");
    if (result.state === "detached")
      throw Error("Write transport detached; inspect History before retrying");
    return result;
  },
};

export function CatalogWorkReviews({ mount }: { mount: Pick<TypedMount, "work" | "workBasis"> }) {
  const visible = useContext(RouteVisibility);
  const key = mount.work()?.handle.key;
  const target = mount.workBasis()?.token.scope.identity.target;
  const identity = key ? workKey(key) : null;
  const owners = useMemo(
    () =>
      key
        ? (Object.keys(catalogWorks) as (keyof typeof catalogWorks)[]).map((owner) => ({
            owner,
            at: { ...key, route: owner },
          }))
        : [],
    [identity],
  );
  if (!visible || !key || target?.kind !== "document") return null;
  return (
    <Popover>
      <PopoverTrigger aria-label="Open Work">Work</PopoverTrigger>
      <SubjectPopoverContent
        aria-label="Work"
        className="max-h-(--available-height) overflow-y-auto p-(--gutter)"
      >
        {owners.map(({ owner, at }) => {
          return (
            <CatalogWorkReview
              key={owner}
              owner={owner}
              at={at}
              target={target.ref}
              client={catalogClient}
            />
          );
        })}
      </SubjectPopoverContent>
    </Popover>
  );
}

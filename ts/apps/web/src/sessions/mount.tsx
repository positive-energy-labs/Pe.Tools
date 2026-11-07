import { useOpenTypedOwner } from "../open/typed-owner";
import { type Machine } from "@pe/agent-contracts";

import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { Button } from "@pe/kit/lang/button";
import { OpenOwnerContext, useOpenOwner } from "../open/context";
import { keyOf } from "#/machine/session";
import { lifecycleRequest } from "../open/lifecycle";
import { readingList } from "#/host/resource-list";
import type { ReadingState } from "#/shell/source-contract";
function Sessions({
  selectedKey,
  choose,
}: { selectedKey?: string; choose?(key: string): void } = {}) {
  const owner = useOpenOwner();
  const page = owner.view.read().page;
  const session = selectedKey ?? page.draft.target ?? "";
  const reading = owner.readings.get("machine") as ReadingState<Machine>;
  const machine = reading.value ?? reading.previous;
  const sessions = readingList(reading, (value) => value.revit.sessions ?? []);
  const leg = machine?.legs.sessions;
  if (leg?.error) {
    sessions.status = "failed";
    sessions.failure = leg.error;
  } else if (machine?.revit.sessions === null || !leg?.observedAtUtc) {
    sessions.status = "pending";
  }
  const rows = sessions.items;
  const list = useList({
    ...sessions,
    keyOf,
    followSelection: { key: session || null },
    search: (row) => ({ text: [keyOf(row), String(row.row.year)] }),
    select: "single",
    onPick: (row) =>
      choose
        ? choose(keyOf(row))
        : owner.view.setPage({ draft: { ...page.draft, target: keyOf(row) } }),
  });
  const selected = rows.find((row) => keyOf(row) === session);
  return (
    <>
      <a
        href={`/open?draft=${encodeURIComponent(JSON.stringify({ ...page.draft, target: session }))}`}
      >
        Open a document in this session
      </a>
      <ListView
        list={list}
        aria-label="Sessions"
        row={(row) => ({
          label: keyOf(row),
          sub: `Revit ${row.row.year}`,
          active: keyOf(row) === session,
        })}
        empty={{ message: sessions.failure ?? "No running sessions", exit: "Start Revit" }}
      />
      {selected && (
        <section aria-label="Session detail">
          <p>
            {keyOf(selected)} Ã‚Â· Revit {selected.row.year}
          </p>
          {["stop", "restart"].map((id) => {
            let request: unknown;
            let refusal: string | null = null;
            try {
              request = lifecycleRequest(
                id === "stop" ? "stop" : "restart",
                selected,
                "keep",
              ).input;
            } catch (error) {
              refusal = String(error);
            }
            return (
              <Button
                key={id}
                label={id}
                refusal={refusal}
                onClick={() => void owner.control(id, { request, refusal }).run()}
              >
                {id}
              </Button>
            );
          })}
        </section>
      )}
      {(machine?.revit.years ?? []).map((year) => (
        <div key={year}>
          <Button
            label={`Start Revit ${year}`}
            onClick={() =>
              void owner
                .control("start", {
                  request: { year: String(year), owner: "you", addins: "on" },
                  refusal: null,
                })
                .run()
            }
          >
            Start Revit {year}
          </Button>
        </div>
      ))}
    </>
  );
}

export function SessionsBody({ ctx }: { ctx: import("./route").SessionContext }) {
  const owner = useOpenTypedOwner(ctx, sessionActions);
  return (
    <OpenOwnerContext value={owner}>
      <Sessions
        selectedKey={ctx.page.read().session}
        choose={(session) => ctx.page.pose({ session })}
      />
    </OpenOwnerContext>
  );
}
const sessionActions = ["start", "stop", "restart"];

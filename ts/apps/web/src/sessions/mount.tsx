import { useOpenTypedOwner } from "../open/typed-owner";
import { type Machine } from "@pe/agent-contracts";

import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import { Button } from "@pe/kit/lang/button";
import { OpenOwnerContext, useOpenOwner } from "../open/context";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { keyOf, phaseOf } from "#/machine/session";
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
        // The Start verbs sit in the list's own bar, on its edge, not as loose rows below (L3).
        header={
          machine?.revit.years?.length ? (
            <ButtonGroup label="Start Revit">
              {machine.revit.years.map((year) => (
                <Button
                  key={year}
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
              ))}
            </ButtonGroup>
          ) : undefined
        }
        // I1: a row is named by its Revit and state; the session key is a mono fact, never the name.
        row={(row) => ({
          label: `${row.whose === "pea" ? "Pea's " : ""}Revit ${row.row.year}`,
          sub: phaseOf(row.row),
          meta: <span className="face-mono">{keyOf(row)}</span>,
          active: keyOf(row) === session,
        })}
        empty={{ message: sessions.failure ?? "No running sessions", exit: "Start Revit" }}
      />
      {selected && (
        <section aria-label="Session detail">
          <p>
            {keyOf(selected)} · Revit {selected.row.year}
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

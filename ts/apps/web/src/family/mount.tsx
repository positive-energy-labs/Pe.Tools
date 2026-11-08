import { settingsCandidate, familyDraftSchema } from "@pe/agent-contracts";
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { isSpecOf } from "../route/workflow";
import { FAMILY_MODEL_SCHEMA } from "./page";
import { FamilyProvider } from "./workspace";
import { FamilyWorkspaceAnatomy } from "./workspace-anatomy";
import { FamilyWorkspaceTable } from "./workspace-table";
import { FamilyWorkspaceDocPane } from "./workspace-doc-pane";
import { useFamilyWorkspace } from "./workspace-context";
import type { FamilyContext } from "./route";
export function FamilyBody({ ctx }: { ctx: FamilyContext }) {
  return (
    <FamilyProvider ctx={ctx}>
      <Workspace ctx={ctx} />
    </FamilyProvider>
  );
}
function Workspace({ ctx }: { ctx: FamilyContext }) {
  const { store } = useFamilyWorkspace(),
    data = ctx.value.value,
    page = ctx.page.read();
  const [failure, setFailure] = useState<string | null>(null),
    [source, setSource] = useState("");
  const [destination, setDestination] = useState<{ pod: string; text: string } | null>(null);
  const list = useList({
    value: ctx.value,
    rowsOf: (data) =>
      data.pods.flatMap((pod) =>
        pod.members
          .filter((member) => isSpecOf(member.schema ?? null, FAMILY_MODEL_SCHEMA))
          .map((member) => ({ ...member, pod: pod.id, podName: pod.name })),
      ),
    keyOf: (row) => `${row.pod}/${row.path}`,
    search: (row) => ({ text: [row.podName, row.path] }),
    select: "single",
    onPick: (row) => ctx.page.query({ pod: row.pod, path: row.path }),
  });
  const run = async (id: string, input: unknown) => {
    try {
      await ctx.write(id).run(input);
      setFailure(null);
    } catch (error) {
      setFailure(String(error));
    }
  };
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-(--gutter) min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-(--gutter)">
        {!ctx.value.current && (
          <OutcomeLine
            kind={ctx.value.status === "pending" ? "busy" : "error"}
            label="Family reading"
            says={ctx.value.reason}
          />
        )}
        {data?.profileError && (
          <OutcomeLine
            kind="error"
            label="Saved family profile"
            says={`${data.profileError}. Choose another member or Refresh.`}
          />
        )}
        {store.lane.parseError && (
          <OutcomeLine kind="error" label="Family model" says={store.lane.parseError} />
        )}
        {store.editFailure && (
          <OutcomeLine kind="refused" label="Family edit" says={store.editFailure.message} />
        )}
        {failure && <OutcomeLine kind="refused" label="Family action" says={failure} />}
        <div className="flex flex-wrap gap-2">
          <label>
            Destination pod
            <Input
              aria-label="Destination pod"
              value={destination?.pod === page.pod ? destination.text : data?.pods.find((pod) => pod.id === page.pod)?.name ?? ""}
              onChange={(event) => {
                const text = event.target.value;
                const pod = data?.pods.find((pod) => pod.name === text)?.id ?? text;
                setDestination({ pod, text });
                ctx.page.query({ pod, path: "" });
              }}
            />
          </label>
          <Button
            label="Stage family save"
            refusal={!page.pod ? "Choose a destination pod" : ctx.cells.refusal}
            onClick={() =>
              void ctx.cells.patch(
                [
                  {
                    path: ["writeIntent", "family.capture"],
                    value: {
                      edit: {
                        value: {
                          pod: page.pod,
                          ...(data?.familyWork.reading
                            ? {
                                spec: settingsCandidate(
                                  data.familyWork.reading,
                                  familyDraftSchema.parse(data.familyWork).cells,
                                ),
                              }
                            : {}),
                        },
                      },
                    },
                  },
                ],
                { label: "Choose family save destination" },
              )
            }
          >
            Stage save to pod
          </Button>
          <Button label="Inspect current family draft" onClick={() => ctx.page.query({ path: "" })}>
            Current draft
          </Button>
        </div>
        <FamilyWorkspaceAnatomy />
        <FamilyWorkspaceTable />
        <ListView
          list={list}
          aria-label="Family members"
          empty={{ message: "No saved family members", exit: "Save a family into a pod" }}
          row={(row) => ({
            label: row.path,
            sub: row.podName,
            active: page.pod === row.pod && page.path === row.path,
            actions: (
              <Button
                label={`Open ${row.path}`}
                onClick={() =>
                  void run("open", { source: { pod: row.pod, path: row.path, sha256: row.sha256 } })
                }
              >
                Open member
              </Button>
            ),
          })}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-(--gutter)">
        {data?.specError && (
          <OutcomeLine kind="error" label="Saved PDF evidence" says={data.specError} />
        )}
        <label>
          PDF path or URL
          <Input
            aria-label="PDF path or URL"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <Button
          label="Attach PDF path or URL"
          refusal={
            !page.pod || !page.path
              ? "Choose a saved member"
              : !source
                ? "Enter a PDF path or URL"
                : null
          }
          onClick={() =>
            void run("attach", {
              member: { pod: page.pod, path: page.path },
              source: /^https?:/.test(source) ? { url: source } : { path: source },
            })
          }
        >
          Attach PDF
        </Button>
        {data?.profile && (
          <Button
            label="Stage family build"
            refusal={ctx.cells.refusal}
            onClick={() =>
              void ctx.cells.patch(
                [
                  {
                    path: ["writeIntent", "family.build"],
                    value: {
                      edit: {
                        value: {
                          source: { ...data.profile!.member, sha256: data.profile!.sha256 },
                        },
                      },
                    },
                  },
                ],
                { label: "Choose saved family build source" },
              )
            }
          >
            Stage saved member for Build
          </Button>
        )}
        <FamilyWorkspaceDocPane />
      </div>
    </div>
  );
}

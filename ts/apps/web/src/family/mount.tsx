import { settingsCandidate, familyDraftSchema } from "@pe/agent-contracts";
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { FamilyProvider } from "./workspace";
import { FamilyWorkspaceAnatomy } from "./workspace-anatomy";
import { FamilyWorkspaceTable } from "./workspace-table";
import { FamilyWorkspaceDocPane } from "./workspace-doc-pane";
import { useFamilyWorkspace } from "./workspace-context";
import { useAdmittedSubject } from "#/shell/subject";
import { member, type FamilyContext } from "./route";
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
    page = ctx.page.read(),
    subject = useAdmittedSubject(),
    open = member(page),
    // A save lands in the chosen Pod, else beside the open member.
    pod = page.pod || open?.pod || "";
  const [failure, setFailure] = useState<string | null>(null),
    [source, setSource] = useState("");
  const [destination, setDestination] = useState<{ pod: string; text: string } | null>(null);
  const run = async (id: string, input: unknown) => {
    try {
      await ctx.write(id).run(input);
      setFailure(null);
    } catch (error) {
      setFailure(String(error));
    }
  };
  return (
    // The split follows the route's own width, not the viewport: docked at 1600px the route is
    // ~690px, and a viewport breakpoint squeezed the drawing beside a 20rem PDF column (L3).
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-(--gutter) @min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-(--gutter)">
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
                value={
                  destination?.pod === pod
                    ? destination.text
                    : (data?.pods.find((item) => item.id === pod)?.name ?? "")
                }
                onChange={(event) => {
                  const text = event.target.value;
                  const next = data?.pods.find((item) => item.name === text)?.id ?? text;
                  setDestination({ pod: next, text });
                  // A save stages the Work's own draft, so choosing where it lands closes the saved family in view.
                  subject?.clear();
                  ctx.page.query({ pod: next });
                }}
              />
            </label>
            <Button
              label="Stage family save"
              refusal={!pod ? "Choose a destination pod" : ctx.cells.refusal}
              onClick={() =>
                void ctx.cells.patch(
                  [
                    {
                      path: ["writeIntent", "family.capture"],
                      value: {
                        edit: {
                          value: {
                            pod,
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
            <Button
              label="Inspect current family draft"
              onClick={() => subject?.clear()}
            >
              Current draft
            </Button>
          </div>
          <FamilyWorkspaceAnatomy />
          <FamilyWorkspaceTable />
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
              !open
                ? "Choose a saved family"
                : !source
                  ? "Enter a PDF path or URL"
                  : null
            }
            onClick={() =>
              void run("attach", {
                member: open,
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
    </div>
  );
}

import { memberOfKey } from "#/host/familyfoundry";
import { Code, stringify } from "#/components/lang/code";
import { PaneSplit } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { RouteShell } from "#/route";
import { Picker } from "#/route/picker";
import { Situation, SituationCell, useDocumentLadder } from "#/route/situation";
import { manifest } from "#/family/manifest";
import { FamilyWorkspaceAnatomy } from "#/family/workspace-anatomy";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { FamilyWorkspaceTable } from "#/family/workspace-table";
import { useFamilyWorkspace } from "#/family/workspace-context";
import { buildReceiptSummary } from "#/family/build";

const noun = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Family Situation. Stage word first (Authoring / Reconciling), then the one slot this route
 * owns: the authored family.json, a picker over the files the family host lists. The document is
 * the chain lamp's; the verbs come from the manifest, scoped by stage.
 */
function FamilyHead() {
  const { store, lane, snapshot, draft, unsavedCount, validation, validationSays } =
    useFamilyWorkspace();
  const ladder = useDocumentLadder(store.handle);
  const document = <Picker levels={ladder.levels} disabled={store.handle.busy !== null} />;
  const evidence = store.evidence;
  const sharedEdit = store.sharedEdit;
  const file = lane.document?.relativePath ?? store.profile;
  const staged = store.buildFacts.stagedCount;
  const revision = store.review.revision;
  const fileSlot = (
    <SituationCell io={store.routeStage === "author" ? "rw" : "r"} empty={!file}>
      <Picker
        caution={lane.parseError != null}
        title={file ? `${file}; pick to open another authored family` : "choose an authored family"}
        levels={[
          {
            key: "file",
            label: file || null,
            placeholder: "choose a family file",
            options: store.feeds.profile.options,
            note:
              store.feeds.profile.state === "error"
                ? "the family host did not list its files"
                : "reading the family files…",
            picked: (id) => memberOfKey(id).path === file,
            pick: (id) => void store.actions.open(memberOfKey(id)).catch(() => undefined),
          },
        ]}
      />
    </SituationCell>
  );
  const sentence =
    store.routeStage === "author" ? (
      <>
        {fileSlot} with {document}.
      </>
    ) : (
      <>
        {fileSlot} against {document}.
      </>
    );
  const coverage =
    evidence && "modelJson" in evidence
      ? `${Object.entries(evidence.coverage)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" / ")} / ${evidence.unmodeledCount} unmodeled`
      : "not captured";
  return (
    <Situation
      handle={store.handle}
      target={{ session: ladder.sessionWord, document: ladder.docWord }}
      sentence={sentence}
      commit="apply"
      band={
        draft.dirty || staged ? (
          <div className="hairline-t hairline-b flex items-baseline justify-between gap-6 py-2 t-prose">
            <span>
              {draft.dirty ? <b>{noun(unsavedCount, "unsaved edit")}</b> : null}
              {draft.dirty && staged ? " · " : null}
              {staged ? <b>{noun(staged, "staged field")}</b> : null}
              {revision !== null ? (
                <span className="face-mono text-ink-mute"> r{revision}</span>
              ) : null}
            </span>
          </div>
        ) : null
      }
      ledger={[
        [
          "file",
          lane.parseError != null
            ? `${file} · will not parse: ${lane.parseError}`
            : validation
              ? validation.isValid
                ? `${file} · JSON parses (a local JSON.parse, not host schema validation)`
                : `${file} · ${noun(validation.issues.length, "parse issue")}: ${validationSays}`
              : file || "none",
        ],
        ["coverage", coverage],
        ...(store.buildReceipt
          ? [["build", buildReceiptSummary(store.buildReceipt)] as const]
          : []),
        ...(evidence && "modelJson" in evidence
          ? [
              [
                "capture",
                <details key="capture">
                  <summary className="cursor-pointer">native capture</summary>
                  <Code
                    code={`${stringify(evidence.coverage)}\n${evidence.modelJson}`}
                    lang="json"
                    title="native capture"
                  />
                </details>,
              ] as const,
            ]
          : []),
        ...(snapshot
          ? [
              [
                "basis",
                // Work's adopted rawContent, shown exactly as stored. composedContent is set
                // equal to rawContent by settingsWorkSnapshot, so a second pane would repeat
                // this string under a name that claims a composition nobody performed.
                <details key="basis">
                  <summary className="cursor-pointer">raw text</summary>
                  <Code code={snapshot.rawContent} lang="json" title="raw text" />
                </details>,
              ] as const,
            ]
          : []),
        ...(sharedEdit
          ? [
              [
                "shared",
                `${sharedEdit.pointer} · no local edit was staged; open the referenced source below`,
              ] as const,
            ]
          : []),
        ...(snapshot?.dependencies ?? []).map(
          (dependency) =>
            [
              "depends",
              <a
                key={`${dependency.id}:${dependency.path}`}
                href={`/pods?${new URLSearchParams({ pod: dependency.id, path: dependency.path })}`}
                title="Edit the shared source JSON in its pod. Changes affect every member that includes it."
              >
                {sharedEdit?.directives.some((directive) => directive.endsWith(dependency.path))
                  ? "open referenced source "
                  : "edit shared "}
                @{dependency.id}/{dependency.path}
              </a>,
            ] as const,
        ),
      ]}
    />
  );
}

export function FamilyWorkspaceView() {
  const { store, anatomyCollapsed, setAnatomyCollapsed } = useFamilyWorkspace();
  return (
    <Surface
      head={<RouteShell manifest={manifest} handle={store.handle} situation={<FamilyHead />} />}
    >
      <PaneSplit
        axis="horizontal"
        grow
        resize={{ target: "end", defaultSize: 340, minSize: 260, minOtherSize: 560 }}
        start={
          <PaneSplit
            axis="vertical"
            grow
            resize={{
              target: "start",
              defaultSize: 220,
              minSize: 34,
              collapse: {
                collapsed: anatomyCollapsed,
                onCollapsedChange: setAnatomyCollapsed,
                collapsedSize: 34,
                collapseBelow: 90,
              },
            }}
            start={<FamilyWorkspaceAnatomy />}
            end={<FamilyWorkspaceTable />}
          />
        }
        end={<FamilyWorkspaceDocPane />}
      />
    </Surface>
  );
}

import { JsonView } from "#/settings-panes/json-editor";
import { Workspace } from "#/components/anatomy";
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
            picked: (id) => id === file,
            pick: (id) => void store.actions.open(id).catch(() => undefined),
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
                  <pre className="max-h-64 max-w-2xl overflow-auto">
                    {JSON.stringify(evidence.coverage, null, 2)}
                    {"\n"}
                    {evidence.modelJson}
                  </pre>
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
                  <div className="max-h-64 max-w-2xl overflow-auto">
                    <JsonView code={snapshot.rawContent} />
                  </div>
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
                key={dependency.directivePath}
                href="/settings"
                title="Edit the shared source JSON. Changes affect every profile that includes it."
                onClick={(event) => {
                  event.preventDefault();
                  void store.actions
                    .openShared(dependency.documentId)
                    .then(() => {
                      const url = new URL(window.location.href);
                      url.pathname = "/settings";
                      url.searchParams.delete("family");
                      window.location.assign(url.href);
                    })
                    .catch((error: unknown) =>
                      store.actions.say(error instanceof Error ? error.message : String(error)),
                    );
                }}
              >
                {sharedEdit?.directives.includes(dependency.directivePath)
                  ? "open referenced source "
                  : "edit shared "}
                {dependency.directivePath}
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
    <Workspace
      className="[&_[data-slot=pane-header]_h2]:text-ink [&_[data-kind=content]_[data-slot=pane-header]]:boundary-t [&_[data-kind=inspector]_[data-slot=pane-body]]:p-0"
      headRail={<RouteShell manifest={manifest} handle={store.handle} situation={<FamilyHead />} />}
      visual={<FamilyWorkspaceAnatomy />}
      table={<FamilyWorkspaceTable />}
      sidePanel={<FamilyWorkspaceDocPane />}
      pane={{
        inspectorSpan: "full",
        resize: {
          visual: {
            defaultSize: 220,
            minSize: 34,
            collapse: {
              collapsed: anatomyCollapsed,
              onCollapsedChange: setAnatomyCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          },
          inspector: { defaultSize: 340, minSize: 260, minOtherSize: 560 },
        },
      }}
    />
  );
}

import { EmptyState } from "#/components/lang/empty";
import { FactChip, Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { Verb } from "#/components/lang/verb";
import { Pane } from "#/components/lang/pane";
import { SpecSheet, SpecText, ProposalCard } from "#/family/doc-pane";
import { NavStateCell } from "#/family/marks";
import { bindingOf, isFormula, type PageWorld } from "#/family/model";
import { boundParam, type GeomConstituent } from "#/family/world";
import { useFamilyWorkspace } from "#/family/workspace-context";
import { FamilyMetaControl } from "#/family/workspace-meta-control";
import { PressContent } from "#/components/anatomy/press-content";

export function FamilyWorkspaceDocPane() {
  const {
    world,
    draft,
    saved,
    docMode,
    setDocMode,
    docZoom,
    setDocZoom,
    setFocus,
    focusedProposal,
    setFocusedProposal,
    pinnedParam,
    setPinnedParam,
    inspect,
    setInspect,
    cardRefs,
    verdictOf,
    proposalsAt,
    openProposals,
    rows,
    consumers,
    say,
    accept,
    deny,
    editAuthored,
    editLiteral,
    litBlocks,
    bindPicker,
  } = useFamilyWorkspace();
  const partInspector = (part: GeomConstituent): React.ReactNode => (
    <>
      <p
        className="face-mono t-caption mb-1.5 text-ink-2"
        title={`${part.slug} is a ${part.kind}. The kind is READ-ONLY here: a prism does not become a cylinder because a word changed, and the profile's job is to say what the geometry is, not to pretend it can be retyped.`}
      >
        {part.kind} · {part.dims.length} bindable · {part.meta.length} non-bindable
      </p>

      <div className="hairline-t mb-2 pt-1.5">
        <p className="face-mono t-label t-upper mb-0.5 flex items-center gap-1 text-ink-2">
          bindable dims — represented in the table
          <HelpTip>
            The constituent&rsquo;s bindable numbers, shown here as a STATEMENT OF WHERE EACH ONE
            LIVES rather than as a second place to work. A bound dim names the parameter that
            represents it in the table; an unbound one carries its literal and the very same bind
            verb its ghost row carries.
          </HelpTip>
        </p>
        {part.dims.map((dim) => {
          const bound = boundParam(bindingOf(world, draft, part.slug, dim.property));
          return (
            <div key={dim.property} className="flex items-center gap-2 py-0.5">
              <span className="face-mono t-caption w-24 shrink-0 text-ink-2" title={dim.note}>
                {dim.property}
              </span>
              {bound != null ? (
                <Press
                  type="button"
                  onClick={() => {
                    setInspect({ kind: "param", name: bound });
                    setPinnedParam(bound);
                  }}
                  title={`Driven by "${bound}", currently ${draft.authored[bound] ?? "—"}. Click to select that parameter: the value is edited on its row and in its own inspector, never in two places.`}
                  tone="nav"
                  size="caption"
                >
                  {bound}
                </Press>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    {/* The SAME editable cell as the ghost row it mirrors — one grammar, and the
                        refusal (an emptied literal) is the cell's own note in both places. */}
                    <NavStateCell
                      value={bindingOf(world, draft, part.slug, dim.property)}
                      note={`UNBOUND — the literal frozen into ${part.slug}. Editable, exactly as it is on its ghost row at the bottom of the table; editing it changes the number, not who can reach it.`}
                      onCommit={(next) => editLiteral(part.slug, dim.property, next)}
                    />
                  </span>
                  {bindPicker(part.slug, dim.property, dim.dataType)}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="hairline-t pt-1.5">
        <p
          className="face-mono t-label t-upper mb-0.5 text-ink-2"
          title="The half of the constituent no parameter can drive. It has no column in the table because it does not vary by type and it is not a number — and this is the ONLY place it appears, which is exactly the claim: it lives somewhere else."
        >
          non-bindable metadata — lives only here
        </p>
        {part.meta.map((meta) => (
          <div key={meta.key} className="flex items-baseline gap-2 py-0.5">
            <span className="face-mono t-caption w-24 shrink-0 text-ink-2" title={meta.note}>
              {meta.label}
            </span>
            <span className="min-w-0 flex-1">
              <FamilyMetaControl slug={part.slug} meta={meta} />
            </span>
          </div>
        ))}
      </div>
    </>
  );

  const paramInspector = (name: string): React.ReactNode => {
    const row = rows.find((entry) => entry.name === name && entry.kind === "profile");
    const authored = draft.authored[name] ?? "";
    const drives = consumers.get(name) ?? [];
    const blocks = world.grounding[name] ?? [];
    const family = proposalsAt(name, null);
    return (
      <>
        <p className="face-mono t-caption mb-1.5 text-ink-2">
          {row?.dataType ?? "unknown"} · bound per {row?.isInstance ? "instance" : "type"}
          {row?.group ? ` · ${row.group}` : ""}
          {world.missingInRevit.has(name) && <span className="ml-1">⊘ not in Revit</span>}
        </p>

        <div className="hairline-t mb-2 pt-1.5">
          <p className="face-mono t-label t-upper mb-0.5 flex items-center gap-1 text-ink-2">
            family value {isFormula(authored) ? "· formula" : ""}
            <HelpTip>
              THE FAMILY-LEVEL VALUE — what every type inherits unless it overrides. The table shows
              it only as the grey placeholder in each type cell, and a placeholder is not an editor;
              this is where it is actually authored. Type an expression beginning with = to make it
              a formula instead, which locks every type column on the row.
            </HelpTip>
          </p>
          {/* THE FAMILY-LEVEL VALUE CELL, on the editable `StateCell` (R8, families #6): pea's
              open family-level proposal takes the body (fold + wash), your unwritten edit takes
              the staged square + bold, and a refused empty commit is the cell's own restore +
              caution note — the route's refusal paragraph this replaced is deleted. */}
          <NavStateCell
            value={authored}
            stage={
              family.length > 0
                ? "proposed"
                : (saved.authored[name] ?? null) !== authored
                  ? "staged"
                  : "clean"
            }
            stagedBy={family.length > 0 ? "pea" : "you"}
            note={
              isFormula(authored)
                ? `A FORMULA — ${authored}. Its result is derived, so no type may override it and Revit's number for it is an output rather than a competing value. Edit the expression here; change what feeds it to change the result.`
                : `The value every type inherits unless it authors its own. Editing it moves all ${world.typeNames.filter((typeName) => draft.types[typeName]?.[name] === undefined).length} inheriting type${world.typeNames.filter((typeName) => draft.types[typeName]?.[name] === undefined).length === 1 ? "" : "s"} at once — watch the grey placeholders in the table change. Begin with = to make it a formula.`
            }
            onCommit={(next) => editAuthored(name, next)}
          />
          {family.length > 0 && (
            <p className="face-mono t-caption mt-1" data-tone="pea">
              pea proposes {family[0]!.proposed} here — the card is above; typing your own value
              severs it instead.
            </p>
          )}
        </div>

        <div className="hairline-t mb-2 pt-1.5">
          <p
            className="face-mono t-label t-upper mb-0.5 text-ink-2"
            title="Every geometry property this parameter drives. These have no rows of their own — this parameter IS their row — so editing the value above moves all of them together. That fan-out is the thing worth knowing before you type."
          >
            drives {drives.length} geometry propert{drives.length === 1 ? "y" : "ies"}
          </p>
          {drives.length === 0 ? (
            <EmptyState story="scope" exit="bind a ghost row to this parameter to fill this list">
              drives nothing — fine for schedule data, suspicious for a Length
            </EmptyState>
          ) : (
            drives.map((entry) => (
              <Press
                key={`${entry.slug}.${entry.property}`}
                type="button"
                onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                title={`Open ${entry.slug} — its kind, its other dims, and the non-bindable metadata no parameter can drive.`}
                tone="nav"
                size="caption"
              >
                <PressContent geometry="block">
                  → {entry.slug}.{entry.property}
                </PressContent>
              </Press>
            ))
          )}
        </div>

        <div className="hairline-t pt-1.5">
          <p
            className="face-mono t-label t-upper mb-0.5 text-ink-2"
            title="Where this number came from. Grounding is its own fact, independent of any proposal — accepting or denying pea's reading never erases the citation."
          >
            grounding
          </p>
          {blocks.length === 0 ? (
            <EmptyState
              story="scope"
              exit={`parse a document that claims this number, or cite a block of ${world.spec?.fileName ?? "the spec"}`}
            >
              ungrounded — asserted, not sourced
            </EmptyState>
          ) : (
            blocks.map((id) => (
              <p
                key={id}
                className="hairline-l face-mono t-caption py-0.5 pl-1.5 text-ink-2"
                title={`Block ${id} of ${world.spec?.fileName ?? "the spec"}, verbatim. If it does not say what the value says, the value is wrong.`}
              >
                <span>{id} · </span>
                {world.spec?.blocks.find((block) => block.id === id)?.md ?? "(block not found)"}
              </p>
            ))
          )}
        </div>
      </>
    );
  };

  const inspectorPanel =
    inspect == null ? null : (
      <div className="boundary-t flex max-h-[52%] min-h-0 shrink-0 flex-col">
        <div className="hairline-b flex h-7 shrink-0 items-center gap-2 px-2" data-surface="recess">
          {/* A machine tag naming the inspected object's kind — the lang tag voice. */}
          <span>
            <Tag>{inspect.kind === "part" ? "constituent" : "parameter"}</Tag>
          </span>
          <span className="face-mono t-label min-w-0 flex-1 truncate text-ink">
            {inspect.kind === "part" ? inspect.slug : inspect.name}
          </span>
          <Verb
            label="esc"
            tone="nav"
            direction="back"
            onClick={() => setInspect(null)}
            reason="Close the inspector and give the pane back to the spec. Esc does the same. Nothing is decided by closing — every edit here landed the moment you made it."
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {inspect.kind === "part"
            ? (world.geomBySlug.get(inspect.slug) ?? null) == null
              ? partProseOnly(world, inspect.slug)
              : partInspector(world.geomBySlug.get(inspect.slug)!)
            : paramInspector(inspect.name)}
        </div>
      </div>
    );

  // ── the doc pane: ONE sidebar, two modes, proposals docked on top ──────────────────────────────

  const docPane = (
    <Pane
      kind="inspector"
      headerSurface="artifact"
      // The pane is a COLUMN: the spec and its proposals scroll in the upper half, the inspector
      // docks under them. Neither displaces the other — an inspector that replaced the spec would
      // take away the evidence at the exact moment you edit the number it justifies.
      title="doc"
      meta={
        world.spec
          ? `${world.spec.fileName} · ${world.spec.blocks.length} blocks`
          : "no spec attached"
      }
      actions={
        <>
          <FactChip
            tone="pea"
            title="Open proposals waiting on a verdict. They are ephemeral — page-scoped, never written, gone on reload. Only accept makes one real."
          >
            {openProposals.length} open
          </FactChip>
          <Switcher
            ariaLabel="doc mode"
            value={docMode}
            onChange={setDocMode}
            options={[
              {
                value: "text",
                label: "text",
                title:
                  "Show the spec as OCR read it: markdown blocks, checkable word for word. This is what a citation actually resolves to.",
              },
              {
                value: "sheet",
                label: "sheet",
                title:
                  "Show the spec as a page: the block boxes where they sit on the sheet, so a citation can be located by eye. STAND-IN — the real surface renders the PDF here through the grounded-doc camera.",
              },
            ]}
          />
          <Verb
            label="parse"
            onClick={() =>
              say(
                world.spec
                  ? `re-parsed ${world.spec.fileName} — ${world.spec.blocks.length} blocks`
                  : "No spec is attached to this profile, so there is nothing to re-read. Parsing one is route:family's parse_spec command, which this page does not yet run.",
              )
            }
            reason="Read the source document again and rebuild its blocks. Parsing is the doc pane's own verb — it changes what can be cited, and nothing about the profile."
          />
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* proposals — margin annotations, docked as a stack above the spec */}
        <div className="hairline-b px-2 py-1.5" data-surface="artifact">
          <div
            className="mb-1 flex items-baseline gap-2"
            title="Pea's reading of the spec, aimed at named cells. Accepting moves the value into the table where you can see it land; the citation stays lit either way, because the grounding is a separate fact from the proposal."
          >
            <span className="face-mono t-label t-upper" data-tone="pea">
              pea
            </span>
            <span className="t-label t-upper text-ink-2">proposals · ephemeral · page-scoped</span>
          </div>
          {world.proposals.length === 0 ? (
            <EmptyState story="scope" exit="ask pea to read the attached spec against the family">
              no proposals — pea has not read this spec against the profile
            </EmptyState>
          ) : (
            world.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                verdict={verdictOf(proposal.id)}
                // A card lights either because it is the one you located, or because its whole ROW
                // is the one you located — the two-proposal case has to light both cards or the
                // count on the rail would be pointing at something the sidebar refuses to show.
                focused={focusedProposal === proposal.id || pinnedParam === proposal.param}
                blockMd={
                  world.spec?.blocks.find((block) => block.id === proposal.sourceBlockId)?.md ??
                  null
                }
                specFileName={world.spec?.fileName ?? null}
                onAccept={() => accept(proposal)}
                onDeny={() => deny(proposal)}
                onHover={(on) => {
                  setFocus(on ? { kind: "param", id: proposal.param } : null);
                  setFocusedProposal(on ? proposal.id : null);
                }}
                register={(node) => {
                  cardRefs.current[proposal.id] = node;
                }}
              />
            ))
          )}
        </div>

        {docMode === "text" ? (
          <SpecText spec={world.spec} litBlocks={litBlocks} />
        ) : (
          <SpecSheet spec={world.spec} litBlocks={litBlocks} zoom={docZoom} onZoom={setDocZoom} />
        )}
      </div>

      {inspectorPanel}
    </Pane>
  );

  return docPane;
}

function partProseOnly(world: PageWorld, slug: string) {
  const prose = world.constituents.find((entry) => entry.slug === slug)?.text ?? null;
  return (
    <EmptyState story="scope" exit="declare its geometry in the profile to make it editable here">
      no structured geometry declared for {slug}
      {prose ? ` — the profile says only: ${prose}` : ""}
    </EmptyState>
  );
}

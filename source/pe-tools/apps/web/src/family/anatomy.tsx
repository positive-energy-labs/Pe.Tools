/**
 * /family — the anatomy triptych: true-scale FRONT / SIDE / PLAN of the profile.
 *
 * Honest elevations, drawn from the numbers the table is showing for the type on stage. It is a
 * reading of the PROFILE, not a render of Revit — every value resolves through the same paths the
 * table uses, so a rebind, a ghost-row edit, or a typed override moves the drawing on the next
 * render. When a value is a formula or missing, the drawing draws from what feeds it or says so
 * in words rather than guessing.
 *
 * TWO HONEST PATHS, ONE DRAWING (phase C, 2026-08-17):
 *
 *   FIXTURE  — no document open. `buildParts` below still knows the six fixture slugs by name,
 *              placement rules as per-slug constants. Unchanged, and honest about its scope: a
 *              world it does not recognise draws the empty state.
 *   LIVE     — a `model` prop arrives (the parsed document). The DRAFT is composed over it
 *              (`draftedModel`) and the real evaluator (`family-model`'s `buildSheet`) resolves
 *              frames, planes, faces and connectors properly — so the drawing shows the page's
 *              live truth: type a number in the table and the geometry moves.
 *
 * THE RPs ARE DRAWN. A reference plane whose axis is in-plane renders as a labelled line — these
 * are the dims the FF processor will create, so hovering a param-driven plane lights its
 * parameter's row exactly as a dim chip would. A plane the evaluator cannot place (formula-driven,
 * no resolvable offset) is NAMED in words under the drawing, never drawn at a guess. Frames get a
 * small origin cross only where every needed axis resolves; the room point keeps its old marker
 * (leader + dot) on a viz rung, because it is a KIND of thing, not a state.
 *
 * GHOSTS: every OTHER type is drawn behind the staged one as a thin outline at the same fixed
 * scale, so a type comparison needs no second drawing. Fixed scale is the law here — a taller
 * type draws TALLER rather than being refitted to the box. On the live lane the scale comes from
 * `sheetBounds` INCLUDING ghosts, so it holds still while you stage different types.
 *
 * COLOUR HERE IS TAXONOMY, NOT STATE. A solid and a connector are two KINDS of thing, which is
 * exactly what the viz ladder is for; nothing in this drawing carries a verdict, so nothing in it
 * may wear a meaning role. Material is plain ink; connectors keep their taxonomy hue; the void's
 * dash is the one legal dash AMONG PARTS (declared volume with no material behind it) — the datum
 * crosshair and the room point's leader are annotation, not parts; that distinction still needs a
 * ruling. FOCUS is page vocabulary, not drawing vocabulary: a `--pe-select` fill and
 * an ink stroke, exactly as the table's focused row does.
 */
import { HelpTip } from "#/components/lang/help";
import type { FamilyModel } from "#/family/family-model";
import { bindingOf, type Draft, type Focus, type PageWorld } from "#/family/model";
import { boundParam } from "#/family/world";
import { Press } from "#/components/lang/press";
import { FixtureViews } from "#/family/anatomy-fixture-views";
import { ModelViews } from "#/family/anatomy-model-views";

export function AnatomyDrawing({
  world,
  draft,
  typeName,
  model,
  focusedParts,
  focusedParams,
  onFocus,
  onInspect,
  inspecting,
}: {
  world: PageWorld;
  draft: Draft;
  typeName: string;
  /** null → the declared fixture lane (buildParts). Non-null → the parsed document, drawn through
   * the real evaluator with the draft composed over it. */
  model: FamilyModel | null;
  focusedParts: Set<string>;
  /** Which parameter rows are lit — a param-driven plane IS a dim of its parameter, so it lights
   * with the row and lights the row back. */
  focusedParams: Set<string>;
  onFocus: (focus: Focus) => void;
  /** A constituent is something you can OPEN, not just light. */
  onInspect: (slug: string) => void;
  inspecting: string | null;
}) {
  const views =
    model == null ? (
      <FixtureViews
        world={world}
        draft={draft}
        typeName={typeName}
        focusedParts={focusedParts}
        onFocus={onFocus}
        onInspect={onInspect}
      />
    ) : (
      <ModelViews
        model={model}
        world={world}
        draft={draft}
        typeName={typeName}
        focusedParts={focusedParts}
        focusedParams={focusedParams}
        onFocus={onFocus}
        onInspect={onInspect}
      />
    );

  return (
    <div className="flex size-full min-h-0">
      {views}
      <div className="min-w-0 flex-1 overflow-y-auto p-2">
        <p className="mb-1 flex items-center gap-1">
          constituents · {typeName}
          <HelpTip>
            The profile&rsquo;s own constituent list. Hovering one lights both the shape and the
            table rows it drives, because there is only ever ONE thing in focus. Clicking OPENS it
            in the doc pane&rsquo;s lower half, where the half of it no parameter can drive —
            direction, system type, where its frame sits — is edited.
          </HelpTip>
        </p>
        {world.constituents.map((part) => {
          const geom = world.geomBySlug.get(part.slug);
          const unbound =
            geom?.dims.filter(
              (dim) => boundParam(bindingOf(world, draft, part.slug, dim.property)) == null,
            ).length ?? 0;
          return (
            <Press
              key={part.slug}
              type="button"
              onMouseEnter={() => onFocus({ kind: "part", id: part.slug })}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onInspect(part.slug)}
              size="chip-caption"
              tone={focusedParts.has(part.slug) ? "firm" : "neutral"}
              layout="row"
              state={inspecting === part.slug ? "selected" : "rest"}
              title={`${part.text} — consumes ${part.params.length > 0 ? part.params.join(", ") : "no parameter the profile names, which is worth a second look"}.${
                geom
                  ? ` Click to open it: ${geom.kind}, ${geom.dims.length} bindable dims${unbound > 0 ? ` (${unbound} of them UNBOUND — frozen literals, waiting at the bottom of the table)` : " (all bound)"}, and ${geom.meta.length} non-bindable properties that live only in the inspector.`
                  : ""
              }`}
            >
              <span>{part.kind} </span>
              <span className="min-w-0">{part.slug}</span>
              {unbound > 0 && (
                <span
                  className="ml-auto"
                  title={`${unbound} of this constituent's dimensions are frozen literals no parameter drives. They are the ghost rows at the bottom of the table.`}
                >
                  {unbound}⚠
                </span>
              )}
            </Press>
          );
        })}
      </div>
    </div>
  );
}

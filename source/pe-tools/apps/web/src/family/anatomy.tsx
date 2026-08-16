/**
 * /family — the anatomy drawing.
 *
 * An honest elevation, drawn from the numbers the table is showing for the type on stage. It is a
 * reading of the PROFILE, not a render of Revit — so when a parameter is a formula or unparseable,
 * the drawing says so rather than guessing a shape.
 *
 * COLOUR HERE IS TAXONOMY, NOT STATE. A solid and a connector are two KINDS of thing, which is
 * exactly what the viz ladder is for; nothing in this drawing carries a verdict, so nothing in it
 * may wear a meaning role. (Before the language sweep the material stroke was `--clay-ink` — i.e.
 * `--r-alarm`, the one colour that may only ever mean "the model disagrees" — spent on every solid
 * in the drawing, always.) Material is now plain ink; connectors keep their taxonomy hue.
 *
 * FOCUS is page vocabulary, not drawing vocabulary: it lights as a `--r-select` fill and an ink
 * stroke, exactly as the table's focused row does, and spends no state colour.
 */
import {
  CONSTITUENTS,
  EMPTY_CLASS,
  GEOM_BY_SLUG,
  bindingOf,
  effective,
  inches,
  type Draft,
  type Focus,
} from "#/family/model";
import { WORLD, boundParam } from "#/family/world";
import { cn } from "#/lib/utils";

export function AnatomyDrawing({
  draft,
  typeName,
  focusedParts,
  onFocus,
  onInspect,
  inspecting,
}: {
  draft: Draft;
  typeName: string;
  focusedParts: Set<string>;
  onFocus: (focus: Focus) => void;
  /** A constituent is something you can OPEN, not just light. */
  onInspect: (slug: string) => void;
  inspecting: string | null;
}) {
  const value = (param: string) => inches(effective(draft, param, typeName));
  const bodyW = value("Body Width");
  const bodyH = value("Body Height");
  const topD = value("Top Diameter");
  const topH = value("Top Height");
  const returnZ = value("Return Elevation");
  const pipeZ = value("Pipe Elevation");
  const ductD = value("Round Duct Diameter");

  if (bodyW == null || bodyH == null)
    return (
      <p
        className={cn(EMPTY_CLASS, "p-3")}
        title="The drawing only ever shows numbers the profile actually holds. Give Body Width and Body Height literal values at this type — or switch the stage to a type that has them — and the elevation appears."
      >
        no shape to draw — the body&apos;s width or height is not a literal at this type, and
        nothing here guesses
      </p>
    );

  // Fixed viewBox, fixed scale: the drawing must be comparable between types, so a taller type
  // draws TALLER rather than being refitted to the same box.
  const scale = 3;
  const base = 175;
  const centre = 100;
  const bodyTop = base - bodyH * scale;
  const neckH = (topH ?? 0) * scale;
  const neckW = (topD ?? 0) * scale;
  const coreTop = bodyTop - neckH;

  const partFill = (slug: string) => (focusedParts.has(slug) ? "var(--r-select)" : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? "var(--r-ink)" : "var(--r-ink-2)");
  /** Connectors are a KIND, not a state — the one legitimate viz spend on this page. */
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? "var(--r-ink)" : "var(--viz-4)";
  // Hovering LIGHTS, clicking OPENS — the same two-step the table's rows use, so the drawing is
  // not a separate interaction vocabulary you have to learn beside it.
  const hover = (slug: string) => ({
    onMouseEnter: () => onFocus({ kind: "part", id: slug }),
    onMouseLeave: () => onFocus(null),
    onClick: () => onInspect(slug),
    style: { cursor: "pointer" as const },
  });

  return (
    <div className="flex size-full min-h-0">
      <svg viewBox="0 0 200 200" className="h-full" role="img" aria-label="family elevation">
        {/* ground line — every elevation needs a datum or the connector heights mean nothing */}
        <line x1={20} y1={base} x2={180} y2={base} stroke="var(--r-line-2)" strokeWidth={0.5} />

        <rect
          {...hover("body")}
          x={centre - (bodyW * scale) / 2}
          y={bodyTop}
          width={bodyW * scale}
          height={bodyH * scale}
          fill={partFill("body")}
          stroke={partStroke("body")}
          strokeWidth={0.8}
        >
          <title>
            {`body — ${WORLD.profile.solids.body}. Drawn at ${bodyW}in × ${bodyH}in for the ${typeName} type; hovering it lights the parameters it consumes in the table.`}
          </title>
        </rect>

        {topD != null && topH != null && (
          <rect
            {...hover("top-neck")}
            x={centre - neckW / 2}
            y={coreTop}
            width={neckW}
            height={neckH}
            fill={partFill("top-neck")}
            stroke={partStroke("top-neck")}
            strokeWidth={0.8}
          >
            <title>
              {`top-neck — ${WORLD.profile.solids["top-neck"]}. A cylinder, drawn in elevation as its ${topD}in width by ${topH}in height.`}
            </title>
          </rect>
        )}

        {/* THE ONE LEGAL DASH IN THIS DRAWING. A void is declared volume with no material behind
            it, which is the seam reading exactly — and it must not read as material. */}
        <line
          {...hover("core-bore")}
          x1={centre}
          y1={base}
          x2={centre}
          y2={coreTop}
          stroke={focusedParts.has("core-bore") ? "var(--r-ink)" : "var(--r-line-2)"}
          strokeWidth={1}
          strokeDasharray="3 2"
        >
          <title>
            {`core-bore — ${WORLD.profile.solids["core-bore"]}. Core Height is a formula, so this is drawn from what feeds it rather than from a literal. Dashed because it is a SUBTRACTION: declared volume with no material behind it.`}
          </title>
        </line>

        {ductD != null && topD != null && (
          <circle
            {...hover("supply-air")}
            cx={centre}
            cy={coreTop}
            r={(ductD * scale) / 2}
            fill={partFill("supply-air")}
            stroke={connectorStroke("supply-air")}
            strokeWidth={0.8}
          >
            <title>{`supply-air — ${WORLD.profile.connectors["supply-air"]}, ${ductD}in across.`}</title>
          </circle>
        )}

        {returnZ != null && (
          <rect
            {...hover("return-air")}
            x={centre - (bodyW * scale) / 2 - 6}
            y={base - returnZ * scale - 3}
            width={6}
            height={6}
            fill={partFill("return-air")}
            stroke={connectorStroke("return-air")}
            strokeWidth={0.8}
          >
            <title>{`return-air — ${WORLD.profile.connectors["return-air"]}, at ${returnZ}in above the datum.`}</title>
          </rect>
        )}

        {pipeZ != null && (
          <circle
            {...hover("condensate")}
            cx={centre + (bodyW * scale) / 2 + 4}
            cy={base - pipeZ * scale}
            r={3}
            fill={partFill("condensate")}
            stroke={connectorStroke("condensate")}
            strokeWidth={0.8}
          >
            <title>{`condensate — ${WORLD.profile.connectors.condensate}, at ${pipeZ}in above the datum.`}</title>
          </circle>
        )}
      </svg>

      <div className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--r-line)] p-2">
        <p
          className="tele mb-1 text-[9px] text-[var(--r-ink-2)]"
          title="The profile's own constituent list. Hovering one lights both the shape and the table rows it drives, because there is only ever ONE thing in focus. Clicking OPENS it in the doc pane's lower half, where the half of it no parameter can drive — direction, system type, where its frame sits — is edited."
        >
          constituents · {typeName}
        </p>
        {CONSTITUENTS.map((part) => {
          const geom = GEOM_BY_SLUG.get(part.slug);
          const unbound =
            geom?.dims.filter(
              (dim) => boundParam(bindingOf(draft, part.slug, dim.property)) == null,
            ).length ?? 0;
          return (
            <button
              key={part.slug}
              type="button"
              onMouseEnter={() => onFocus({ kind: "part", id: part.slug })}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onInspect(part.slug)}
              title={`${part.text} — consumes ${part.params.length > 0 ? part.params.join(", ") : "no parameter the profile names, which is worth a second look"}.${
                geom
                  ? ` Click to open it: ${geom.kind}, ${geom.dims.length} bindable dims${unbound > 0 ? ` (${unbound} of them UNBOUND — frozen literals, waiting at the bottom of the table)` : " (all bound)"}, and ${geom.meta.length} non-bindable properties that live only in the inspector.`
                  : ""
              }`}
              className={cn(
                "tele flex w-full items-center gap-1 truncate rounded-[2px] border px-1 py-0.5 text-left text-[10px]",
                // Selection is a FILL, not a hue: the open constituent sits in the selection rung,
                // the hovered one wears a hairline. Neither is a state of the model.
                inspecting === part.slug
                  ? "border-[var(--r-line-2)] bg-[var(--r-select)] text-[var(--r-ink)]"
                  : focusedParts.has(part.slug)
                    ? "border-[var(--r-line-2)] text-[var(--r-ink)]"
                    : "border-transparent text-[var(--r-ink)]",
              )}
            >
              <span className="text-[var(--r-ink-2)]">{part.kind} </span>
              <span className="min-w-0 truncate">{part.slug}</span>
              {unbound > 0 && (
                <span
                  className="ml-auto shrink-0 text-[9px] text-[var(--r-caution)]"
                  title={`${unbound} of this constituent's dimensions are frozen literals no parameter drives. They are the ghost rows at the bottom of the table.`}
                >
                  {unbound}⚠
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

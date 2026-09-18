import { token } from "#/lib/token";
/**
 * EXPORT SHEET — what the mechanical engineer hands the architect: one page, one or many grille
 * drawings, a title block, the numbers that matter under each. Native-first: the browser's own
 * print → PDF is the export (a `@media print` rule isolates the sheet), and each drawing can be
 * saved as a standalone .svg (the read-only drawing has no foreignObject, so it survives).
 *
 * ponytail: no DXF/PDF library; add one when print-to-PDF is measurably not enough.
 */
import type { SheetRow } from "./sheet";
import { SpecDrawing } from "./spec-drawing";
import { frac, pct } from "./math";
import { Press } from "#/components/lang/press";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";

export function ExportSheet({
  rows,
  project,
  onProject,
  onClose,
}: {
  rows: SheetRow[];
  project: string;
  onProject: (s: string) => void;
  onClose: () => void;
}) {
  const px = rows.length > 1 ? 20 : 26;
  const downloadSvg = (id: string) => {
    const svg = document.querySelector<SVGSVGElement>(`#export-${id} svg`);
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // bake the tokens: a standalone file has no design-lang.css
    for (const [k, v] of [
      ["--pe-ink", token("ink")],
      ["--pe-ink-2", token("ink-2")],
      ["--pe-page", token("page")],
      ["--pe-alarm", token("alarm")],
    ])
      clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${k}:${v}`);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `grille-${id}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="z-modal overflow-auto">
      <style>{`@media print {
        body * { visibility: hidden; }
        #grille-export-sheet, #grille-export-sheet * { visibility: visible; }
        #grille-export-sheet { position: absolute; inset: 0; margin: 0; }
      }`}</style>
      <div className="flex items-center gap-3 px-3 py-2" style={{ borderColor: token("line") }}>
        <span>export sheet</span>
        <span>
          {rows.length} grille{rows.length === 1 ? "" : "s"} · print → PDF, or save each as .svg
        </span>
        <ActionButton
          label="print / save PDF"
          reason="Hands this sheet to the browser's print dialog, where it becomes a PDF. Nothing in the model or the row set changes."
          onClick={() => window.print()}
        />
        <Press type="button" tone="quiet" size="label" onClick={onClose}>
          close
        </Press>
      </div>

      <div id="grille-export-sheet" className="mx-auto max-w-[1100px] p-8">
        {/* title block */}
        <div className="grid grid-cols-[1fr_auto] gap-4 pb-2" style={{ borderColor: token("ink") }}>
          <div>
            <div>Positive Energy · custom wood floor grille</div>
            <div className="mt-1">
              <Input
                placeholder="project / location"
                value={project}
                onChange={(e) => onProject(e.target.value)}
              />
            </div>
          </div>
          <div>
            <div>{new Date().toISOString().slice(0, 10)}</div>
            <div>free area per PE calculator · all dims inches</div>
          </div>
        </div>

        {rows.length === 0 && (
          <p className="py-8">nothing on the sheet — tick rows in the table first</p>
        )}

        <div
          className="grid gap-8 py-6"
          style={{ gridTemplateColumns: rows.length > 1 ? "1fr 1fr" : "1fr" }}
        >
          {rows.map((r, i) => (
            <figure key={r.id} id={`export-${r.id}`} className="min-w-0">
              <figcaption className="flex items-baseline gap-3">
                <b>G-{i + 1}</b>
                <span>
                  {frac(r.boardLength)} × {frac(r.boardWidth)} · {r.openings} × {frac(r.opening)}″
                  openings · {frac(r.rib)}″ ribs
                </span>
                <span className="ml-auto">
                  free area <b>{pct(r.freeArea)}</b> · {r.actualFreeArea.toFixed(1)} in²
                </span>
                <ActionButton
                  label=".svg"
                  reason="Saves this one drawing as a standalone .svg file, tokens baked in. Nothing in the model or the row set changes."
                  onClick={() => downloadSvg(r.id)}
                />
              </figcaption>
              <div className="overflow-x-auto">
                <SpecDrawing g={r} px={px} id={`-${r.id}`} />
              </div>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}

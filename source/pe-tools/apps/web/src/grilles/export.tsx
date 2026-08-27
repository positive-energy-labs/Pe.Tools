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
import { Verb } from "#/components/lang/verb";

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
    const cs = getComputedStyle(svg);
    for (const [k, v] of [
      ["--r-ink", cs.getPropertyValue("--r-ink") || "var(--r-ink)"],
      ["--r-ink-2", cs.getPropertyValue("--r-ink-2") || "var(--r-ink-2)"],
      ["--r-page", cs.getPropertyValue("--r-page") || "var(--r-page)"],
      ["--r-alarm", cs.getPropertyValue("--r-alarm") || "var(--r-alarm)"],
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
    <div className="fixed inset-0 z-50 overflow-auto bg-[var(--r-page)] text-[var(--r-ink)]">
      <style>{`@media print {
        body * { visibility: hidden; }
        #grille-export-sheet, #grille-export-sheet * { visibility: visible; }
        #grille-export-sheet { position: absolute; inset: 0; margin: 0; }
        .no-print { display: none !important; }
      }`}</style>
      <div
        className="no-print flex items-center gap-3 border-b px-3 py-2"
        style={{ borderColor: "var(--r-line)" }}
      >
        <span className="face-mono t-label t-upper text-[var(--r-ink-mute)]">export sheet</span>
        <span className="face-mono t-label text-[var(--r-ink-2)]">
          {rows.length} grille{rows.length === 1 ? "" : "s"} · print → PDF, or save each as .svg
        </span>
        <Verb
          label="print / save PDF"
          reason="Print the export sheet or save it as a PDF."
          className="face-mono ml-auto t-label text-[var(--r-nav)]"
          onClick={() => window.print()}
        />
        <Verb
          label="close"
          reason="Close the export sheet and return to the grille profiles."
          className="face-mono t-label text-[var(--r-nav)]"
          onClick={onClose}
        />
      </div>

      <div id="grille-export-sheet" className="mx-auto max-w-[1100px] p-8">
        {/* title block */}
        <div
          className="face-mono grid grid-cols-[1fr_auto] gap-4 border-b-2 pb-2 t-label"
          style={{ borderColor: "var(--r-ink)" }}
        >
          <div>
            <div className="t-label t-upper text-[var(--r-ink-mute)]">
              Positive Energy · custom wood floor grille
            </div>
            <input
              className="mt-1 w-full bg-transparent t-title outline-none"
              placeholder="project / location"
              value={project}
              onChange={(e) => onProject(e.target.value)}
            />
          </div>
          <div className="text-right text-[var(--r-ink-2)]">
            <div>{new Date().toISOString().slice(0, 10)}</div>
            <div>free area per PE calculator · all dims inches</div>
          </div>
        </div>

        {rows.length === 0 && (
          <p className="face-mono py-8 t-value text-[var(--r-ink-2)]">
            nothing on the sheet — tick rows in the table first
          </p>
        )}

        <div
          className="grid gap-8 py-6"
          style={{ gridTemplateColumns: rows.length > 1 ? "1fr 1fr" : "1fr" }}
        >
          {rows.map((r, i) => (
            <figure key={r.id} id={`export-${r.id}`} className="min-w-0 break-inside-avoid">
              <figcaption className="face-mono flex items-baseline gap-3 t-label">
                <b>G-{i + 1}</b>
                <span>
                  {frac(r.boardLength)} × {frac(r.boardWidth)} · {r.openings} × {frac(r.opening)}″
                  openings · {frac(r.rib)}″ ribs
                </span>
                <span className="ml-auto text-[var(--r-ink-2)]">
                  free area <b className="text-[var(--r-ink)]">{pct(r.freeArea)}</b> ·{" "}
                  {r.actualFreeArea.toFixed(1)} in²
                </span>
                <Verb
                  label=".svg"
                  reason="Save this grille drawing as a standalone SVG."
                  className="no-print text-[var(--r-nav)]"
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

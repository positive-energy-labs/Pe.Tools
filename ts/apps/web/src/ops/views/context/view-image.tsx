/**
 * `revit.context.view-image`: the picture itself, from the host's captures store. The response
 * names the registered sha; an unregistered taking (a sheet, an uncropped view) is still kept, in the picture store.
 */
import type { RevitContextViewImage } from "@pe/host-contracts/generated";
import { captureUrl } from "@pe/agent-contracts";
import { runtimeStreamUrl } from "@pe/web-kernel/host/runtime";
import { currentFixture } from "@pe/web-kernel/shell/fixture-name";

import { FactChip } from "@pe/kit/lang/chip";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { revitTarget } from "@pe/kit/lang/revit-target";
import { Provenance, Section } from "@pe/kit/lang/section";
import { type OpViewProps, UnrecognizedShape, asRecord } from "#/ops/registry";

export function ViewImageView({ data }: OpViewProps) {
  const rec = asRecord(data);
  if (!rec) return <UnrecognizedShape />;
  const res = rec as unknown as RevitContextViewImage.Res.Response;
  if (res.refused && Array.isArray(res.notDrawn))
    return (
      <Section label={res.view.label ?? "view"}>
        <OutcomeLine
          kind="refused"
          label="Picture refused"
          says="No requested element can be drawn in this view."
        />
        {res.notDrawn.map((item) => (
          <div key={item.elementId} {...revitTarget([item.elementId])}>
            <Provenance>
              Element {item.elementId}: {item.reasons.join(", ")}
            </Provenance>
          </div>
        ))}
        {res.restore && !res.restore.held ? (
          <OutcomeLine
            kind="error"
            label="View restore failed"
            says={res.restore.left.join(", ")}
          />
        ) : null}
      </Section>
    );
  const sha = res.registration?.imageSha256;
  const png =
    typeof rec.imageUrl === "string" && /^\/captures\/[0-9a-f]{64}\.png$/.test(rec.imageUrl)
      ? rec.imageUrl
      : sha
        ? captureUrl(encodeURIComponent(sha))
        : null;
  if (!png && typeof rec.filePath !== "string") return <UnrecognizedShape />;
  const imageUrl =
    png && typeof window !== "undefined" && currentFixture() === null ? runtimeStreamUrl(png) : png;
  return (
    <Section
      label={res.view.label ?? "view"}
      aside={
        <>
          <FactChip title="The delivered PNG's measured width and height.">
            {res.width} × {res.height}px
          </FactChip>
          {res.viewScale ? <FactChip title="The view's scale.">1:{res.viewScale}</FactChip> : null}
          {res.sheetNumber ? (
            <FactChip title="The sheet the picture was taken from.">{res.sheetNumber}</FactChip>
          ) : null}
          <FactChip
            tone={sha ? undefined : "caution"}
            title={
              sha
                ? "Revit registered the picture: model corners place its pixels under geometry."
                : `No registration: ${res.registrationRefusal ?? "no reason given"}.`
            }
          >
            {sha ? `registered ${sha.slice(0, 8)}` : "unregistered"}
          </FactChip>
        </>
      }
    >
      {imageUrl ? (
        <a href={imageUrl} target="_blank" rel="noreferrer">
          <img src={imageUrl} alt={res.view.label ?? "view"} className="w-full" />
        </a>
      ) : null}
      <Provenance>{res.byteSize} bytes</Provenance>
    </Section>
  );
}

import { z } from "zod";
import { canonicalRouteInput, writePreviewSchema } from "@pe/agent-contracts";
import { roomsWork, takeoffsWork } from "@pe/rooms-contract/product";

export function stageIntent(
  pane: "roster" | "adoption",
  command: string,
  label: string,
  request: unknown,
  doc: unknown,
) {
  const schema = pane === "roster" ? roomsWork.schema : takeoffsWork.schema;
  const current = schema.safeParse(doc).data?.writeIntent?.[command]?.edit?.value;
  if (canonicalRouteInput(current) === canonicalRouteInput(request)) return;
  return { pane, path: ["writeIntent", command] as const, label, value: request };
}
const replacement = z.object({ owner: z.string(), reason: z.string() }).nullish();
const evidence = z.object({ regions: replacement, registry: replacement });

export function presentIntent(
  result: unknown,
  sentence: string,
  rows: (intent: unknown) => string[] = () => [],
) {
  const preview = writePreviewSchema.parse(result);
  const records = evidence.safeParse(preview.evidence).data;
  return {
    sentence,
    rows: [
      ...rows(preview.authoredIntent),
      ...Object.values(records ?? {}).flatMap((record) =>
        record ? [`Replacement needed for ${record.owner}: ${record.reason}`] : [],
      ),
    ],
  };
}

import { Button } from "@pe/kit/lang/button";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { Tag } from "@pe/kit/lang/chip";
import {
  reviewAddresses,
  type CellWire,
  ReviewRow,
  WorkSentence,
  WorkStanding,
  workSummary,
} from "#/components/work/band";
import type { MemberWorkHandle } from "./spec-editor";

const display = (rung: { value?: unknown; delete?: true } | null | undefined) =>
  rung?.delete
    ? "DELETE"
    : rung?.value === undefined
      ? "—"
      : typeof rung.value === "string"
        ? rung.value
        : JSON.stringify(rung.value);

/**
 * Pea's proposals and the staged fields on the open member, on the Work band: accept stages, deny
 * clears, unstage clears the staged value, and save writes every staged field. It stays out of the
 * way while the Work is clean.
 */
export function ProposalReview({
  work,
  readSha,
}: {
  work: MemberWorkHandle;
  readSha: string | null;
}) {
  const doc = work.work.doc;
  // The root raw edit is the editor's draft, not a card.
  const { [""]: _draft, ...fields } = doc?.fields ?? {};
  const items = reviewAddresses(fields);
  const basisSha = doc?.basis?.sha256 ?? null;
  // The Work reviews bytes the editor no longer sees on disk: only a person may adopt the new ones.
  const moved = !work.demo && readSha !== null && basisSha !== null && readSha !== basisSha;
  if (!items.length && !moved) return null;
  const wire: CellWire = {
    segment: "fields",
    write: work.work.write,
    revision: work.work.revision,
  };
  const busy = work.busy !== null;
  return (
    <ArtifactFrame
      head={
        <>
          <Tag>pea</Tag>
          {moved ? (
            <Button
              kind="framed"
              label="adopt disk bytes"
              refusal={
                busy
                  ? "The member changed on disk after these proposals were made. Adopting discards them and the staged fields."
                  : null
              }
              reason="The member changed on disk after these proposals were made. Adopting discards them and the staged fields."
              onClick={() => void work.actions.adopt.run({ sha256: readSha } as never)}
            >
              adopt disk bytes
            </Button>
          ) : null}
        </>
      }
    >
      <div className="px-3">
        <WorkSentence
          summary={workSummary(fields, { groupOf: (key) => [key] }, ["field"])}
          cells={fields}
          wire={wire}
          commit={
            <Button
              kind="framed"
              label="save"
              refusal={
                work.actions.save.refusal != null || busy
                  ? (work.actions.save.refusal ?? "Write every staged field to the member")
                  : null
              }
              reason="Write every staged field to the member"
              onClick={() => void work.actions.save.run().catch(() => undefined)}
            >
              save
            </Button>
          }
        />
        <WorkStanding
          conflict={work.work.conflict}
          reload={work.work.reload}
          unresolved={work.failure ? [work.failure.message] : []}
        />
        {items.map(([path, cell]) => (
          <ReviewRow
            key={path}
            wire={wire}
            address={path}
            label={<span className="face-mono">{path}</span>}
            cell={cell}
            facts={{ value: display(cell.staged ?? cell.proposal) }}
          />
        ))}
      </div>
    </ArtifactFrame>
  );
}

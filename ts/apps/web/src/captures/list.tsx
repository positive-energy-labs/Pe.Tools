/**
 * The capture history: one frame per taking, newest first. A capture is a machine-made object
 * with state (a registered picture of a view), so it wears the artifact frame: the head carries
 * its facts, the body its thumbnail and, on demand, the receipt itself.
 */
import { useEffect, useRef, useState } from "react";
import type { CaptureReceipt } from "@pe/agent-contracts";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { Code, stringify } from "#/components/lang/code";
import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { useCopy } from "#/lib/use-copy";

/** What the request cropped to, in words; `whole view` when it named no focus. */
const focusWords = (focus: CaptureReceipt["focus"]): string =>
  focus?.elementIds?.length
    ? `${focus.elementIds.length} element${focus.elementIds.length === 1 ? "" : "s"}`
    : focus?.selection
      ? "selection"
      : focus?.scopeBox
        ? `scope box ${focus.scopeBox}`
        : "whole view";

function CaptureFrame({ receipt, focused }: { receipt: CaptureReceipt; focused: boolean }) {
  const [open, setOpen] = useState(focused);
  const { copied, copy } = useCopy();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const absolute = new URL(receipt.url, window.location.origin).href;
  return (
    <div ref={ref} data-sha={receipt.sha} data-active={focused ? "" : undefined}>
      <ArtifactFrame
        label={`capture ${receipt.sha.slice(0, 8)}`}
        head={
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <FactChip title="When the host kept this taking.">
              {new Date(receipt.at).toLocaleString()}
            </FactChip>
            <FactChip title="Who asked: a web route, an agent, or a person at the CLI.">
              {receipt.origin}
            </FactChip>
            <FactChip title="The document the view belongs to.">
              {receipt.document.title ?? "untitled document"}
            </FactChip>
            <FactChip title="The view Revit exported.">{receipt.view.name ?? "view"}</FactChip>
            <FactChip title="What the request cropped to.">{focusWords(receipt.focus)}</FactChip>
            {receipt.registration ? null : (
              <FactChip
                tone="caution"
                title="Revit gave no registration (a sheet, or a view without a crop): the picture cannot be placed under model geometry."
              >
                unregistered
              </FactChip>
            )}
          </span>
        }
        headTrail={
          <span className="flex items-center gap-1.5">
            <a href={receipt.url} target="_blank" rel="noreferrer">
              open png
            </a>
            <Press tone="nav" size="value" onClick={() => copy(absolute)} title={absolute}>
              {copied ? "copied" : "copy url"}
            </Press>
            <Press tone="nav" size="value" onClick={() => setOpen((was) => !was)}>
              {open ? "hide receipt" : "receipt"}
            </Press>
          </span>
        }
      >
        <div className="flex flex-col gap-2 p-(--gutter)">
          <a href={receipt.url} target="_blank" rel="noreferrer" className="self-start">
            <img
              src={receipt.url}
              alt={`${receipt.view.name ?? "view"} at ${receipt.at}`}
              loading="lazy"
              className="h-40 w-auto"
            />
          </a>
          {open ? <Code code={stringify(receipt)} lang="json" title="receipt" /> : null}
        </div>
      </ArtifactFrame>
    </div>
  );
}

export function CapturesList({
  captures,
  focus,
}: {
  captures: readonly CaptureReceipt[];
  focus?: string;
}) {
  if (!captures.length)
    return (
      <EmptyState story="scope" exit="take one: capture_view, or revit.context.view-image in /ops">
        no captures kept yet
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      {captures.map((receipt) => (
        <CaptureFrame key={receipt.id} receipt={receipt} focused={receipt.sha === focus} />
      ))}
    </div>
  );
}

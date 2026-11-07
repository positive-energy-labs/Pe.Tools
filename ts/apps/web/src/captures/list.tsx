/**
 * The capture history, newest first, as the one list (N3): "/" searches view, document, origin,
 * crop and time; the arrow keys walk; Enter picks. A row names its taking by its view and document
 * (I1: never a sha) with its thumbnail as the lead, and its detail unfolds the picture, the PNG
 * doors and the receipt. Which taking is picked and which details are open live in the address.
 */
import type { Immutable } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { CaptureReceipt } from "@pe/agent-contracts";

import { FactChip } from "@pe/kit/lang/chip";
import { Code, stringify } from "@pe/kit/lang/code";
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, type ValueHandle } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { useCopy } from "@pe/kit/lib/use-copy";
import { runtimeStreamUrl } from "#/host/runtime";
import { useState } from "react";

/** Image requests cannot carry hostFetch's runtime header; bind their URL to the same owner. */
function CaptureImage({
  receipt,
  thumbnail = false,
}: {
  receipt: Immutable<CaptureReceipt>;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span role="status">
      {thumbnail
        ? "Image unavailable"
        : "The retained picture could not be loaded. Open the PNG to inspect the host's refusal, or reload this page to retry."}
    </span>
  ) : (
    <img
      src={runtimeStreamUrl(receipt.url)}
      alt={
        thumbnail ? "" : `${receipt.view.name ?? "View"} · ${receipt.document.title ?? "document"}`
      }
      loading="lazy"
      onError={() => setFailed(true)}
      className={thumbnail ? "h-5 w-8 object-cover" : "h-40 w-auto"}
    />
  );
}

/** What the request cropped to, in words; `whole view` when it named no focus. */
const focusWords = (focus: Immutable<CaptureReceipt>["focus"]): string =>
  focus?.elementIds?.length
    ? `${focus.elementIds.length} element${focus.elementIds.length === 1 ? "" : "s"}`
    : focus?.selection
      ? "selection"
      : focus?.scopeBox
        ? `scope box ${focus.scopeBox}`
        : "whole view";

// One formatter: toLocaleString with options builds a new Intl formatter per call (39 ms of a row
// click on 23 captures, 2026-10-23 profile).
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const when = (at: string) => WHEN.format(new Date(at));

const search = (receipt: Immutable<CaptureReceipt>) => ({
  text: [
    receipt.view.name,
    receipt.document.title,
    receipt.origin,
    focusWords(receipt.focus),
    when(receipt.at),
    receipt.registration ? "registered" : "unregistered",
  ],
});

function CaptureDetail({ receipt }: { receipt: Immutable<CaptureReceipt> }) {
  const { copied, copy } = useCopy();
  const absolute = runtimeStreamUrl(receipt.url);
  return (
    <div className="flex flex-col gap-2 p-(--gutter)">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <FactChip title="Who asked: a web route, an agent, or a person at the CLI.">
          {receipt.origin}
        </FactChip>
        <FactChip title="What the request cropped to.">{focusWords(receipt.focus)}</FactChip>
        {receipt.registration ? null : (
          <FactChip
            tone="caution"
            title="Revit gave no registration (a sheet, or a view without a crop): the picture cannot be placed under model geometry."
          >
            unregistered
          </FactChip>
        )}
        <a href={absolute} target="_blank" rel="noreferrer">
          open png
        </a>
        <Button
          kind="nav"
          direction="forward"
          label={copied ? "copied" : "copy url"}
          reason={absolute}
          onClick={() => copy(absolute)}
        >
          {copied ? "copied" : "copy url"}
        </Button>
      </span>
      <a href={absolute} target="_blank" rel="noreferrer" className="self-start">
        <CaptureImage key={absolute} receipt={receipt} />
      </a>
      <details>
        <summary className="t-small cursor-pointer text-ink-2">receipt</summary>
        <Code code={stringify(receipt)} lang="json" title="receipt" />
      </details>
    </div>
  );
}

export function CapturesList({
  value,
  focus,
  open,
  onPage,
}: {
  value: ValueHandle<{ readonly captures: readonly Immutable<CaptureReceipt>[] }>;
  /** The picked picture's sha. */
  focus?: string;
  /** The shas whose detail is unfolded. */
  open: readonly string[];
  onPage: (page: { sha?: string; open?: readonly string[] }) => void;
}) {
  const captures = value.value?.captures ?? [];
  // The address speaks shas (one picture may be taken twice); the list keys each taking.
  const ids = (shas: readonly string[]) =>
    captures.filter((c) => shas.includes(c.sha)).map((c) => c.id);
  const shaOf = new Map(captures.map((c) => [c.id, c.sha]));
  const shas = (keys: readonly string[]) => [...new Set(keys.map((k) => shaOf.get(k)!))];
  const list = useList({
    value,
    rowsOf: (data) => data.captures,
    keyOf: (receipt) => receipt.id,
    search,
    select: "single",
    state: {
      ...emptyListState(),
      selected: focus ? ids([focus]).slice(0, 1) : [],
      open: ids(open),
    },
    onState: (next) => {
      const sha = shas(next.selected)[0];
      const unfolded = shas(next.open);
      if (sha !== focus || unfolded.join() !== open.join()) onPage({ sha, open: unfolded });
    },
  });
  return (
    <ListView
      list={list}
      aria-label="captures"
      empty={{
        message: "no captures kept yet",
        exit: "take one: capture_view, or revit.context.view-image in /ops",
      }}
      row={(receipt) => ({
        lead: <CaptureImage key={receipt.url} receipt={receipt} thumbnail />,
        label: receipt.view.name ?? "view",
        aside: receipt.document.title ?? "untitled document",
        // L3: one short meta (when); who took it is in the detail and the search.
        meta: <span className="face-mono">{when(receipt.at)}</span>,
      })}
      detail={(receipt) => <CaptureDetail receipt={receipt} />}
    />
  );
}

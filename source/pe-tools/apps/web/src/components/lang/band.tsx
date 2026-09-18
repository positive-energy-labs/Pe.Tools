import type { ReactNode } from "react";

import { Press } from "#/components/lang/press";

export interface WorkBandProps {
  count: number;
  noun: string;
  revision: number | null;
  read?: string;
  conflict?: boolean;
  busy?: boolean;
  discard: () => void;
  commit?: { label: string; reason: string; disabled?: boolean; run: () => void };
  unresolved?: readonly string[];
  reload?: () => void;
  body?: ReactNode;
  /** Compact heads may remain present for open proposals or transient asks with nothing staged. */
  visible?: boolean;
  /** Situation already carries this word beside its verb row. */
  showRevision?: boolean;
}

export const workBandWord = ({
  revision,
  count,
  noun,
  conflict,
}: Pick<WorkBandProps, "revision" | "count" | "noun" | "conflict">) =>
  `${revision === null ? "unwritten" : `r${revision}`}${
    count > 0 ? ` · ${count} ${noun}${count === 1 ? "" : "s"} staged` : ""
  }${conflict ? " · changed elsewhere" : ""}`;

/** The Work frame used below route heads and inside compact composer heads. */
export function WorkBand({
  count,
  noun,
  revision,
  read,
  conflict,
  busy,
  discard,
  commit,
  unresolved = [],
  reload,
  body,
  visible = count > 0,
  showRevision = true,
}: WorkBandProps) {
  if (!visible) return null;
  return (
    <>
      <div className="hairline-t flex flex-col gap-1 py-1.5 t-prose">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="w-[9rem] t-small t-upper text-ink-mute">staged</span>
          <span>
            <b className="font-semibold text-ink">
              {count} {noun}
              {count === 1 ? "" : "s"}
            </b>
            {read ? <span className="face-mono text-ink-mute"> · read {read}</span> : null}
          </span>
          <span className="ml-auto flex items-baseline gap-2">
            <Press
              frame="line"
              tone="quiet"
              size="value"
              state={busy ? "disabled" : "rest"}
              disabled={busy}
              onClick={discard}
            >
              discard
            </Press>
            {commit ? (
              <span className="flex items-baseline gap-2">
                <Press
                  frame="line"
                  tone="neutral"
                  size="value"
                  state={commit.disabled || busy ? "disabled" : "rest"}
                  disabled={commit.disabled || busy}
                  title={commit.reason}
                  onClick={commit.run}
                >
                  {commit.label}
                </Press>
                {commit.disabled ? (
                  // SPECIMEN: /design-system/band K5. A conflicting Work must say why plan refuses.
                  <span className="max-w-[36ch] t-small face-mono text-ink-2 italic">
                    {commit.reason}
                  </span>
                ) : null}
              </span>
            ) : null}
            {showRevision ? (
              <span className="t-small face-mono text-ink-mute">
                {workBandWord({ revision, count, noun, conflict })}
              </span>
            ) : null}
          </span>
        </div>
        {body}
      </div>
      {unresolved.length ? (
        <div
          className="hairline-t flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 t-prose"
          data-tone="caution"
          role="status"
        >
          <span className="w-[9rem] t-small t-upper text-ink-mute">unresolved</span>
          <span>{unresolved.join(" · ")}</span>
          {conflict && reload ? (
            <Press frame="line" tone="quiet" size="value" onClick={reload}>
              reload
            </Press>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

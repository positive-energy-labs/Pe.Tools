/**
 * THE FLOW — how the route's nouns are wired, drawn as one matrix. Rows are the actions, columns
 * are the Readings; a filled cell means "this action dirties that Reading", read left to right.
 * Above the columns each Reading wears its five-state mark, so the matrix also says what is fresh
 * right now. Under the matrix: what the target must be and where Work stands.
 *
 * ponytail: a relation matrix, not a wiring diagram. It carries direction (action → reading),
 * relation (which dirties which) and state (the mark) with zero geometry to measure. An SVG with
 * drawn edges is the upgrade path if the matrix stops fitting a popover (more than ~8 readings).
 */
import { Fragment } from "react";
import type { Reading } from "@pe/agent-contracts";

import { MARK } from "./inspector";
import type { RouteAction } from "./manifest";
import type { RouteHandle } from "./use-route";

export function FlowMatrix({ handle }: { handle: RouteHandle<any, any, any, any> }) {
  const { manifest, readings, resolution, work } = handle;
  const readingKeys = Object.keys(readings);
  const actions = Object.entries(manifest.actions ?? {}) as [
    string,
    RouteAction<unknown, string, unknown, never>,
  ][];
  if (!readingKeys.length && !actions.length) return null;
  const target =
    resolution.kind === "resolved"
      ? `resolved · ${resolution.target.kind}`
      : resolution.kind === "choose"
        ? `unbound · ${resolution.reason.replaceAll("-", " ")}`
        : resolution.kind;
  return (
    <div className="flex flex-col gap-1.5 t-prose">
      <div className="flex items-baseline gap-2">
        <span className="t-small t-upper text-ink-mute">flow</span>
        <span className="t-small face-mono text-ink-mute">action → dirties reading</span>
      </div>
      <div
        className="grid items-center gap-x-3 gap-y-1"
        style={{
          gridTemplateColumns: `minmax(6rem,auto) repeat(${readingKeys.length}, auto) minmax(0,1fr)`,
        }}
      >
        <span />
        {readingKeys.map((key) => {
          const reading = readings[key] as Reading<unknown>;
          return (
            <span
              key={key}
              className="t-small face-mono text-ink-2"
              title={`${key} · ${reading.state}`}
              data-tone={reading.state === "failed" ? "caution" : undefined}
            >
              {MARK[reading.state]} {key}
            </span>
          );
        })}
        <span className="t-small t-upper text-ink-mute">needs</span>
        {actions.map(([name, action]) => (
          <Fragment key={name}>
            <span className="text-ink">
              {action.label}
              {handle.actions[name].actor === "human" ? (
                <span className="t-small face-mono text-ink-mute"> human</span>
              ) : null}
            </span>
            {readingKeys.map((key) => {
              const hit = action.dirties.includes(key);
              return (
                <span
                  key={key}
                  className={`text-center face-mono ${hit ? "text-ink" : "text-ink-mute"}`}
                  title={
                    hit ? `${action.label} dirties ${key}` : `${action.label} leaves ${key} alone`
                  }
                >
                  {hit ? "●" : "·"}
                </span>
              );
            })}
            <span className="t-small face-mono text-ink-mute">{handle.actions[name].needs}</span>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 t-small face-mono text-ink-mute">
        <span>
          target · needs {manifest.needs ?? "nothing"} · {target}
        </span>
        <span>work · {work.revision === null ? "unwritten" : `r${work.revision}`}</span>
      </div>
    </div>
  );
}

/**
 * The inbox shape: group heads in a fixed order, each over rows that read title and status at rest
 * and take their verbs on hover (the Row's own trade of the meta slot), and a group that can
 * collapse to its head and count. A row with `detail` opens in place. Empty groups draw nothing;
 * with nothing to draw the inbox says so (`empty`). The caller derives the rows; this holds no
 * state beyond which row is open and which groups are collapsed.
 */
import { Fragment, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { Row, RowGroupHead } from "./row";

export interface InboxRowSpec {
  key: string;
  /** The row's title; `titleText` is its plain form for the tooltip when it is cut short. */
  title: ReactNode;
  titleText?: string;
  /** One short fact at rest; the verbs take its place on hover. */
  status?: ReactNode;
  verbs?: ReactNode;
  /** The open row's child: prose and worded verbs. Absent, the row does not open. */
  detail?: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  "data-kind"?: string;
}

export interface InboxGroupSpec {
  label: ReactNode;
  rows: readonly InboxRowSpec[];
  /** A head that folds its rows away, keeping its count. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Drawn even with no rows (the Write group stands before anything is staged). */
  always?: boolean;
}

export function Inbox<K extends string>({
  order,
  groups,
  empty,
  onMouseLeave,
  ...rest
}: {
  /** The fixed order of the group heads. */
  order: readonly K[];
  groups: Partial<Record<K, InboxGroupSpec>>;
  empty: ReactNode;
  onMouseLeave?: () => void;
  "aria-label": string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlyMap<string, boolean>>(new Map());
  const drawn = order.flatMap((key) => {
    const group = groups[key];
    return group && (group.rows.length || group.always) ? [[key, group] as const] : [];
  });
  if (!drawn.length) return <div data-inbox="empty">{empty}</div>;
  return (
    <div className="flex flex-col" aria-label={rest["aria-label"]} onMouseLeave={onMouseLeave}>
      {drawn.map(([key, group]) => {
        const collapsed = folded.get(key) ?? group.defaultCollapsed ?? false;
        const toggle = () => setFolded(new Map(folded).set(key, !collapsed));
        const head = <RowGroupHead label={group.label} count={group.rows.length} />;
        return (
          <section key={key} data-inbox-group={key} data-collapsed={collapsed ? "" : undefined}>
            {group.collapsible ? (
              <div
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                className="cursor-default"
                onClick={toggle}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle();
                  }
                }}
              >
                {head}
              </div>
            ) : (
              head
            )}
            {collapsed
              ? null
              : group.rows.map((row) => {
                  const active = open === row.key;
                  const pick = () => {
                    if (row.detail != null) setOpen(active ? null : row.key);
                    row.onClick?.();
                  };
                  return (
                    <Fragment key={row.key}>
                      <Row
                        data-key={row.key}
                        active={active}
                        {...(row.detail != null ? { depth: 0, expanded: active } : {})}
                        onToggle={() => setOpen(active ? null : row.key)}
                        title={row.titleText ?? (typeof row.title === "string" ? row.title : "")}
                        label={<span data-inbox-row={row["data-kind"]}>{row.title}</span>}
                        meta={row.status}
                        actions={row.verbs}
                        onMouseEnter={row.onMouseEnter}
                        onClick={pick}
                      />
                      {active && row.detail != null ? (
                        <div
                          className="dl-row items-start! py-1 select-text!"
                          data-depth={1}
                          style={{ "--depth": 1 } as CSSProperties}
                          data-inbox-detail={row.key}
                        >
                          <span className="dl-row-twist" aria-hidden />
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">{row.detail}</div>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
          </section>
        );
      })}
    </div>
  );
}

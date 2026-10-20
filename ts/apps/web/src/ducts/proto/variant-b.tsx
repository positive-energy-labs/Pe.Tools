/**
 * THROWAWAY (protoui round 1): variant B, "Profiler". Left, the system as a call tree with total
 * and self loss; centre, the shared iso drawing; right, the Rulings inbox. Editing is a
 * click-anchored popover over a selected tree row.
 */
import { useEffect, useMemo, useState } from "react";
import type { RouteStatePatch } from "@pe/agent-contracts";
import { survey } from "@pe/ducts-domain/survey";
import { Pane } from "#/components/lang/pane";

import { elementNamer } from "../claims";
import { indexOf } from "../scene";
import { DuctsSpatial } from "../spatial";
import { EditPopover } from "./b/edit";
import { Explorer } from "./b/explorer";
import { buildTree, groupElementIds, subjectTree, systemList, type TreeNode } from "./b/model";
import { Rulings } from "./b/rulings";
import type { ProtoProps } from "./props";

export function VariantB(props: ProtoProps) {
  const { snapshot, priced, page, setPage } = props;
  // The route reads the ASHRAE tables only for losses/plan/iso; B draws iso, so the route says so.
  useEffect(() => {
    if (page.view !== "iso") setPage({ view: "iso" });
  }, [page.view, setPage]);
  const work = useMemo(
    () => ({
      doc: props.work.doc,
      write: props.work.write as unknown as (p: RouteStatePatch[]) => Promise<unknown>,
    }),
    [props.work.doc, props.work.write],
  );
  const roots = useMemo(
    () =>
      snapshot
        ? snapshot.groups.length
          ? page.group
            ? buildTree(snapshot, priced, work.doc, page.group)
            : systemList(snapshot, priced)
          : props.subject
            ? [subjectTree(snapshot, props.subject.ids, work.doc)]
            : []
        : [],
    [snapshot, priced, work.doc, props.subject, page.group],
  );
  const index = useMemo(() => (snapshot ? indexOf(snapshot, priced) : null), [snapshot, priced]);
  const findings = useMemo(
    () => priced?.findings ?? (snapshot ? survey(snapshot, work.doc).findings : []),
    [priced, snapshot, work.doc],
  );
  const nameOf = useMemo(() => {
    const n = snapshot ? elementNamer(snapshot, null) : () => null;
    return (id: number) => n(id) ?? "element not in snapshot";
  }, [snapshot]);
  const scope = useMemo(
    () => (snapshot && page.group ? groupElementIds(snapshot, page.group) : null),
    [snapshot, page.group],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ node: TreeNode; anchor: HTMLElement } | null>(null);
  const [inbox, setInbox] = useState(true);

  if (!snapshot || !index)
    return <p className="text-ink-2 p-4">{props.empty?.says ?? "reading ducts…"}</p>;
  const pick = (node: TreeNode) => {
    if (node.kind === "system" && !page.group && snapshot.groups.length) {
      setPage({ group: node.key, selected: "", issue: "" });
      return;
    }
    setSelectedKey(node.key);
    props.onSelect(node.id);
  };
  const pricedWord = priced
    ? `fan ${priced.now.fan.toFixed(3)} in-wg`
    : props.fromFixture
      ? "fixture, not priced"
      : "not priced yet";

  return (
    <div data-proto="B" className="flex size-full min-h-0">
      <div className="border-line flex w-[300px] shrink-0 flex-col border-r">
        <Pane
          id="explorer"
          title={page.group ? "system" : "systems"}
          meta={page.group ? pricedWord : `${roots.length} in the document`}
          actions={
            page.group ? (
              <button
                type="button"
                className="cursor-pointer px-1"
                onClick={() => setPage({ group: "", selected: "", issue: "" })}
              >
                all systems
              </button>
            ) : null
          }
          scroll="clip"
          flush
        >
          <Explorer
            key={page.group || "systems"}
            roots={roots}
            selectedKey={selectedKey}
            onPick={pick}
            onHover={props.onHover}
            onEdit={(node, anchor) => {
              pick(node);
              setEdit({ node, anchor });
            }}
          />
        </Pane>
      </div>
      <div className="proto-b-centre min-w-0 flex-1">
        {/* B has no facts pane: Spatial always draws one (not optional), so it is hidden here. */}
        <style>{`.proto-b-centre > [data-slot="pane-split"] { grid-template-columns: minmax(0, 1fr) !important; }
.proto-b-centre > [data-slot="pane-split"] > :has(section[aria-label="facts"]),
.proto-b-centre > [data-slot="pane-split"] > [style*="grid-column: 2"] { display: none !important; }`}</style>
        <DuctsSpatial
          snapshot={snapshot}
          ready={props.ready}
          priced={priced}
          page={{ ...page, view: "iso" }}
          setPage={setPage}
          empty={props.empty}
          subject={props.subject}
          doc={props.doc}
        />
      </div>
      {inbox ? (
        <div className="border-line flex w-[320px] shrink-0 flex-col border-l">
          <Pane
            id="rulings"
            title="Rulings"
            meta="what a person must rule on"
            actions={
              <button type="button" className="cursor-pointer px-1" onClick={() => setInbox(false)}>
                hide
              </button>
            }
          >
            <Rulings
              snapshot={snapshot}
              group={page.group}
              scope={scope}
              findings={findings}
              claims={props.claims}
              work={work}
              nameOf={nameOf}
              selected={page.selected}
              onHover={props.onHover}
              onSelect={(id) => {
                setSelectedKey(null);
                props.onSelect(id);
              }}
              onSelectClaim={(claim) => {
                setSelectedKey(null);
                if (page.scene !== "subject") setPage({ scene: "subject" });
                props.onSelectClaim(claim);
              }}
              onVerdict={props.subject?.onVerdict ?? null}
            />
          </Pane>
        </div>
      ) : (
        <button
          type="button"
          className="border-line text-ink-2 cursor-pointer border-l px-1 [writing-mode:vertical-rl]"
          onClick={() => setInbox(true)}
        >
          Rulings
        </button>
      )}
      <EditPopover
        target={edit}
        close={() => setEdit(null)}
        index={index}
        priced={priced}
        work={work}
      />
    </div>
  );
}

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { z } from "zod";
import { historyPointSchema, type Address } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { historyRequest, historySnapshotSchema, pointHref, type HistorySnapshot } from "./history.ts";
import type { AdmittedAddressPort } from "./typed-address.ts";

/** Both shells resolve the recorded point before acquiring any live resources. */
export function HistoryBoundary({ address, children }: {
  address: AdmittedAddressPort;
  children(snapshot?: HistorySnapshot): ReactNode;
}) {
  const search = useSyncExternalStore(address.subscribe, () => address.read().toString(), () => "");
  const at = new URLSearchParams(search).get("at");
  const [loaded, setLoaded] = useState<{ id: string; snapshot?: HistorySnapshot; error?: string } | null>(null);
  useEffect(() => {
    if (!at) return;
    let closed = false;
    void historyRequest(`?at=${encodeURIComponent(at)}`).then(raw => {
      if (!closed) setLoaded({ id: at, snapshot: historySnapshotSchema.parse(raw) });
    }).catch(error => { if (!closed) setLoaded({ id: at, error: String(error) }); });
    return () => { closed = true; };
  }, [at]);
  if (at && (loaded?.id !== at || !loaded.snapshot)) return <div role="status" data-tone="caution">
    {loaded?.id === at ? loaded.error : "Opening recorded point?"}
  </div>;
  return children(at ? loaded!.snapshot : undefined);
}

/** Timeline's write receipts name the afterWrite rows; all point bindings remain host-owned. */
export function HistoryRail({
  document,
  route,
  address,
  snapshot,
  compare,
}: {
  document: Address | null;
  route: string;
  address: AdmittedAddressPort;
  snapshot?: HistorySnapshot;
  compare: boolean;
}) {
  const [rows, setRows] = useState<z.infer<typeof historyPointSchema>[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!document) return;
    let closed = false;
    const refresh = () =>
      void historyRequest(`?document=${encodeURIComponent(document)}`)
        .then((value) => {
          if (closed) return;
          const result = z
            .object({ points: z.array(historyPointSchema), problem: z.string().nullable() })
            .parse(value);
          setRows(result.points);
          setProblem(result.problem);
        })
        .catch((error) => {
          if (!closed) setProblem(String(error));
        });
    refresh();
    window.addEventListener("pe:history-change", refresh);
    return () => {
      closed = true;
      window.removeEventListener("pe:history-change", refresh);
    };
  }, [document]);
  const capture = async () => {
    try {
      if (!document) throw Error("Choose a document");
      await historyRequest("", { kind: "captured", document });
      window.dispatchEvent(new Event("pe:history-change"));
    } catch (error) {
      setProblem(String(error));
    }
  };
  const live = () => {
    const search = address.read();
    search.delete("at");
    search.delete("atInstance");
    search.delete("compare");
    if (snapshot) search.set("target", snapshot.point.history.address);
    address.write(search, "push");
  };
  const items = rows.flatMap((point) => {
    const poses = point.history.poses.filter((p) => p.route === route);
    const label =
      point.reason.kind === "afterWrite"
        ? "After write"
        : point.reason.kind === "synced"
          ? "Synced"
          : "Captured";
    return (poses.length ? poses : [undefined]).map((pose) => ({
      point,
      pose,
      label,
      id: `${point.id}:${pose?.instance ?? "unavailable"}`,
    }));
  });
  return (
    <aside
      aria-label="History"
      className="flex shrink-0 flex-wrap items-center gap-2 hairline-b px-2 py-1"
    >
      <ListPopup
        anchor="trigger"
        face="control"
        triggerLabel="Open History"
        trigger={`History · ${rows.length}`}
        aria-label="Recorded points"
        items={items}
        keyOf={(item) => item.id}
        labelOf={(item) => item.label}
        filter="substring"
        select="single"
        selected={items
          .filter((item) => item.point.id === snapshot?.point.id)
          .map((item) => item.id)}
        empty="No recorded points"
        row={(item) => ({
          label: item.label,
          meta: new Date(item.point.at).toLocaleString(),
          sub: item.pose ? undefined : "Unavailable here",
        })}
        onPick={(item) => {
          if (!item.pose) {
            setProblem("This route was never published at this point");
            return;
          }
          window.location.assign(pointHref(item.point, item.pose.instance));
        }}
      />
      {snapshot ? (
        <>
          <span data-tone="caution">
            {compare ? "Now · comparing to" : "Recorded"}{" "}
            {new Date(snapshot.point.at).toLocaleString()}
          </span>
          <Button
            label="Compare to now"
            pressed={compare}
            onClick={() => {
              const search = address.read();
              if (compare) search.delete("compare");
              else search.set("compare", "now");
              address.write(search, "push");
            }}
          >
            Compare to now
          </Button>
          <Button label="Return to live" onClick={live}>
            Live
          </Button>
        </>
      ) : (
        <Button
          label="Capture point"
          refusal={document ? null : "Choose a document"}
          onClick={() => void capture()}
        >
          Capture
        </Button>
      )}
      {problem && (
        <span role="status" data-tone="caution">
          {problem}
        </span>
      )}
    </aside>
  );
}

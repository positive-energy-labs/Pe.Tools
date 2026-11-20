import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { z } from "zod";
import { historyPointSchema, historyListSchema, type Address } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ListView } from "@pe/kit/lang/list-view";
import { useList } from "@pe/kit/lang/collection";
import {
  historyRequest,
  historySnapshotSchema,
  pointHref,
  type HistorySnapshot,
} from "./history.ts";
import type { AdmittedAddressPort } from "./typed-address.ts";

/** Both shells resolve the recorded point before acquiring any live resources. */
export function HistoryBoundary({
  address,
  children,
}: {
  address: AdmittedAddressPort;
  children(snapshot?: HistorySnapshot): ReactNode;
}) {
  const search = useSyncExternalStore(
    address.subscribe,
    () => address.read().toString(),
    () => "",
  );
  const at = new URLSearchParams(search).get("at");
  const [loaded, setLoaded] = useState<{
    id: string;
    snapshot?: HistorySnapshot;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!at) return;
    let closed = false;
    void historyRequest(`?at=${encodeURIComponent(at)}`)
      .then((raw) => {
        if (!closed) setLoaded({ id: at, snapshot: historySnapshotSchema.parse(raw) });
      })
      .catch((error) => {
        if (!closed) setLoaded({ id: at, error: String(error) });
      });
    return () => {
      closed = true;
    };
  }, [at]);
  if (at && (loaded?.id !== at || !loaded.snapshot))
    return (
      <div role="status" data-tone="caution">
        {loaded?.id === at ? loaded.error : "Opening recorded point?"}
      </div>
    );
  return children(at ? loaded!.snapshot : undefined);
}

/** The recorded points of this route's document, drawn inside the Timeline popover: pick one, capture
 * one, or compare and return to live. Write receipts name the afterWrite rows; all point bindings
 * remain host-owned. */
export function RecordedPoints({
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
  const [unavailable, setUnavailable] = useState<z.infer<typeof historyListSchema>["unavailable"]>(
    [],
  );
  useEffect(() => {
    if (!document) return;
    let closed = false;
    const refresh = () =>
      void historyRequest(`?document=${encodeURIComponent(document)}`)
        .then((value) => {
          if (closed) return;
          const result = historyListSchema.parse(value);
          setRows(result.points);
          setUnavailable(result.unavailable);
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
      refusal: pose
        ? unavailable.find((item) => item.point === point.id && item.instance === pose.instance)
            ?.reason
        : "This route was never published at this point",
      label,
      id: `${point.id}:${pose?.instance ?? "unavailable"}`,
    }));
  });
  const list = useList({
    items,
    keyOf: (item) => item.id,
    search: (item) => ({ text: [item.label] }),
    select: "none",
  });
  return (
    <div>
      <ListView
        list={list}
        aria-label="Recorded points"
        maxHeight="min(24rem, 60vh)"
        row={(item) => ({
          label: (
            <a
              data-point={item.id}
              href={
                item.pose && !item.refusal ? pointHref(item.point, item.pose.instance) : undefined
              }
              aria-disabled={!!item.refusal}
            >
              {item.label}
            </a>
          ),
          meta: new Date(item.point.at).toLocaleString(),
          sub: item.refusal ? `Unavailable: ${item.refusal}` : undefined,
        })}
        empty={{ message: "No recorded points", exit: "Capture a point" }}
      />
      {snapshot ? (
        <>
          <span data-tone="caution">
            {compare ? "Now · comparing to" : "Recorded"}{" "}
            {new Date(snapshot.point.at).toLocaleString()}
          </span>
          <Button
            kind="quiet"
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
          <Button kind="quiet" label="Return to live" onClick={live}>
            Live
          </Button>
        </>
      ) : (
        <Button
          kind="quiet"
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
    </div>
  );
}

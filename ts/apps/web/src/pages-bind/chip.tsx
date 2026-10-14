import { useEffect, useState } from "react";
import type { PageTargetReading } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { openEventSource } from "#/readings";
import { peClient } from "#/host/pe-client";
import { readPageTarget } from "./client";

/** SPA chrome owns consent. Page code never draws or answers this control. */
export function PageBindingChip({ slug }: { slug: string }) {
  const [reading, setReading] = useState<PageTargetReading | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let retired = false;
    let generation = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const fresh = async () => {
      const attempt = ++generation;
      clearTimeout(expiry);
      setReading(null);
      try {
        const next = await readPageTarget(slug);
        if (retired || attempt !== generation) return;
        setReading(next);
        setRefusal(null);
        if (next.write?.kind === "rw")
          expiry = setTimeout(
            () => void fresh(),
            Math.max(0, Date.parse(next.write.expiresAt) - Date.parse(next.hostNow)) + 500,
          );
      } catch (error) {
        if (!retired && attempt === generation)
          setRefusal(error instanceof Error ? error.message : String(error));
      }
    };
    const events = openEventSource(
      peClient.url("page.events", {
        params: { slug },
        query: { after: Number.MAX_SAFE_INTEGER },
      }),
    );
    events.onopen = () => void fresh();
    events.addEventListener("head", () => void fresh());
    events.addEventListener("binding", () => void fresh());
    events.onerror = () => {
      generation++;
      clearTimeout(expiry);
      setReading(null);
    };
    void fresh();
    return () => {
      retired = true;
      clearTimeout(expiry);
      events.close();
    };
  }, [slug, version]);
  const write = reading?.write;
  const revoke = async () => {
    if (reading?.write?.kind !== "rw") return;
    const thread = reading.write.thread;
    setReading(null);
    try {
      const response = await peClient.response("scope.revoke", { params: { id: thread } });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRefusal(body?.error?.message ?? "rw revoke was refused");
        return;
      }
      setVersion((prior) => prior + 1);
    } catch {
      setRefusal("revoke outcome unknown; reopen the binding to read its current grant");
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label="Page binding">
      {write?.kind === "rw" ? (
        <Button
          label="Revoke Page rw"
          reason="Running steps finish; no new step begins."
          onClick={() => void revoke()}
          data-tone="done"
        >
          <span className="face-mono">
            rw · {Math.ceil((Date.parse(write.expiresAt) - Date.parse(reading!.hostNow)) / 60_000)}m
          </span>
        </Button>
      ) : (
        <span
          className="face-mono"
          title={write?.kind === "read" ? write.refusal.reason : (refusal ?? undefined)}
        >
          {write?.kind ?? "unverified"}
        </span>
      )}
      <a href={`/bind?page=${encodeURIComponent(slug)}`}>Bind…</a>
      {refusal && (
        <span role="status" data-tone="alarm">
          {refusal}
        </span>
      )}
    </div>
  );
}

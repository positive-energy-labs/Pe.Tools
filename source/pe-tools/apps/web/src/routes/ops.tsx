import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { hostOperations } from "@pe/host-generated/contracts";
import type { HostOperationDefinition } from "@pe/host-generated/contracts";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/ops")({ component: OpsPlayground });

const OPS = Object.values(hostOperations) as HostOperationDefinition[];

interface RunResult {
  ok: boolean;
  status: number;
  elapsedMs: number;
  body: unknown;
}

/** Mirror of host-client sendJson, browser-side, through the `/pe-host` dev proxy. */
async function callOp(op: HostOperationDefinition, args: unknown): Promise<RunResult> {
  let route = `/pe-host${op.route}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method: op.verb, headers };
  if (op.verb === "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries((args ?? {}) as Record<string, unknown>)) {
      if (v == null) continue;
      params.set(
        k,
        typeof v === "object" ? JSON.stringify(v) : String(v as string | number | boolean),
      );
    }
    const q = params.toString();
    if (q) route += `${route.includes("?") ? "&" : "?"}${q}`;
  } else {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(args ?? {});
  }
  const started = performance.now();
  const res = await fetch(route, init);
  const text = await res.text();
  const elapsedMs = Math.round(performance.now() - started);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, status: res.status, elapsedMs, body };
}

function OpsPlayground() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HostOperationDefinition | undefined>();
  const [args, setArgs] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ops = q
      ? OPS.filter((op) =>
          [op.key, op.displayName, op.description, ...(op.searchTerms ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : OPS;
    return [...ops].sort((a, b) => a.key.localeCompare(b.key));
  }, [query]);

  function select(op: HostOperationDefinition) {
    setSelected(op);
    setArgs(op.requestExamples?.[0]?.json ?? op.safeDefaultRequestJson ?? "{}");
    setResult(undefined);
    setError(undefined);
  }

  async function run() {
    if (!selected) return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const parsed = args.trim() ? JSON.parse(args) : undefined;
      setResult(await callOp(selected, parsed));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="grid h-screen grid-cols-[20rem_1fr] gap-0 bg-background text-foreground">
      {/* Op list */}
      <aside className="flex min-h-0 flex-col border-r border-border">
        <div className="border-b border-border p-2">
          <Input
            placeholder={`Search ${OPS.length} host ops…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {filtered.map((op) => (
            <li key={op.key}>
              <button
                onClick={() => select(op)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                  selected?.key === op.key && "bg-muted",
                )}
              >
                <div className="truncate text-xs font-medium">{op.displayName ?? op.key}</div>
                <div className="truncate font-mono text-[0.625rem] text-muted-foreground">
                  {op.key}
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">No ops match.</li>
          )}
        </ul>
      </aside>

      {/* Detail / runner */}
      <section className="min-h-0 overflow-y-auto p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Pick a host op. Calls proxy to Pe.Host via <code>/pe-host</code> (default{" "}
            <code>localhost:5180</code>). Start the host if requests 502.
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <header>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold">{selected.displayName ?? selected.key}</h1>
                <Badge>{selected.verb}</Badge>
                {selected.intent && <Badge>{selected.intent}</Badge>}
                {selected.costTier && <Badge>{selected.costTier}</Badge>}
                {selected.requiresBridge && <Badge>bridge</Badge>}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.route}</p>
              {selected.description && (
                <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
              )}
            </header>

            {(selected.requestShape?.length ?? 0) > 0 && (
              <div>
                <h2 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  Request fields
                </h2>
                <ul className="rounded-md border border-border text-xs">
                  {selected.requestShape!.map((f) => (
                    <li
                      key={f.name}
                      className="flex items-baseline gap-2 border-b border-border px-2 py-1 last:border-b-0"
                    >
                      <span className="font-mono font-medium">{f.name}</span>
                      <span className="font-mono text-muted-foreground">{f.type}</span>
                      {f.required && <span className="text-destructive">required</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase text-muted-foreground">
                  Arguments (JSON)
                </h2>
                {(selected.requestExamples?.length ?? 0) > 0 && (
                  <div className="flex gap-1">
                    {selected.requestExamples!.map((ex) => (
                      <Button
                        key={ex.name}
                        variant="ghost"
                        size="xs"
                        onClick={() => setArgs(ex.json)}
                        title={ex.description}
                      >
                        {ex.name}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <Textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                spellCheck={false}
                className="min-h-32 font-mono"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={run} disabled={running}>
                {running ? "Running…" : `Run ${selected.verb}`}
              </Button>
              {result && (
                <span
                  className={cn(
                    "text-xs",
                    result.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {result.status} · {result.elapsedMs}ms
                </span>
              )}
            </div>

            {error && (
              <pre className="overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </pre>
            )}
            {result && (
              <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
                {typeof result.body === "string"
                  ? result.body
                  : JSON.stringify(result.body, null, 2)}
              </pre>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, win32 } from "node:path";
import { Effect } from "effect";
import { NodeServices } from "@effect/platform-node";
import { z } from "zod";
import { productIdentity } from "@pe/host-contracts/contracts";
import type {
  Access,
  Machine,
  MachineAttachment,
  MachineHost,
  MachineLeg,
  MachinePeer,
  MachineProvider,
  MachineSession,
  MachineShare,
} from "@pe/agent-contracts";
import {
  docListArgv,
  doctorArgv,
  sessionListArgv,
  type DocListResult,
  type DoctorResult,
  type Envelope,
  type ProcessIdentity,
  type SessionListResult,
  type SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";
import { discoverService, readServiceFile } from "@pe/host-contracts/pe-service";
import { runPeRevitCli } from "./session-route.ts";
import { hostOwnership, productRoot } from "./host-ownership.ts";
import type { RevitBridge } from "./bridge.ts";
import type { Providers } from "./harness/providers.ts";
import { unreadLeg, type UpdateReader } from "./update-reader.ts";

export interface MachineShareAdapter {
  read(): Promise<MachineShare>;
  subscribe?(notify: () => void): () => void;
}
// TODO: wave 4 replaces this with the owner of the verified Serve mapping.
export const unavailableShare: MachineShareAdapter = {
  read: async () => ({
    desired: "off",
    allowRemoteAdministration: true,
    state: "unknown",
    url: null,
    refusal: { code: "share.not-configured", detail: "Serve adapter is not configured." },
    callers: [],
    refused: [],
  }),
};

export interface MachineSources {
  host(this: void): Promise<Omit<MachineHost, "peers">>;
  peers(this: void): Promise<readonly MachinePeer[]>;
  sessions(this: void): Promise<readonly SessionObservation[]>;
  documents(this: void, process: ProcessIdentity): Promise<DocListResult>;
  attachments(this: void): Promise<readonly MachineAttachment[]>;
  years(this: void): Promise<readonly number[]>;
  providers(
    this: void,
  ): Promise<{ providers: readonly MachineProvider[]; access: Access; readError?: string | null }>;
  readonly update: UpdateReader["Service"];
  readonly share: MachineShareAdapter;
  subscribe?(this: void, notify: () => void): () => void;
}

/** One clock, one in-flight refresh, full confirmed data retained independently of every leg. */
export function createMachine(
  sources: MachineSources,
  options: {
    now?: () => string;
    periodMs?: number;
    updatePeriodMs?: number;
    automaticUpdates?: { peaActive(): boolean; handoff(): void };
  } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  // The update feed is GitHub's API at 60 unauthenticated calls an hour: it has its own clock, read
  // at boot and every updatePeriodMs. Recheck and newly eligible automatic updates read explicitly.
  // The 5 s machine tick recovers receipts without reading the feed.
  const updatePeriodMs = options.updatePeriodMs ?? 30 * 60_000;
  let updateDueAt = 0;
  let yearsDueAt = 0;
  let noRevitSince: number | null = null;
  let eligibleBefore = false;
  let automaticPlan: string | null = null;
  const listeners = new Set<(value: Machine) => void>();
  let inFlight: Promise<Machine> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let release: (() => void) | undefined;
  let closed = false;
  let host: Omit<MachineHost, "peers"> | null = null;
  let peers: readonly MachinePeer[] = [];
  let sessions: readonly SessionObservation[] | null = null;
  let attachments: readonly MachineAttachment[] = [];
  let years: readonly number[] | null = null;
  let providers: readonly MachineProvider[] | null = null;
  let access: Access | null = null;
  let share: MachineShare | null = null;
  let legs: Record<string, MachineLeg> = {};
  const documents = new Map<string, { value: MachineSession["documents"]; leg: MachineLeg }>();
  let latest: Machine = {
    observedAtUtc: now(),
    host: null,
    revit: { years: null, sessions: null, unclassifiedAttachments: [] },
    update: sources.update.current(),
    share: null,
    providers: null,
    access: null,
    legs: {},
  };

  async function read<A>(key: string, acquire: () => Promise<A>, accept: (value: A) => void) {
    const attemptedAtUtc = now();
    try {
      accept(await acquire());
      legs[key] = { observedAtUtc: now(), attemptedAtUtc, error: null };
      return true;
    } catch (error) {
      legs[key] = { ...(legs[key] ?? unreadLeg()), attemptedAtUtc, error: String(error) };
      return false;
    }
  }

  function refresh(): Promise<Machine> {
    if (closed) return Promise.resolve(latest);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const [censusRead, attachmentsRead] = await Promise.all([
        read("sessions", sources.sessions, (value) => {
          sessions = value;
        }),
        read("attachments", sources.attachments, (value) => {
          attachments = value;
        }),
        read("host", sources.host, (value) => {
          host = value;
        }),
        read("peers", sources.peers, (value) => {
          peers = value;
        }),
        Date.now() >= yearsDueAt
          ? read(
              "years",
              () => {
                return sources.years().then((value) => {
                  yearsDueAt = Date.now() + updatePeriodMs;
                  return value;
                });
              },
              (value) => {
                years = value;
              },
            )
          : Promise.resolve(true),
        read("providers", sources.providers, (value) => {
          providers = value.providers;
          access = value.access;
          if (value.readError) throw Error(value.readError);
        }),
        read(
          "share",
          () => sources.share.read(),
          (value) => {
            share = value;
          },
        ),
        read(
          "update",
          () => {
            const checkFeed = Date.now() >= updateDueAt;
            if (checkFeed) updateDueAt = Date.now() + updatePeriodMs;
            return sources.update.refresh(checkFeed);
          },
          () => {},
        ),
      ]);
      const policy = options.automaticUpdates;
      if (
        !censusRead ||
        !attachmentsRead ||
        (sessions ?? []).some(
          (row) => row.case !== "gone-receipt" && row.case !== "failed-receipt",
        ) ||
        attachments.length ||
        sessions === null
      )
        noRevitSince = null;
      else noRevitSince ??= Date.now();
      const eligible =
        policy !== undefined &&
        noRevitSince !== null &&
        Date.now() - noRevitSince >= 120_000 &&
        !policy.peaActive();
      // A newly empty fleet or completed Pea turn needs a fresh plan, even inside the feed interval.
      if (eligible && !eligibleBefore) await sources.update.refresh(true);
      eligibleBefore = eligible;
      if (eligible && policy && !policy.peaActive() && !closed) {
        const update = sources.update.current();
        const plan = update.plan;
        if (
          plan?.available &&
          !plan.revits.length &&
          !plan.blockers.length &&
          !update.planLeg.error &&
          plan.planId !== automaticPlan &&
          (!update.requestId ||
            (update.receipt && ["ok", "failed", "refused"].includes(update.receipt.state)))
        ) {
          automaticPlan = plan.planId;
          await read(
            "automatic-update",
            () => sources.update.apply(plan.planId, true),
            (applied) => {
              if (
                applied.receipt?.state === "running" &&
                applied.receipt?.legs.some((leg) => leg.name === "handoff" && leg.status === "ok")
              )
                policy.handoff();
            },
          );
        }
      }
      if (censusRead)
        await Promise.all(
          (sessions ?? []).map(async (row) => {
            const process = processOf(row);
            if (!process) return;
            const key = processKey(process);
            if (row.case === "controlled-active") {
              const previous = documents.get(key) ?? { value: null, leg: unreadLeg() };
              documents.set(
                key,
                row.bridge.bridge === "ready"
                  ? {
                      value: row.bridge.documents,
                      leg: { observedAtUtc: row.observedAtUtc, attemptedAtUtc: now(), error: null },
                    }
                  : {
                      ...previous,
                      leg: {
                        ...previous.leg,
                        attemptedAtUtc: now(),
                        error: "SDK bridge is not answering.",
                      },
                    },
              );
            } else if (row.case === "observed-active") {
              const previous = documents.get(key) ?? { value: null, leg: unreadLeg() };
              const attemptedAtUtc = now();
              try {
                const result = await sources.documents(process);
                documents.set(key, {
                  value: result.documents.map((doc) => ({ ...doc, persistence: null })),
                  leg: { observedAtUtc: now(), attemptedAtUtc, error: null },
                });
              } catch (error) {
                documents.set(key, {
                  ...previous,
                  leg: { ...previous.leg, attemptedAtUtc, error: String(error) },
                });
              }
            }
          }),
        );
      const classified = new Set<MachineAttachment>();
      const rows =
        sessions?.map((row): MachineSession => {
          const process = processOf(row);
          const matched = process
            ? attachments.filter((attachment) => matches(attachment, process))
            : [];
          const attachment = matched.length === 1 ? matched[0]! : null;
          if (attachment) classified.add(attachment);
          const held = process ? documents.get(processKey(process)) : undefined;
          return {
            row,
            attachment,
            documents: held?.value ?? null,
            documentsLeg: held?.leg ?? unreadLeg(),
          };
        }) ?? null;
      // Receipt/gone rows cannot keep old documents or classify a socket as currently attached.
      const currentKeys = new Set(
        (sessions ?? []).flatMap((row) => {
          const process = processOf(row);
          return process ? [processKey(process)] : [];
        }),
      );
      for (const key of documents.keys()) if (!currentKeys.has(key)) documents.delete(key);
      latest = {
        observedAtUtc: now(),
        host: host ? { ...host, peers } : null,
        revit: {
          years,
          sessions: rows,
          unclassifiedAttachments: attachments.filter((attachment) => !classified.has(attachment)),
        },
        update: sources.update.current(),
        share,
        providers,
        access,
        legs: { ...legs },
      };
      if (!closed) for (const accept of listeners) accept(latest);
      return latest;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  function observe(accept: (value: Machine) => void) {
    if (closed) throw Error("Machine owner is retired.");
    listeners.add(accept);
    if (latest.legs.sessions) accept(latest);
    if (listeners.size === 1) {
      const notify = () => {
        void refresh();
      };
      const unwatch = sources.subscribe?.(notify);
      const unshare = sources.share.subscribe?.(notify);
      release = () => {
        unwatch?.();
        unshare?.();
      };
      timer = setInterval(notify, options.periodMs ?? 5_000);
      void refresh();
    }
    return () => {
      listeners.delete(accept);
      if (!listeners.size) {
        clearInterval(timer);
        release?.();
        release = undefined;
      }
    };
  }
  return {
    refresh,
    observe,
    current: () => latest,
    close: () => {
      closed = true;
      clearInterval(timer);
      release?.();
      listeners.clear();
    },
  };
}
export type MachineOwner = ReturnType<typeof createMachine>;

function processOf(row: SessionObservation): ProcessIdentity | null {
  return row.case === "controlled-active" || row.case === "observed-active"
    ? row.process
    : row.case === "controlled-pending" && row.attempt.attempt === "launched"
      ? row.attempt.process
      : null;
}
const processKey = (process: ProcessIdentity) => `${process.pid}:${process.processStartUtc}`;
const matches = (attachment: MachineAttachment, process: ProcessIdentity) =>
  attachment.pid === process.pid &&
  attachment.processStartUtcUnixMs !== null &&
  attachment.processStartUtcUnixMs === Date.parse(process.processStartUtc);

async function sdk<A>(args: string[], acceptedExitCodes = [0]): Promise<Envelope<A>> {
  const stdout = await Effect.runPromise(
    runPeRevitCli(args).pipe(Effect.timeout(60_000), Effect.provide(NodeServices.layer)),
  );
  const envelope = JSON.parse(stdout) as Envelope<A>;
  if (!acceptedExitCodes.includes(envelope.exitCode))
    throw Error(
      envelope.diagnostics.map((d) => `${d.code}: ${d.detail}`).join("; ") ||
        `SDK exit ${envelope.exitCode}`,
    );
  return envelope;
}

export function machineSources(
  bridge: RevitBridge["Service"] | undefined,
  providers: Providers,
  update: UpdateReader["Service"],
  share: MachineShareAdapter = unavailableShare,
): MachineSources {
  return {
    host: async () => {
      const file = await readServiceFile(productRoot(), hostOwnership.serviceName);
      if (!file || file.pid !== process.pid)
        throw Error("This host has no matching SDK service identity.");
      return {
        serviceName: hostOwnership.serviceName,
        instanceId: file.instanceId,
        version: file.version,
        payload: hostOwnership.lane === "dev" ? "checkout" : "installed",
        process: { pid: file.pid, processStartUtc: file.processStartUtc },
        port: file.port,
        startedBy: null,
        autostart: await readAutostart(hostOwnership.executablePath),
        sourceRoot: file.sourceRoot ?? null,
        uptimeSeconds: process.uptime(),
        canonicalUrl: `http://127.0.0.1:${file.port}`,
      };
    },
    peers: () => readMachinePeers(productRoot(), hostOwnership.serviceName),
    sessions: async () => {
      const { result } = await sdk<SessionListResult>(sessionListArgv({ all: true }));
      if (!Array.isArray(result.sessions)) throw Error("SDK session census has no sessions array.");
      if (!Array.isArray(result.processReadErrors))
        throw Error("SDK session census has no process read evidence.");
      if (result.processReadErrors.length)
        throw Error(
          `SDK process census incomplete: ${result.processReadErrors
            .map((error) => `PID ${error.candidatePid}: ${error.detail}`)
            .join("; ")}`,
        );
      return result.sessions;
    },
    documents: async (process) => {
      const envelope = await sdk<DocListResult>(docListArgv({ pid: process.pid }));
      if (
        envelope.resolved?.pid !== process.pid ||
        envelope.resolved.processStartUtc !== process.processStartUtc
      )
        throw Error("Document read resolved a different process incarnation.");
      const result = z
        .object({
          state: z.literal("ok"),
          documents: z.array(
            z.object({
              sessionId: z.string(),
              openId: z.string().nullable(),
              title: z.string().nullable(),
              path: z.string().nullable(),
              isModified: z.boolean(),
              isActive: z.boolean(),
              isFamily: z.boolean(),
              window: z.string().nullable(),
            }),
          ),
        })
        .parse(envelope.result);
      return result;
    },
    attachments: async () =>
      bridge
        ? (await Effect.runPromise(bridge.list)).flatMap((view) =>
            view.connected && view.sessionId && view.processId
              ? [
                  {
                    session: view.sessionId,
                    pid: view.processId,
                    processStartUtcUnixMs: view.processStartUtcUnixMs ?? null,
                    documents: view.state
                      ? view.state.openDocuments.map((doc) => ({
                          session: view.sessionId!,
                          openId: doc.openId,
                        }))
                      : null,
                  },
                ]
              : [],
          )
        : [],
    // Doctor can report unrelated wiring refusals while still identifying installed years.
    years: async () =>
      (await sdk<DoctorResult>(doctorArgv({ timeoutSeconds: 20 }), [0, 3])).result.revitYears.map(
        (year) => {
          const number = Number(year);
          if (!Number.isInteger(number)) throw Error(`Invalid SDK Revit year ${year}`);
          return number;
        },
      ),
    providers: () => providers.snapshot(),
    update,
    share,
    subscribe: (notify) => {
      const unbridge = bridge?.subscribe(() => notify());
      const unproviders = providers.subscribe(notify);
      return () => {
        unbridge?.();
        unproviders();
      };
    },
  };
}

/** Read/discover only: stale files remain visible and no display sweeps another host's record. */
export async function readMachinePeers(
  appBase: string,
  ownServiceName: string,
): Promise<readonly MachinePeer[]> {
  const names = await readdir(join(appBase, "state", "service")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const rows = await Promise.all(
    names
      .filter((name) => name.startsWith("host-source-") && name.endsWith(".json"))
      .map(async (filename) => {
        const serviceName = filename.slice(0, -5);
        if (serviceName === ownServiceName) return null;
        const file = await readServiceFile(appBase, serviceName);
        if (!file || file.lane !== "dev") return null;
        const live = await discoverService(appBase, serviceName, { verifyOwner: true });
        let reachable = false;
        if (live?.instanceId === file.instanceId && file.health) {
          const url = new URL(file.health, `http://127.0.0.1:${file.port}`);
          if (url.origin === `http://127.0.0.1:${file.port}`)
            reachable = await fetch(url, {
              signal: AbortSignal.timeout(2_000),
              redirect: "error",
            }).then(
              (r) => r.ok,
              () => false,
            );
        }
        return {
          serviceName,
          instanceId: file.instanceId,
          version: file.version,
          sourceRoot: file.sourceRoot ?? null,
          process: { pid: file.pid, processStartUtc: file.processStartUtc },
          url: `http://127.0.0.1:${file.port}`,
          reachable,
        } satisfies MachinePeer;
      }),
  );
  return rows.filter((row): row is MachinePeer => row !== null);
}

/** Read Windows' Run and StartupApproved values; never enable an entry the user disabled. */
async function readAutostart(executablePath: string): Promise<MachineHost["autostart"]> {
  if (process.platform !== "win32" || hostOwnership.lane !== "installed") return null;
  const name = productIdentity.productName.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $r=Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue; $a=Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' -ErrorAction SilentlyContinue; $command=if($r){$r.GetValue('${name}')}else{$null}; $approved=if($a){$a.GetValue('${name}')}else{$null}; [pscustomobject]@{command=$command;approved=$approved} | ConvertTo-Json -Compress`;
  try {
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 3_000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
    const entry = z
      .object({ command: z.string().nullable(), approved: z.array(z.number()).nullable() })
      .parse(JSON.parse(stdout));
    const image = entry.command && /^"?(.+?\.exe)"?(?:\s|$)/i.exec(entry.command)?.[1];
    if (
      !image ||
      win32.normalize(image).toLowerCase() !== win32.normalize(executablePath).toLowerCase()
    )
      return "off";
    const approval = entry.approved?.[0];
    if (approval === 3 || approval === 7) return "disabled-in-windows";
    return approval === undefined || approval === 2 || approval === 6 ? "on" : null;
  } catch {
    return null;
  }
}

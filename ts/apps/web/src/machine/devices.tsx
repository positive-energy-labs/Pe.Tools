import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import type { Column } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import QRCode from "qrcode";
import type { DeviceListing, Pairing } from "@pe/host-contracts/pe-api";
import { peClient } from "#/host/pe-client";
import { LoadingContext } from "#/route/loading-context";
import { HOST_READ_WAIT_S } from "#/route/waits";
import { useFixtureName } from "#/shell/fixture-services";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LocalDevice = createContext(true);
export const useLocalDevice = () => useContext(LocalDevice);
type DeviceSession = DeviceListing["sessions"][number];
const endedDevice = (session: DeviceSession) =>
  session.revokedAt ? "Revoked" : Date.parse(session.expiresAt) <= Date.now() ? "Expired" : null;

export function DeviceSettings({
  refusal,
  remoteUrl,
  allowRemoteAdministration,
}: {
  refusal: string | null;
  remoteUrl: string | null;
  allowRemoteAdministration: boolean;
}) {
  const [listing, setListing] = useState<DeviceListing | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const refresh = () => peClient.call("device.list", {}).then(setListing);
  useEffect(() => {
    if (refusal) return;
    void refresh().catch((error) => setError(message(error)));
    const timer = setInterval(
      () => void refresh().catch((error) => setError(message(error))),
      5000,
    );
    return () => clearInterval(timer);
  }, [refusal]);
  const act = (work: () => Promise<unknown>) =>
    startTransition(async () => {
      setError(null);
      try {
        await work();
        await refresh();
      } catch (error) {
        setError(message(error));
      }
    });
  const unavailable = refusal ?? (pending ? "Waiting for the host." : null);
  const columns: Column<DeviceSession>[] = [
    {
      key: "device",
      label: "Device",
      cell: (session) => <DeviceName session={session} refusal={unavailable} act={act} />,
    },
    {
      key: "transport",
      label: "Transport",
      cell: (session) => <span className="face-mono">{session.transports.join(" / ")}</span>,
    },
    {
      key: "lastSeen",
      label: "Last seen",
      cell: (session) => (
        <span className="text-ink-2">
          {session.lastSeenAt
            ? new Date(session.lastSeenAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Not yet"}
        </span>
      ),
    },
    {
      key: "writes",
      label: "Writes",
      cell: (session) => (
        <span data-tone={session.writes && !endedDevice(session) ? "commit" : undefined}>
          {endedDevice(session) ??
            (session.audience === "browser"
              ? allowRemoteAdministration
                ? "Can add documents"
                : "Consent off"
              : session.writes
                ? "Thread documents"
                : "Read only")}
        </span>
      ),
    },
    {
      key: "revoke",
      label: "Actions",
      header: <span className="sr-only">Actions</span>,
      right: true,
      cell: (session) =>
        !endedDevice(session) && (
          <Button
            label={`Revoke ${session.label}`}
            refusal={unavailable}
            onClick={() =>
              act(() => peClient.call("device.revoke", { params: { id: session.id } }))
            }
          >
            Revoke
          </Button>
        ),
    },
  ];
  return (
    <section className="flex flex-col gap-4 hairline-t pt-5" aria-label="Paired devices">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-title">Devices</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            kind="framed"
            label="Pair browser"
            refusal={unavailable}
            onClick={() =>
              act(async () =>
                setPairing(await peClient.call("device.pair", { body: { audience: "browser" } })),
              )
            }
          >
            Pair browser
          </Button>
          <Button
            kind="framed"
            label="Pair MCP client"
            refusal={unavailable}
            onClick={() =>
              act(async () =>
                setPairing(await peClient.call("device.pair", { body: { audience: "mcp" } })),
              )
            }
          >
            Pair MCP client
          </Button>
        </div>
      </div>
      {pairing && <PairingInvite pairing={pairing} remoteUrl={remoteUrl} />}
      {listing?.sessions.length === 0 && (
        <p>No paired devices. Pair a browser or MCP client above.</p>
      )}
      {!!listing?.sessions.length && (
        <Table
          rows={listing.sessions}
          columns={columns}
          rowKey={(session) => session.id}
          label="Device sessions"
          maxHeight="none"
        />
      )}
      {listing && (
        <details className="t-small text-ink-2">
          <summary>Environment</summary>
          <p className="face-mono break-all">{listing.environmentId}</p>
        </details>
      )}
      {error && (
        <p role="alert" data-tone="caution">
          {error}
        </p>
      )}
    </section>
  );
}

function PairingInvite({ pairing, remoteUrl }: { pairing: Pairing; remoteUrl: string | null }) {
  const [now, setNow] = useState(Date.now());
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expired = now >= Date.parse(pairing.expiresAt);
  const url = remoteUrl ? `${new URL("/", remoteUrl).href}#pair=${pairing.code}` : null;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let current = true;
    setQr(null);
    setError(null);
    if (url)
      void QRCode.toDataURL(url, { width: 180, margin: 4, errorCorrectionLevel: "M" })
        .then((data) => {
          if (current) setQr(data);
        })
        .catch((error) => {
          if (current) setError(message(error));
        });
    return () => {
      current = false;
    };
  }, [url]);
  return (
    <div className="flex flex-wrap items-center gap-6 hairline-y py-4" aria-label="Pairing code">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="t-small text-ink-2">
          Pair one {pairing.audience === "browser" ? "browser" : "MCP client"}
        </p>
        {expired ? (
          <p>Code expired. Create a new code above.</p>
        ) : (
          <>
            <p className="t-display face-mono" data-pairing-code={pairing.code}>
              {pairing.code.slice(0, 4)} {pairing.code.slice(4)}
            </p>
            <p>Scan the QR or enter this code on the other device.</p>
            <p className="t-small text-ink-2">
              Expires in {Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000))}s ·
              single use · five attempts
            </p>
            {url ? (
              <a className="t-small face-mono break-all" href={url}>
                Open pairing link
              </a>
            ) : (
              <p className="t-small text-ink-2">Turn on sharing to get a scannable remote link.</p>
            )}
          </>
        )}
        {error && <p role="alert">QR unavailable: {error}. Enter the code instead.</p>}
      </div>
      {!expired && qr && <img src={qr} width={180} height={180} alt="Scan to pair this device" />}
    </div>
  );
}

function DeviceName({
  session,
  refusal,
  act,
}: {
  session: DeviceSession;
  refusal: string | null;
  act: (work: () => Promise<unknown>) => void;
}) {
  const [thread, setThread] = useState(session.thread ?? "");
  return (
    <div className="py-2">
      <p>{session.label}</p>
      <span className="t-small text-ink-2">{session.audience}</span>
      {session.audience === "mcp" && !endedDevice(session) && (
        <details className="t-small mt-1">
          <summary>{session.thread ? "Thread binding" : "Bind a thread"}</summary>
          <div className="flex flex-wrap items-center gap-2 py-2">
            <Input
              aria-label={`Thread for ${session.label}`}
              value={thread}
              onChange={(event) => setThread(event.target.value)}
              placeholder="Thread id"
            />
            <Button
              label={`Bind thread for ${session.label}`}
              refusal={refusal}
              onClick={() =>
                act(() =>
                  peClient.call("device.bind", {
                    params: { id: session.id },
                    body: { thread: thread.trim() || null },
                  }),
                )
              }
            >
              Bind
            </Button>
          </div>
          <p className="text-ink-2">
            Writes the documents a person added to the thread. Clear to return to read-only.
          </p>
        </details>
      )}
    </div>
  );
}

function DevicePairing({
  environmentId,
  connected,
}: {
  environmentId: string;
  connected: () => void;
}) {
  const [code, setCode] = useState(() => pairingCode(window.location.href));
  const [label, setLabel] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (new URLSearchParams(window.location.hash.slice(1)).has("pair"))
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  const pair = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await peClient.call("device.claim", {
          body: { code: code.trim(), label: label.trim() },
        });
        setCode("");
        if (result.token) setToken(result.token);
        else connected();
      } catch (error) {
        setError(message(error));
      }
    });
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-12"
      aria-label="Pair this device"
    >
      <div className="flex flex-col gap-2">
        <h1 className="t-head">Pair with Pea</h1>
        <p className="text-ink-2">Ask the person at the host for a code, or scan their QR.</p>
      </div>
      <label className="flex flex-col gap-2">
        Device name
        <Input
          aria-label="Device name"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-2">
        Pairing code
        <Input
          aria-label="Pairing code"
          value={code}
          onChange={(event) => setCode(pairingCode(event.target.value))}
          autoComplete="off"
          placeholder="8-character code or pairing link"
        />
      </label>
      <Button
        kind="framed"
        label="Pair device"
        refusal={
          pending
            ? "Pairing with the host."
            : !label.trim() || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)
              ? "Enter the device name and pairing code."
              : null
        }
        onClick={() => pair()}
      >
        Pair device
      </Button>
      {token && (
        <div className="flex flex-col gap-1">
          <p>
            MCP credential, shown once. Configure your client with Authorization: Bearer and this
            value. The host can revoke it in Sharing settings.
          </p>
          <p className="face-mono break-all">{token}</p>
        </div>
      )}
      <p className="t-small text-ink-2">
        Reading a shared Page or capture does not pair a device or grant host control.
      </p>
      <details className="t-small text-ink-2">
        <summary>Environment</summary>
        <p className="face-mono break-all">Environment {environmentId}</p>
      </details>
      {error && (
        <p role="alert" data-tone="caution">
          {error}
        </p>
      )}
    </section>
  );
}

function pairingCode(input: string): string {
  try {
    const url = new URL(input);
    return (new URLSearchParams(url.hash.slice(1)).get("pair") ?? "").toUpperCase();
  } catch {
    return input.toUpperCase().replace(/[\s-]/g, "");
  }
}

type DeviceGateProps = {
  name: string;
  guidance: ReactNode;
  children: ReactNode;
};
export function RemoteDeviceGate(props: DeviceGateProps) {
  const fixture = useFixtureName();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return fixture !== null ? (
    mounted ? (
      <LocalDevice.Provider value={true}>{props.children}</LocalDevice.Provider>
    ) : (
      <LoadingContext name={props.name} says="Loading fixture…">
        {props.guidance}
      </LoadingContext>
    )
  ) : (
    <HostDeviceGate {...props} />
  );
}

function HostDeviceGate({ name, guidance, children }: DeviceGateProps) {
  const [state, setState] = useState<{
    environmentId: string;
    paired: boolean;
    local: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    // Unanswered past the host-read wait, the gate says so and offers Retry, never an endless wait.
    void peClient
      .call("device.environment", {}, { signal: AbortSignal.timeout(HOST_READ_WAIT_S * 1000) })
      .then((next) => current && setState(next))
      .catch(
        (error) =>
          current &&
          setError(
            error instanceof DOMException && error.name === "TimeoutError"
              ? `No answer from this host after ${HOST_READ_WAIT_S}s.`
              : message(error),
          ),
      );
    return () => {
      current = false;
    };
  }, [attempt]);
  if (!state)
    return (
      <LoadingContext name={name} says="Connecting to this host…" error={error}>
        {error ? (
          <Button
            label="Retry host connection"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry connection
          </Button>
        ) : null}
        {guidance}
        <noscript>Enable JavaScript to connect. This public guide remains readable.</noscript>
      </LoadingContext>
    );
  if (!state.local && !state.paired)
    return (
      <>
        {guidance}
        <DevicePairing
          environmentId={state.environmentId}
          connected={() => window.location.reload()}
        />
      </>
    );
  return <LocalDevice.Provider value={state.local}>{children}</LocalDevice.Provider>;
}

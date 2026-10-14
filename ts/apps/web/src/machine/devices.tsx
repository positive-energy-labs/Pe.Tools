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
import type { DeviceListing, DeviceSession, Pairing } from "@pe/host-contracts/pe-api";
import { peClient } from "#/host/pe-client";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LocalDevice = createContext(true);
export const useLocalDevice = () => useContext(LocalDevice);

export function DeviceSettings({ refusal }: { refusal: string | null }) {
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
  return (
    <section className="flex flex-col gap-3" aria-label="Paired devices">
      <p>Devices paired with this host</p>
      {listing && <p className="face-mono break-all">Environment {listing.environmentId}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
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
      {pairing && (
        <div className="flex flex-col gap-1" aria-label="Pairing code">
          <p>
            Approve one {pairing.audience === "browser" ? "browser" : "MCP client"} by giving it
            this code.
          </p>
          <p className="face-mono break-all">{pairing.code}</p>
          <p>
            Open this host on the other device and enter the code. It expires at{" "}
            {new Date(pairing.expiresAt).toLocaleTimeString()} and works once. A new code replaces
            it.
          </p>
          {pairing.audience === "mcp" && (
            <p>
              The pairing screen returns a bearer credential for /mcp. Pairing starts read-only;
              bind a thread below to use its rw grant.
            </p>
          )}
        </div>
      )}
      {listing?.sessions.length === 0 && (
        <p>No paired devices. Pair a browser or MCP client above.</p>
      )}
      <div className="flex flex-col gap-3 hairline-rows">
        {listing?.sessions.map((session) => (
          <DeviceRow key={session.id} session={session} refusal={unavailable} act={act} />
        ))}
      </div>
      {error && (
        <p role="alert" data-tone="caution">
          {error}
        </p>
      )}
    </section>
  );
}

function DeviceRow({
  session,
  refusal,
  act,
}: {
  session: DeviceSession;
  refusal: string | null;
  act: (work: () => Promise<unknown>) => void;
}) {
  const [thread, setThread] = useState(session.thread ?? "");
  const ended = session.revokedAt
    ? "Revoked"
    : Date.parse(session.expiresAt) <= Date.now()
      ? "Expired"
      : null;
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span>{session.label}</span>
        <span className="text-ink-2">
          {session.audience} · {session.transports.join(" / ")}
        </span>
        {ended ? (
          <span>{ended}</span>
        ) : (
          <Button
            label={`Revoke ${session.label}`}
            refusal={refusal}
            onClick={() =>
              act(() => peClient.call("device.revoke", { params: { id: session.id } }))
            }
          >
            Revoke
          </Button>
        )}
      </div>
      <span className="face-mono break-all">{session.id}</span>
      <span className="text-ink-2">
        {session.lastSeenAt
          ? `Last seen ${new Date(session.lastSeenAt).toLocaleString()}`
          : "No requests yet"}{" "}
        · expires {new Date(session.expiresAt).toLocaleDateString()}
      </span>
      {session.audience === "mcp" && !ended && (
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Thread holding rw
            <Input
              aria-label={`Thread for ${session.label}`}
              value={thread}
              onChange={(event) => setThread(event.target.value)}
              placeholder="Thread id; empty means read-only"
            />
          </label>
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
            Bind thread
          </Button>
          <span>
            {session.thread
              ? `Uses thread ${session.thread}'s current grant. Human messages renew it.`
              : "Read-only"}
          </span>
        </div>
      )}
    </div>
  );
}

export function DevicePairing({
  environmentId,
  connected,
}: {
  environmentId: string;
  connected: () => void;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    <section className="flex flex-col gap-3 p-6" aria-label="Pair this device">
      <p>Pair this device with Pea</p>
      <p className="face-mono break-all">Environment {environmentId}</p>
      <p>
        A human at the host opens Sharing settings and approves a browser or MCP client. Enter that
        code here.
      </p>
      <label>
        Device name
        <Input
          aria-label="Device name"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </label>
      <label>
        Pairing code
        <Input
          aria-label="Pairing code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
        />
      </label>
      <Button
        label="Pair device"
        refusal={
          pending
            ? "Pairing with the host."
            : !label.trim() || !code.trim()
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
      <p>Reading a shared Page or capture does not pair a device or grant host control.</p>
      {error && (
        <p role="alert" data-tone="caution">
          {error}
        </p>
      )}
    </section>
  );
}

export function RemoteDeviceGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    environmentId: string;
    paired: boolean;
    local: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void peClient
      .call("device.environment", {})
      .then(setState)
      .catch((error) => setError(message(error)));
  }, []);
  if (error)
    return (
      <p role="alert" className="p-6">
        {error}
      </p>
    );
  if (!state) return <p className="p-6">Connecting to this host…</p>;
  if (!state.local && !state.paired)
    return (
      <DevicePairing
        environmentId={state.environmentId}
        connected={() => window.location.reload()}
      />
    );
  return <LocalDevice.Provider value={state.local}>{children}</LocalDevice.Provider>;
}

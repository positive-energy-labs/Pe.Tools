/** Existing Windows startup observation and browser install capability. */
import { useEffect, useState } from "react";
import type { Machine } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { useSurfaceHost } from "#/navigation/surface-host";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPrompt = Event & {
  prompt: () => Promise<InstallChoice | void>;
  userChoice?: Promise<InstallChoice>;
};
type InstallStatus = "waiting" | "accepted" | "dismissed" | "installed" | "failed" | null;
export function StartupSettings({
  machine,
  fixture,
}: {
  machine: Machine | null;
  fixture: boolean;
}) {
  const host = useSurfaceHost();
  const [edge, setEdge] = useState(false);
  useEffect(() => setEdge(/\bEdg\//.test(navigator.userAgent)), []);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [status, setStatus] = useState<InstallStatus>(null);
  useEffect(() => {
    if (fixture || host.native || host.surface === "tray") return;
    const capture = (event: Event) => {
      event.preventDefault();
      if (!edge) return;
      setPrompt(event as InstallPrompt);
      setStatus(null);
    };
    const installed = () => {
      if (!edge) return;
      setPrompt(null);
      setStatus("installed");
    };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, [edge, fixture, host.native, host.surface]);
  const install = async () => {
    if (!prompt) return;
    const offered = prompt;
    setPrompt(null);
    setStatus("waiting");
    try {
      const result = await offered.prompt();
      const choice = offered.userChoice ? await offered.userChoice : result;
      setStatus((prior) =>
        prior === "installed" ? prior : choice?.outcome === "dismissed" ? "dismissed" : "accepted",
      );
    } catch {
      setStatus((prior) => (prior === "installed" ? prior : "failed"));
    }
  };
  const autostart = machine?.host?.autostart;
  return (
    <div className="flex flex-col gap-2" aria-label="startup settings">
      <p>
        Start at login:{" "}
        {autostart === "disabled-in-windows" ? "off in Windows" : (autostart ?? "unread")}.
      </p>
      <p className="text-ink-2">
        Windows Settings › Apps › Startup owns this switch. The installed host reports its current
        value here.
      </p>
      {host.surface === "tray" && (
        <p className="text-ink-2">
          Pages the tray does not hold open in an Edge app window. To install Pe.Tools as an app,
          open Settings › Host in that window.
        </p>
      )}
      {!fixture && !host.native && host.surface !== "tray" && (
        <>
          <p className="text-ink-2">
            {!edge
              ? "Open this address in Microsoft Edge and install there. Other Chromium browsers create separate Windows app entries. "
              : host.surface === "pwa"
                ? "This is an app window. "
                : "Install Pe.Tools in this Edge profile. "}
            {!edge
              ? ""
              : prompt
                ? "Use Install in Edge below. "
                : host.surface === "web"
                  ? "If no install button appears, use Edge menu > Apps > Install this site as an app. "
                  : "Edge manages its installation in this profile. "}
            Then choose Pin to taskbar in Edge's app options. Installation and pinning are separate
            choices.
          </p>
          {status && (
            <p role="status">
              {status === "installed"
                ? "App installation completed in this Edge profile. Taskbar pinning remains your choice in Edge."
                : status === "dismissed"
                  ? "Installation dismissed. The app was not installed."
                  : status === "failed"
                    ? "The browser could not show the install prompt. Use the Edge menu to install the app."
                    : status === "accepted"
                      ? "Install request accepted. Waiting for the browser to confirm completion."
                      : "Waiting for your choice in the browser install prompt."}
            </p>
          )}
        </>
      )}
      {prompt && !fixture && !host.native && host.surface === "web" && status !== "installed" && (
        <Button label="Install in Edge" kind="framed" onClick={() => void install()}>
          Install in Edge
        </Button>
      )}
    </div>
  );
}

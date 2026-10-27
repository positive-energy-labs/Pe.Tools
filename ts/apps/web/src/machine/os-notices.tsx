/**
 * The OS notification fallback: a web surface (browser tab or installed PWA) that is open while the
 * tray is not following raises the host's card items as operating-system notifications. It follows
 * the same `notices` Reading from its own persisted cursor and applies the same policy as the card:
 * quiet for the thread the person is looking at, a revision once acknowledged, and a snoozed item. With
 * the tray following, the tray's card speaks and this stays silent. It is opt-in, because the browser
 * grants notifications only on a person's gesture.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { MachineNotice } from "@pe/agent-contracts";

import { SwitchRow } from "@pe/kit/lang/switch-row";
import { useSurfaceHost } from "#/navigation/surface-host";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { peClient } from "#/host/pe-client";

/** Each mount has its own caller id, so tabs and the flyout cannot erase one another. */
export function useThreadPresence(thread: string | null) {
  useEffect(() => {
    if (!thread) return;
    const caller = crypto.randomUUID();
    const send = (visible: boolean, focused: boolean) =>
      void peClient
        .call("notices.presence", {
          params: { caller },
          body: { thread, visible, focused },
        })
        .catch(() => {}); // A lost beat expires on the host.
    const beat = () => send(document.visibilityState === "visible", document.hasFocus());
    beat();
    const timer = setInterval(beat, 5_000);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("focus", beat);
    window.addEventListener("blur", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("focus", beat);
      window.removeEventListener("blur", beat);
      send(false, false);
    };
  }, [thread]);
}

import { followNotices } from "./notice-follow";
import {
  acknowledge,
  admit,
  currentView,
  loadLedger,
  saveLedger,
  wake,
  type NoticeLedger,
} from "./notice-policy";

const ENABLED = "pe.notices.os";
const CURSOR = "pe.notices.os-cursor";
const WAKE_MS = 30_000;
const BODY = 240;

const listeners = new Set<() => void>();
const supported = () => typeof Notification !== "undefined";
const enabled = () =>
  supported() &&
  Notification.permission === "granted" &&
  window.localStorage.getItem(ENABLED) === "on";
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** On a person's gesture: ask the browser, and keep the answer only if it was yes. */
export async function setOsNotices(on: boolean): Promise<"on" | "off" | "denied" | "unsupported"> {
  if (!supported()) return "unsupported";
  let answer: "on" | "off" | "denied" = on ? "on" : "off";
  if (on && Notification.permission !== "granted")
    answer = (await Notification.requestPermission()) === "granted" ? "on" : "denied";
  window.localStorage.setItem(ENABLED, answer === "on" ? "on" : "off");
  listeners.forEach((listener) => listener());
  return answer;
}

export function OsNotices() {
  const host = useSurfaceHost();
  const on = useSyncExternalStore(subscribe, enabled, () => false);
  // The tray's own WebView is the card; a native shell has its own delivery.
  const follows = on && host.surface !== "tray" && !host.native;
  useEffect(() => {
    if (!follows) return;
    let tray = false;
    let ledger: NoticeLedger = loadLedger(window.localStorage);
    const keep = (change: (l: NoticeLedger) => NoticeLedger) => {
      ledger = change(loadLedger(window.localStorage));
      saveLedger(window.localStorage, ledger);
    };
    const deliver = (notice: MachineNotice) => {
      if (tray) return;
      ledger = loadLedger(window.localStorage);
      const verdict = admit(ledger, notice, currentView(), Date.now());
      if (verdict === "looking") return keep((l) => acknowledge(l, notice));
      if (verdict !== "show") return;
      const os = new Notification(notice.title, {
        body: notice.body.slice(0, BODY),
        tag: notice.id,
      });
      os.onclick = () => {
        window.focus();
        if (notice.href) window.location.assign(notice.href);
        os.close();
      };
      keep((l) => acknowledge(l, notice));
    };
    const raise = (notice: MachineNotice) => {
      // A shared cursor cannot arbitrate two windows that already received the same event.
      // Web Locks serializes delivery, and each winner rereads the durable acknowledgement.
      if (navigator.locks)
        void navigator.locks.request(`pe.notice.${notice.id}`, () => deliver(notice));
      else deliver(notice);
    };
    const stored = window.localStorage.getItem(CURSOR);
    const stop = followNotices({
      origin: resolveWorkbenchConfig().origin,
      cursor: stored === null || !Number.isSafeInteger(Number(stored)) ? null : Number(stored),
      onNotice: raise,
      onCursor: (id) => window.localStorage.setItem(CURSOR, String(id)),
      onTray: (present) => (tray = present),
    });
    const timer = setInterval(() => {
      const woken = wake(ledger, Date.now());
      if (!woken.due.length) return;
      keep(() => woken.ledger);
      woken.due.forEach(raise);
    }, WAKE_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [follows]);
  return null;
}

/** The opt-in, drawn in Settings on the surfaces that can raise an OS notification. */
export function OsNoticeSettings() {
  const on = useSyncExternalStore(subscribe, enabled, () => false);
  const denied = supported() && Notification.permission === "denied";
  return (
    <SwitchRow
      label="Notify me in this browser"
      says="Raises Pea finished turns, approvals and updates as system notifications while the tray is not running"
      checked={on}
      onCheckedChange={(next) => void setOsNotices(next)}
      refusal={
        !supported()
          ? "This browser cannot raise notifications."
          : denied
            ? "Notifications are blocked for this site in the browser settings."
            : null
      }
    />
  );
}

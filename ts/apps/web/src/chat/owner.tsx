import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { peaSettingFields } from "@pe/agent-contracts";
import { useWorkbench, useTranscript } from "#/workbench/provider";
import {
  AdmittedPlaceBoundary,
  AdmittedAttention,
  admittedRouterAddress,
  type PanePlace,
} from "#/shell/admitted-pane";
import { createRouteShell } from "#/shell/admitted-mount";
import { sourceRouteServices } from "#/shell/source-route-services";
import { graphSettings } from "#/shell/settings";
import { RouteVisibility } from "#/route/activity";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { createChatModule } from "./kernel";
import { chatLocalPort } from "./local";
import { type ChatHandle, type ChatRouteDeps } from "./graph";
import { admitChat } from "./admission";

const settingsDeclaration = { key: "chat", fields: peaSettingFields };
/** Chat supplies provider capabilities; Place and the admitted mount own every mutable route value. */
export function ChatOwner({
  docked,
  children,
}: {
  docked: boolean;
  children: (handle: ChatHandle) => ReactNode;
}) {
  const workbench = useWorkbench();
  const chat = useTranscript((state) => ({
    promptCapabilities: state.promptCapabilities,
    providerName: state.providerName,
  }));
  const deps = useRef<ChatRouteDeps>({ thread: "" });
  deps.current = {
    thread: workbench.currentThreadId,
    ready: !workbench.loading,
    running: workbench.isRunning,
    send: workbench.sendPrompt,
    cancel: workbench.cancel,
    newThread: () => workbench.newThread(),
    forkThread: () => workbench.forkThread(),
    sendRefusal: workbench.sendRefusal,
    draftTarget: workbench.draftTarget,
    ...chat,
  };
  const [route, setRoute] = useState<AdmittedRoute | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void admitChat(() => deps.current).then(
      (route) => {
        if (current) setRoute(route);
      },
      (error) => {
        if (current) setFailure(String(error));
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const router = useRouter();
  const address = useMemo(() => {
    if (!docked) return admittedRouterAddress(router.history);
    let search = new URLSearchParams(router.history.location.search);
    const listeners = new Set<() => void>();
    return {
      read: () => new URLSearchParams(search),
      write(next: URLSearchParams) {
        search = new URLSearchParams(next);
        listeners.forEach((notify) => notify());
      },
      subscribe(notify: () => void) {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
    };
  }, [router, docked]);
  const local = useMemo(() => chatLocalPort(() => deps.current), []);
  const shell = useMemo(
    () =>
      createRouteShell(
        { ...sourceRouteServices(createChatModule(() => deps.current).sources), local },
        graphSettings(settingsDeclaration),
      ),
    [local],
  );
  if (failure) return <p role="alert">{failure}</p>;
  return (
    route && (
      <AdmittedPlaceBoundary route={route} address={address}>
        {(place) => (
          <HeldChat route={route} place={place} shell={shell}>
            {children}
          </HeldChat>
        )}
      </AdmittedPlaceBoundary>
    )
  );
}
function HeldChat({
  route,
  place,
  shell,
  children,
}: {
  route: AdmittedRoute;
  place: PanePlace;
  shell: ReturnType<typeof createRouteShell>;
  children: (handle: ChatHandle) => ReactNode;
}) {
  const visible = useContext(RouteVisibility);
  const [handle, setHandle] = useState<ChatHandle | null>(null);
  useEffect(() => {
    place.setVisible(visible);
    const state = place.state(() => {
      const fixture =
        place.fixture !== null && typeof location !== "undefined" && location.pathname !== "/pea"
          ? "attach"
          : place.fixture;
      const input = {
        address: place.address,
        fixture,
        target: { kind: "host" as const },
        work: { address: null, open: null },
        custody: place,
        memory: place.memory,
      };
      const mount = shell.mount(route, input);
      return { shell, input, mount, dispose: mount.dispose };
    });
    const owner = Object.assign(state.mount, { fixture: place.fixture !== null }) as ChatHandle;
    owner.setPaneDemand("threads", true);
    owner.setPaneDemand("chat", true);
    const unsubscribe = owner.subscribe(() => {
      const { autoApprove: _setting, ...page } = owner.page.read();
      place.remember(page);
    });
    setHandle(owner);
    return () => {
      unsubscribe();
      owner.release();
    };
  }, [route, place, shell, visible]);
  return (
    handle && (
      <ChatObserved handle={handle} route={route}>
        {children}
      </ChatObserved>
    )
  );
}
function ChatObserved({
  handle,
  route,
  children,
}: {
  handle: ChatHandle;
  route: AdmittedRoute;
  children: (handle: ChatHandle) => ReactNode;
}) {
  useSyncExternalStore(handle.subscribe, handle.revision, handle.revision);
  const codec = handle.attention;
  return (
    <>
      {codec && <AdmittedAttention mount={handle} route={route} codec={codec} />}
      {children(handle)}
    </>
  );
}

import { memo } from "react";
import { TeachPage, TeachReference } from "@pe/kit/lang/use-teach";
import { TypedShell } from "../shell/typed-shell";
import { routeRegistry } from "../route/registry";
import { STARTUP_TEACHING } from "../route/teaching";
import { module } from "./route";
import { ChatSurfaceProps, type ChatShellProps } from "./chat-drawing";

/** The route wrapper owns mounting; the declared drawing never imports its own closure. */
export const ChatShell = memo(function ChatShell(props: ChatShellProps) {
  return <TeachPage value="/pea"><TeachReference value={STARTUP_TEACHING}>
    <ChatSurfaceProps.Provider value={props}>
      <TypedShell module={module} fingerprint={routeRegistry.chat!.fingerprint} />
    </ChatSurfaceProps.Provider>
  </TeachReference></TeachPage>;
});

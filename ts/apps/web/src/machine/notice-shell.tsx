import type { Machine } from "@pe/agent-contracts";
import { useReading } from "#/host/resource-state";
import { NoticeCard } from "./notice";

/** Only receipt controls: no panel navigation, route body, attention UI or device pairing. */
export function NoticeShell() {
  const reading = useReading<Machine>({ kind: "machine" });
  return <NoticeCard reading={reading} fixture={false} />;
}

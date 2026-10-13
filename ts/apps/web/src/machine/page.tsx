import type { Machine, Reading } from "@pe/agent-contracts";

import { MachineBody } from "./body";
import { NoticeCard } from "./notice";

export function MachinePage({
  reading,
  fixture,
  shell,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  shell: "tray" | "drawer";
}) {
  return (
    <main
      data-surface="page"
      className="h-dvh w-full min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-3 py-2"
      aria-label="machine"
    >
      {shell === "tray" ? <NoticeCard reading={reading} fixture={fixture} /> : null}
      <MachineBody reading={reading} fixture={fixture} shell={shell} />
    </main>
  );
}

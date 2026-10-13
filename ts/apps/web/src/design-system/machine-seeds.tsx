/**
 * The machine body over every recorded machine moment: the same seeds the tests and the
 * `/open?demo=` lane draw, at the tray's 380 px. Nothing here reaches a host.
 */
import { useState } from "react";

import { Switcher } from "#/components/lang/switcher";
import { MachineBody } from "#/machine/body";
import { MACHINE_SEEDS, type MachineSeed } from "#/open/seeds";

import { Demo } from "./exhibit";

export function MachineSeedsDemo() {
  const [seed, setSeed] = useState<MachineSeed>("blocked-plan");
  return (
    <Demo
      label="Machine body"
      consumers="routes/machine.tsx (web, PWA and control window)"
      spec="One canonical Machine renderer. Pick a recorded moment; the route owns section navigation and Settings owns configuration."
    >
      <Switcher
        ariaLabel="machine seed"
        value={seed}
        onChange={setSeed}
        options={(Object.keys(MACHINE_SEEDS) as MachineSeed[]).map((name) => ({
          value: name,
          label: name,
          title: `the ${name} machine moment`,
        }))}
      />
      <div data-surface="page" className="w-[380px] px-3 py-2">
        <MachineBody key={seed} reading={MACHINE_SEEDS[seed]} fixture shell="tray" />
      </div>
    </Demo>
  );
}

/**
 * The machine body over every recorded machine moment: the same seeds the tests and the
 * `/open?fixture=` lane draw, at the tray's 380 px. Nothing here reaches a host.
 */
import { useState } from "react";

import { Switcher } from "@pe/kit/lang/switcher";
import { SettingsBody } from "#/machine/body";
import { MACHINE_SEEDS, type MachineSeed } from "#/open/seeds";

import { Demo } from "./exhibit";

export function MachineSeedsDemo() {
  const [seed, setSeed] = useState<MachineSeed>("blocked-plan");
  return (
    <Demo
      label="Settings body"
      consumers="routes/settings.tsx (web, PWA and tray)"
      spec="One canonical Settings renderer over the machine reading. Pick a recorded moment; the route owns section navigation."
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
        <SettingsBody key={seed} reading={MACHINE_SEEDS[seed]} fixture shell="tray" />
      </div>
    </Demo>
  );
}

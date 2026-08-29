import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Press } from "#/components/lang/press";
import { Pane } from "#/components/ui/pane";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { Switch } from "#/components/ui/switch";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";

import { SpecimenFrame } from "./recipe-grid";

const PICK_ITEMS = CATEGORY_OPTIONS.slice(0, 6).map((option, index) => ({
  id: option.value,
  label: option.label,
  group: index < 3 ? "openings" : "systems",
  meta: `${(index + 1) * 4}`,
}));

export function UiLayoutSpecimens() {
  return (
    <>
      <PaneSpecimens />
      <PickListSpecimen />
      <SidePaneSpecimens />
      <SwitchSpecimens />
    </>
  );
}

function PaneSpecimens() {
  return (
    <SpecimenFrame name="Pane" importPath="#/components/ui/pane">
      <div className="grid grid-cols-2 gap-3">
        {(["navigation", "visual", "content", "inspector"] as const).map((kind) => (
          <div key={kind} className="h-32 w-56">
            <Pane
              kind={kind}
              title={kind}
              meta="4"
              actions={
                <Press size="icon" aria-label="refresh">
                  <RefreshCw className="size-3" />
                </Press>
              }
            >
              <div className="p-2">body</div>
            </Pane>
          </div>
        ))}
      </div>
    </SpecimenFrame>
  );
}

function PickListSpecimen() {
  const [active, setActive] = useState<string | null>(PICK_ITEMS[0]?.id ?? null);
  return (
    <SpecimenFrame name="PickList" importPath="#/components/ui/pick-list">
      <div className="grid grid-cols-2 gap-3">
        <div className="h-48 w-64">
          <PickList items={PICK_ITEMS} activeId={active} onPick={setActive} />
        </div>
        <div className="h-48 w-64">
          <PickList items={[]} onPick={() => {}} emptyNote="nothing in scope" />
        </div>
      </div>
    </SpecimenFrame>
  );
}

function SidePaneSpecimens() {
  return (
    <SpecimenFrame name="SidePane" importPath="#/components/ui/side-pane">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex h-40 w-72">
          <SidePane
            side="left"
            storageKey="swatch.side-pane.open"
            defaultWidth={180}
            minWidth={120}
            header={<span>open</span>}
          >
            <div className="p-2">body</div>
          </SidePane>
          <div className="flex-1" />
        </div>
        <div className="flex h-40 w-72">
          <SidePane
            side="left"
            storageKey="swatch.side-pane.closed"
            defaultOpen={false}
            defaultWidth={180}
            minWidth={120}
            header={<span>closed</span>}
          >
            <div className="p-2">body</div>
          </SidePane>
          <div className="flex-1" />
        </div>
      </div>
    </SpecimenFrame>
  );
}

function SwitchSpecimens() {
  return (
    <SpecimenFrame name="Switch" importPath="#/components/ui/switch">
      <div className="flex flex-wrap items-center gap-4">
        <Switch />
        <Switch defaultChecked />
        <Switch size="sm" />
        <Switch size="sm" defaultChecked />
        <Switch disabled />
        <Switch disabled defaultChecked />
      </div>
    </SpecimenFrame>
  );
}

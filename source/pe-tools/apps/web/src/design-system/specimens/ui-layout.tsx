import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Press } from "#/components/lang/press";
import { Section } from "#/components/lang/section";
import { Pane } from "#/components/ui/pane";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { Switch } from "#/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";

const PICK_ITEMS = CATEGORY_OPTIONS.slice(0, 6).map((option, index) => ({
  id: option.value,
  label: option.label,
  group: index < 3 ? "openings" : "systems",
  meta: `${(index + 1) * 4}`,
}));

export function UiLayoutSpecimens() {
  const [active, setActive] = useState<string | null>(PICK_ITEMS[0]?.id ?? null);
  const [mode, setMode] = useState("plan");
  return (
    <Section label="ui · layout and selection">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex h-48">
          <SidePane
            side="left"
            storageKey="swatch.side-pane.open"
            defaultWidth={180}
            minWidth={120}
            header={<span>header</span>}
          >
            <div className="p-2">body</div>
          </SidePane>
          <div className="min-w-0 flex-1">
            <Pane
              kind="content"
              title="content"
              meta="4"
              actions={
                <Press size="icon-xs" aria-label="refresh">
                  <RefreshCw className="size-3" />
                </Press>
              }
            >
              <div className="p-2">body</div>
            </Pane>
          </div>
        </div>
        <div className="h-48">
          <PickList items={PICK_ITEMS} activeId={active} onPick={setActive} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch />
          <Switch defaultChecked />
          <Switch size="sm" />
          <Switch size="sm" defaultChecked />
        </div>
        <ToggleGroup value={mode} onValueChange={setMode}>
          <ToggleGroupItem value="plan">plan</ToggleGroupItem>
          <ToggleGroupItem value="section">section</ToggleGroupItem>
          <ToggleGroupItem value="3d">3d</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </Section>
  );
}

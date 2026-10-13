import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Switch } from "#/components/lang/switch";
import { Switcher } from "#/components/lang/switcher";
import { Button } from "#/components/lang/button";
import { useDestination } from "#/navigation/state";
import { useIsPrimaryRoute } from "#/navigation/route-controls";
import { useSurfaceHost } from "#/navigation/surface-host";
import {
  createPageOptions,
  type SettingsOption,
  type PageOptions,
  type PageOption,
  type SettingsPanel,
} from "./option-state";
import { readTheme, useThemeMode, writeTheme } from "./option-theme";
import {
  readGlobalOptions,
  subscribeGlobalOptions,
  settingsPanelDestination,
} from "./option-catalogue";

const Context = createContext<PageOptions | null>(null);
export function SettingsProvider({ children }: { children: ReactNode }) {
  useThemeMode();
  const [store] = useState(createPageOptions);
  return <Context value={store}>{children}</Context>;
}
export function useRouteOptions() {
  const store = useContext(Context);
  return useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    store?.read ?? emptyRead,
    emptyRead,
  );
}
const emptySubscribe = () => () => {};
const emptyRead = () => null;

export function usePublishRouteOptions<P>(
  route: string,
  name: string,
  definitions: readonly PageOption<P>[] | undefined,
  page: P,
  setPage: (patch: Partial<P>) => void,
) {
  const store = useContext(Context);
  const primary = useIsPrimaryRoute(route);
  useEffect(() => {
    if (!store || !primary || !definitions?.length) return;
    // Each publication is one lease. Old controls cannot write after the Page changes.
    const owner = Symbol(route);
    const options: SettingsOption[] = definitions.map((definition): SettingsOption => {
      if (definition.kind === "boolean")
        return {
          ...definition,
          binding: {
            read: () => definition.read(page),
            write: (value: boolean) => store.write(owner, () => setPage(definition.patch(value))),
          },
        };
      return {
        ...definition,
        binding: {
          read: () => definition.read(page),
          write: (value: string) => store.write(owner, () => setPage(definition.patch(value))),
        },
      };
    });
    store.claim({ owner, route, name, options });
    return () => store.release(owner);
  }, [store, primary, definitions, page, setPage, route, name]);
}

const appearanceOptions: readonly SettingsOption[] = [
  {
    id: "theme",
    label: "Theme",
    scope: "user",
    kind: "choice",
    surfaces: ["web", "pwa", "tray"],
    projections: ["quick", "form"],
    choices: [
      { value: "light", label: "Light", title: "Use the light theme" },
      { value: "dark", label: "Dark", title: "Use the dark theme" },
      { value: "auto", label: "Auto", title: "Follow the system theme" },
    ],
    binding: {
      read: readTheme,
      write: (value) => {
        if (value === "light" || value === "dark" || value === "auto") writeTheme(value);
      },
    },
  },
];

function OptionControl({ option }: { option: SettingsOption }) {
  const value = useSyncExternalStore<boolean | string>(
    option.binding.subscribe ?? emptySubscribe,
    option.binding.read,
    option.binding.read,
  );
  return (
    <div
      data-option={option.id}
      data-option-scope={option.scope}
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <span title={option.description}>{option.label}</span>
      {option.kind === "boolean" ? (
        <Switch
          aria-label={option.label}
          checked={value === true}
          onCheckedChange={option.binding.write}
        />
      ) : (
        <Switcher
          ariaLabel={option.label}
          options={option.choices}
          value={String(value)}
          onChange={option.binding.write}
        />
      )}
    </div>
  );
}

function SettingsPanelDoor({
  route,
  panel,
  active,
}: {
  route: string;
  panel: SettingsPanel;
  active?: boolean;
}) {
  const go = useDestination();
  return (
    <Button
      label={panel.label}
      pressed={active}
      onClick={() => go(settingsPanelDestination(route, panel.id))}
    >
      {panel.label}
    </Button>
  );
}
function AllSettingsDoor() {
  const go = useDestination();
  return (
    <Button label="All settings" onClick={() => go("/settings")}>
      All settings
    </Button>
  );
}
/** Quick and full projections render the same descriptors and bindings. */
export function SettingsProjection({
  subject,
  section,
  quick = false,
}: {
  subject?: string;
  section?: string;
  quick?: boolean;
}) {
  useThemeMode();
  const host = useSurfaceHost();
  const route = useRouteOptions();
  const relevant = route && (!subject || subject === route.route) ? route : null;
  const globals = useSyncExternalStore(
    subscribeGlobalOptions,
    readGlobalOptions,
    readGlobalOptions,
  );
  const globalSubject = subject ?? route?.route;
  const eligible = (option: SettingsOption) =>
    option.surfaces.includes(host.surface) && option.projections.includes(quick ? "quick" : "form");
  const globalSections = globals.filter(
    (section) =>
      (!globalSubject ? !quick : section.route === globalSubject) && section.options.some(eligible),
  );
  const panelSections = globals.filter(
    (owner) =>
      (!globalSubject ? !quick : owner.route === globalSubject) &&
      owner.panels.some((panel) => panel.surfaces.includes(host.surface)),
  );
  return (
    <div className="flex flex-col gap-3" data-settings-projection={quick ? "quick" : "full"}>
      {!section && !quick && <h2 className="t-head face-display">Appearance</h2>}
      {!section &&
        appearanceOptions
          .filter(eligible)
          .map((option) => <OptionControl key={option.id} option={option} />)}
      {!section &&
        globalSections.map((section) => (
          <section
            key={section.route}
            className="flex flex-col gap-2 hairline-t pt-2"
            aria-label={`${section.name} settings`}
          >
            <h2 className="t-head">{section.name}</h2>
            {section.options.filter(eligible).map((option) => (
              <OptionControl key={option.id} option={option} />
            ))}
          </section>
        ))}
      {!section && relevant && (
        <section
          className="flex flex-col gap-2 hairline-t pt-2"
          aria-label={`${relevant.name} options`}
        >
          <h2 className="t-head">{relevant.name}</h2>
          {relevant.options.filter(eligible).map((option) => (
            <OptionControl key={option.id} option={option} />
          ))}
        </section>
      )}
      {panelSections.map((owner) => (
        <div key={owner.route} className="flex flex-col gap-3">
          <nav className="flex flex-wrap gap-2" aria-label={`${owner.name} settings sections`}>
            {owner.panels
              .filter((panel) => panel.surfaces.includes(host.surface))
              .map((panel) => (
                <SettingsPanelDoor
                  key={panel.id}
                  route={owner.route}
                  panel={panel}
                  active={section === panel.id}
                />
              ))}
            {!quick && section && <AllSettingsDoor />}
          </nav>
          {!quick &&
            owner.panels
              .filter(
                (panel) =>
                  panel.surfaces.includes(host.surface) && (!section || panel.id === section),
              )
              .map((panel) => {
                const Panel = panel.render;
                return (
                  <section
                    key={panel.id}
                    className="flex flex-col gap-2 hairline-t pt-4"
                    aria-label={panel.label}
                    data-settings-panel={panel.id}
                    data-option-scope={panel.scope}
                  >
                    <h2 className="t-head face-display">{panel.label}</h2>
                    <Panel />
                  </section>
                );
              })}
        </div>
      ))}
      {subject && !section && !relevant && panelSections.length === 0 && (
        <p className="text-ink-mute">Page controls stay in the page's Settings menu.</p>
      )}
    </div>
  );
}

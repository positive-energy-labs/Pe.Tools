import * as kit from "./index";
import "./style.css";

// Attach only presentation; an offline Page never receives pretend host doors or credentials.
const page = window as typeof window & {
  pe?: { kit?: typeof kit; kitReady?: Promise<typeof kit> };
};
page.pe ??= {};
page.pe.kit = kit;
page.pe.kitReady ??= Promise.resolve(kit);

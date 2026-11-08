// @vitest-environment jsdom
import { test } from "vite-plus/test";
import { fansPlanJourney } from "./fans-plan-composition.test-support";

test("Fans band and Plan follow an external HTTP Work edit without starting Ducts",
  () => fansPlanJourney("external Fans edit"), 150000);

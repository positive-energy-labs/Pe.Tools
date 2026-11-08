// @vitest-environment jsdom
import { test } from "vite-plus/test";
import { fansPlanJourney } from "./fans-plan-composition.test-support";

test("Plan keeps capture and review valid across watched publications and batched receipts",
  () => fansPlanJourney("watched publications"), 150000);

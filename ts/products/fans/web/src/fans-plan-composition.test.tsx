// @vitest-environment jsdom
import { test } from "vite-plus/test";
import { fansPlanJourney } from "../../../../apps/web/src/product-tests/fans/web/src/fans-plan-composition.test-support.tsx";

test("Plan keeps capture and review valid across watched publications and batched receipts",
  () => fansPlanJourney("watched publications"), 150000);

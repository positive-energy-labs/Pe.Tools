import { expect, test } from "vite-plus/test";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { admit } from "./admission.fixture.ts";

test("fans admits its own schema and fingerprint independently of ducts", async () => {
  const { owner, presenter, hostPresenter } = await admit();
  expect(presenter.data.work).toEqual({ route: "fans", schema: "work", version: 1, migrations: {} });
  expect(presenter.workFingerprint).not.toBe(owner.workFingerprint);
  expect(presenter.resolvedWork?.schema.parse({})).toEqual(fansDocumentSchema.parse({}));
  expect(hostPresenter.resolvedWork?.spec.route).toBe("fans");
});

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  defaultReadImageMaxBytes,
  isReadImageSuccess,
  readImage,
} from "../src/shared/read-image.ts";

// 1x1 red pixel PNG.
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function withTinyPng<T>(run: (fixturePath: string) => Promise<T>): Promise<T> {
  // Under process.cwd() so the workspace sandbox check passes without a tool context.
  const fixturePath = path.join(process.cwd(), "tests", ".tmp-read-image-fixture.png");
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, Buffer.from(tinyPngBase64, "base64"));
  try {
    return await run(fixturePath);
  } finally {
    await fs.rm(fixturePath, { force: true });
  }
}

test("read_image returns base64 image data the model can view", async () => {
  await withTinyPng(async (fixturePath) => {
    const result = await readImage.execute?.(
      { filePath: fixturePath, maxBytes: defaultReadImageMaxBytes },
      {} as never,
    );

    expect(isReadImageSuccess(result)).toBe(true);
    if (!isReadImageSuccess(result)) throw new Error("expected read_image success");
    expect(result.mediaType).toBe("image/png");
    expect(result.byteSize).toBeGreaterThan(0);
    expect(result.data).toBe(tinyPngBase64);
    expect(result.text).toContain("image/png");

    const modelOutput = readImage.toModelOutput?.(result) as {
      type: string;
      value: Array<Record<string, unknown>>;
    };
    expect(modelOutput.type).toBe("content");
    expect(modelOutput.value).toEqual([
      { type: "text", text: result.text },
      { type: "media", data: tinyPngBase64, mediaType: "image/png" },
    ]);
  });
});

test("read_image rejects unsupported extensions and missing files", async () => {
  const unsupported = await readImage.execute?.(
    {
      filePath: path.join(process.cwd(), "tests", "not-an-image.txt"),
      maxBytes: defaultReadImageMaxBytes,
    },
    {} as never,
  );
  expect(unsupported).toMatchObject({ isError: true });
  expect(readImage.toModelOutput?.(unsupported)).toBeUndefined();

  const missing = await readImage.execute?.(
    {
      filePath: path.join(process.cwd(), "tests", "missing.png"),
      maxBytes: defaultReadImageMaxBytes,
    },
    {} as never,
  );
  expect(missing).toMatchObject({ isError: true });
});

test("read_image enforces the maxBytes cap", async () => {
  await withTinyPng(async (fixturePath) => {
    const result = await readImage.execute?.({ filePath: fixturePath, maxBytes: 1 }, {} as never);
    expect(result).toMatchObject({ isError: true });
  });
});

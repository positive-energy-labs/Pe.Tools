import { useCallback, useMemo, useRef, useState } from "react";

import { findAmbiguousBlockIds } from "#/grounded-doc/ambiguous";
import type { DocImage, GroundedBlock, ParsedDocView } from "#/grounded-doc/types";

type FocusOrigin = "markdown" | "page" | "image" | "external";

interface BlockFocus {
  blockId: string;
  origin: FocusOrigin;
}

type GroundedDocStatus =
  | { phase: "empty" }
  | { phase: "parsing"; fileName: string }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export interface GroundedDocEngine {
  doc: ParsedDocView | null;
  status: GroundedDocStatus;
  focus: BlockFocus | null;
  pinned: BlockFocus | null;

  load: (file: File) => Promise<void>;
  loadUrl: (url: string) => Promise<void>;
  setDoc: (doc: ParsedDocView) => void;
  clear: () => void;

  hoverBlock: (blockId: string | null, origin: FocusOrigin) => void;
  pinBlock: (blockId: string, origin: FocusOrigin) => void;
  clearPin: () => void;

  blockById: (blockId: string | null | undefined) => GroundedBlock | undefined;
  blocksForPage: (page: number) => GroundedBlock[];

  imageById: (id: string | null | undefined) => DocImage | undefined;
  imagesForPage: (page: number) => DocImage[];
  focusedPage: number | null;

  ambiguousBlockIds: Set<string>;
}

const EMPTY_BLOCKS: GroundedBlock[] = [];
const EMPTY_IMAGES: DocImage[] = [];

export function useGroundedDoc(options?: { parseUrl?: string }): GroundedDocEngine {
  const parseUrl = options?.parseUrl ?? "/api/pdf-audit/parse";
  const [doc, setDocState] = useState<ParsedDocView | null>(null);
  const [status, setStatus] = useState<GroundedDocStatus>({ phase: "empty" });
  const [hover, setHover] = useState<BlockFocus | null>(null);
  const [pinned, setPinned] = useState<BlockFocus | null>(null);
  const loadSeq = useRef(0);

  const blockIndex = useMemo(
    () => new Map((doc?.blocks ?? []).map((block) => [block.id, block])),
    [doc],
  );
  const blocksByPage = useMemo(() => {
    const byPage = new Map<number, GroundedBlock[]>();
    for (const block of doc?.blocks ?? []) {
      const list = byPage.get(block.page);
      if (list) list.push(block);
      else byPage.set(block.page, [block]);
    }
    return byPage;
  }, [doc]);

  const imageIndex = useMemo(
    () => new Map((doc?.images ?? []).map((image) => [image.id, image])),
    [doc],
  );
  const imagesByPage = useMemo(() => {
    const byPage = new Map<number, DocImage[]>();
    for (const image of doc?.images ?? []) {
      const list = byPage.get(image.page);
      if (list) list.push(image);
      else byPage.set(image.page, [image]);
    }
    return byPage;
  }, [doc]);

  const ambiguousBlockIds = useMemo(() => findAmbiguousBlockIds(doc?.blocks ?? []), [doc]);

  const setDoc = useCallback((next: ParsedDocView) => {
    loadSeq.current += 1;
    setDocState(next);
    setStatus({ phase: "ready" });
    setHover(null);
    setPinned(null);
  }, []);

  const clear = useCallback(() => {
    loadSeq.current += 1;
    setDocState(null);
    setStatus({ phase: "empty" });
    setHover(null);
    setPinned(null);
  }, []);

  const runParse = useCallback(
    async (form: FormData, displayName: string) => {
      const seq = ++loadSeq.current;
      setStatus({ phase: "parsing", fileName: displayName });
      setDocState(null);
      setHover(null);
      setPinned(null);
      try {
        const response = await fetch(parseUrl, { method: "POST", body: form });
        const payload = (await response.json()) as ParsedDocView & { error?: string };
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `parse failed (${response.status})`);
        }
        if (seq !== loadSeq.current) return;
        setDocState(payload);
        setStatus({ phase: "ready" });
      } catch (error) {
        if (seq !== loadSeq.current) return;
        setStatus({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [parseUrl],
  );

  const load = useCallback(
    (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return runParse(form, file.name);
    },
    [runParse],
  );

  const loadUrl = useCallback(
    (url: string) => {
      const form = new FormData();
      form.append("url", url);
      return runParse(form, decodeURIComponent(url.split("/").pop() || url));
    },
    [runParse],
  );

  const hoverBlock = useCallback((blockId: string | null, origin: FocusOrigin) => {
    setHover(blockId ? { blockId, origin } : null);
  }, []);

  const pinBlock = useCallback((blockId: string, origin: FocusOrigin) => {
    setPinned((prev) => (prev?.blockId === blockId ? null : { blockId, origin }));
  }, []);

  const clearPin = useCallback(() => {
    setPinned(null);
  }, []);

  const blockById = useCallback(
    (blockId: string | null | undefined) => (blockId ? blockIndex.get(blockId) : undefined),
    [blockIndex],
  );

  const blocksForPage = useCallback(
    (page: number) => blocksByPage.get(page) ?? EMPTY_BLOCKS,
    [blocksByPage],
  );

  const imageById = useCallback(
    (id: string | null | undefined) => (id ? imageIndex.get(id) : undefined),
    [imageIndex],
  );

  const imagesForPage = useCallback(
    (page: number) => imagesByPage.get(page) ?? EMPTY_IMAGES,
    [imagesByPage],
  );

  const focus = pinned ?? hover;
  const focusedPage =
    (focus ? (blockIndex.get(focus.blockId)?.page ?? imageIndex.get(focus.blockId)?.page) : null) ??
    null;

  return useMemo(
    () => ({
      doc,
      status,
      focus,
      pinned,
      load,
      loadUrl,
      setDoc,
      clear,
      hoverBlock,
      pinBlock,
      clearPin,
      blockById,
      blocksForPage,
      imageById,
      imagesForPage,
      focusedPage,
      ambiguousBlockIds,
    }),
    [
      doc,
      status,
      focus,
      focusedPage,
      pinned,
      load,
      loadUrl,
      setDoc,
      clear,
      hoverBlock,
      pinBlock,
      clearPin,
      blockById,
      blocksForPage,
      imageById,
      imagesForPage,
      ambiguousBlockIds,
    ],
  );
}

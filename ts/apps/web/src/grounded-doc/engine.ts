import { useCallback, useMemo, useState } from "react";

import { findAmbiguousBlockIds } from "#/grounded-doc/ambiguous";
import type { DocImage, GroundedBlock, ParsedDocView } from "#/grounded-doc/types";

type FocusOrigin = "markdown" | "page" | "image" | "external";

interface BlockFocus {
  blockId: string;
  origin: FocusOrigin;
}

type GroundedDocStatus =
  | { phase: "empty" }
  | { phase: "ready" };

export interface GroundedDocEngine {
  doc: ParsedDocView | null;
  status: GroundedDocStatus;
  focus: BlockFocus | null;
  pinned: BlockFocus | null;

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

export function useGroundedDoc(options?: { initialDoc?: ParsedDocView }): GroundedDocEngine {
  const [doc, setDocState] = useState<ParsedDocView | null>(options?.initialDoc ?? null);
  const [status, setStatus] = useState<GroundedDocStatus>(
    options?.initialDoc ? { phase: "ready" } : { phase: "empty" },
  );
  const [hover, setHover] = useState<BlockFocus | null>(null);
  const [pinned, setPinned] = useState<BlockFocus | null>(null);

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
    setDocState(next);
    setStatus({ phase: "ready" });
    setHover(null);
    setPinned(null);
  }, []);

  const clear = useCallback(() => {
    setDocState(null);
    setStatus({ phase: "empty" });
    setHover(null);
    setPinned(null);
  }, []);

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

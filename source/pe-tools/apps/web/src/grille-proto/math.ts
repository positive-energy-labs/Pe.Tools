/**
 * Wood floor grille free-area math — a 1:1 port of
 * `PE Custom Wood Floor Grille Calculator.xlsx › free area calcs`. All units are inches.
 *
 * A grille is a board with an end border on each end (along its length) and an edge border on each
 * side (across its width). Between the edge borders, `n` openings alternate with `n-1` ribs; every
 * opening runs the full length between the end borders.
 */
export type GrilleInput = {
  boardLength: number; // B4
  endBorder: number; // C4
  boardWidth: number; // B7
  edgeBorder: number; // C7
  opening: number; // E7 — opening width
  rib: number; // F7 — rib width
  openings: number; // H7 — qty openings
};

export type Grille = GrilleInput & {
  middleAvailable: number; // D = W - 2·edge
  openingLength: number; // G = L - 2·end
  ribs: number; // I = n - 1
  middleDimension: number; // J = ribs·rib + n·opening
  slack: number; // D - J  (negative = does not fit)
  freeAreaBeforeDerate: number; // K = n·opening / W
  lengthDerate: number; // L = (L - 2·end) / L
  freeArea: number; // M = K·L
  actualFreeArea: number; // N = opening·n·openingLength  (in²)
};

export function solve(i: GrilleInput): Grille {
  const middleAvailable = i.boardWidth - i.edgeBorder * 2;
  const openingLength = i.boardLength - i.endBorder * 2;
  const ribs = Math.max(0, i.openings - 1);
  const middleDimension = ribs * i.rib + i.openings * i.opening;
  const freeAreaBeforeDerate = (i.openings * i.opening) / i.boardWidth;
  const lengthDerate = openingLength / i.boardLength;
  return {
    ...i,
    middleAvailable,
    openingLength,
    ribs,
    middleDimension,
    slack: middleAvailable - middleDimension,
    freeAreaBeforeDerate,
    lengthDerate,
    freeArea: freeAreaBeforeDerate * lengthDerate,
    actualFreeArea: i.opening * i.openings * openingLength,
  };
}

/** Rib width that exactly fills the middle for a given opening width and count (sheet row 9/11 style). */
export function ribToFill(i: Omit<GrilleInput, "rib">): number {
  const ribs = i.openings - 1;
  if (ribs <= 0) return 0;
  return (i.boardWidth - i.edgeBorder * 2 - i.openings * i.opening) / ribs;
}

/** The sheet's six rows, verbatim: the fixture every variant starts from. */
export const SHEET_ROWS: GrilleInput[] = [
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 0.75,
    opening: 0.75,
    rib: 5 / 8,
    openings: 3,
  },
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 0.75,
    opening: 0.5,
    rib: 0.5,
    openings: 4,
  },
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 0.625,
    opening: 5 / 8,
    rib: 0.4166666666666667,
    openings: 4,
  },
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 0.5,
    opening: 0.5,
    rib: 3 / 8,
    openings: 5,
  },
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 0.75,
    opening: 3 / 8,
    rib: 0.40625,
    openings: 5,
  },
  {
    boardLength: 18,
    endBorder: 0.75,
    boardWidth: 5,
    edgeBorder: 9 / 16,
    opening: 0.375,
    rib: 0.5,
    openings: 5,
  },
];

/** 0.625 → 5/8, 1.5 → 1 1/2, to the nearest 1/32. */
export function frac(x: number): string {
  const sign = x < 0 ? "-" : "";
  x = Math.abs(x);
  let whole = Math.floor(x);
  let num = Math.round((x - whole) * 32);
  let den = 32;
  if (num === 32) {
    whole += 1;
    num = 0;
  }
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  if (num === 0) return `${sign}${whole}`;
  return whole ? `${sign}${whole} ${num}/${den}` : `${sign}${num}/${den}`;
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

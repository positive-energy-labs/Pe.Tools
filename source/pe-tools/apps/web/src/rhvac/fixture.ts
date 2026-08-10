/**
 * project-a dev fixture — the eval extract/map plus real Partition replay
 * TSVs served from public/rhvac-fixture. The extract JSON is UTF-8 with BOM;
 * strip it before parsing.
 */
import { mergeTakeoffLevels, parseTakeoffTsv } from "#/rhvac/takeoff";
import {
  normalizeExtract,
  type RhvacExtract,
  type RhvacTakeoffData,
  type RoomMap,
} from "#/rhvac/types";

const BASE = "/rhvac-fixture";

interface FixtureManifest {
  extract: string;
  roomMap: string;
  takeoff: string[];
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) throw new Error(`fixture ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const sha256 = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fetchJson = async <T>(path: string): Promise<T> => JSON.parse(await fetchText(path)) as T;

export const FIXTURE_SOURCE_LABEL = "project-a fixture (Partition replay + native edit)";

export async function loadFixtureExtract(): Promise<RhvacExtract> {
  const manifest = await fetchJson<FixtureManifest>("manifest.json");
  return normalizeExtract(await fetchJson<RhvacExtract>(manifest.extract));
}

export async function loadFixtureTakeoff(): Promise<RhvacTakeoffData> {
  const manifest = await fetchJson<FixtureManifest>("manifest.json");
  const [roomMap, ...tsvTexts] = await Promise.all([
    fetchJson<RoomMap>(manifest.roomMap),
    ...manifest.takeoff.map((name) => fetchText(name)),
  ]);
  const parsedLevels = tsvTexts.map((text) => parseTakeoffTsv(text));
  const hashes = await Promise.all(tsvTexts.map(sha256));
  return {
    levels: mergeTakeoffLevels(parsedLevels),
    roomMap,
    tsvSha256: Object.fromEntries(
      parsedLevels.map((level, index) => [level.levelName, hashes[index]!]),
    ),
  };
}

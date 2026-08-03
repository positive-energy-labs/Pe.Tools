/**
 * project-a dev fixture — copies of eval/rhvac/project-a/* served from
 * public/rhvac-fixture so the whole /rhvac surface is workable before the
 * wave-2 `rhvac.*` host ops land. The extract JSON is UTF-8 with BOM; strip it
 * before parsing.
 */
import { parseTakeoffTsv } from "#/rhvac/takeoff";
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

const fetchJson = async <T>(path: string): Promise<T> => JSON.parse(await fetchText(path)) as T;

export const FIXTURE_SOURCE_LABEL = "project-a fixture (eval/rhvac/projectA)";

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
  return { levels: tsvTexts.map((text) => parseTakeoffTsv(text)), roomMap };
}

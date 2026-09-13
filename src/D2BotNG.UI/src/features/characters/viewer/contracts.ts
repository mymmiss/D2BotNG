/**
 * What the shared viewer components actually need.
 *
 * There are two character stacks and they send genuinely different things: v1 sends presentation
 * the game engine already resolved, v2 sends the raw capture those answers come from. Neither is
 * a subset of the other, so there is no honest conversion between them: reshaping v2 into v1 means
 * inventing a skills split and restructuring kills, which is exactly the kind of quiet fudge that
 * later reads as a bug.
 *
 * So each stack gets its own view, and what they share is stated here: the narrow shapes the
 * panels and grids read. Both sides PROJECT into these — no derivation, no guessing — and the
 * schemas stop leaking into the render tree.
 */

import type { RenderableItem } from "@/features/items";

/** A stat row. Both stacks already send exactly this pair. */
export interface StatValue {
  id: number;
  value: bigint;
}

/**
 * A skill, as the panel displays it: what was invested and what it currently is.
 *
 * The two stacks decompose this differently — v1 sends invested plus the gear share, v2 sends
 * invested plus the bonused total — so each states `total` in its own terms rather than one
 * reconstructing the other's arithmetic.
 */
export interface SkillLevels {
  skillId: number;
  invested: number;
  total: number;
}

/** Quests and waypoints for one difficulty. */
export interface DifficultyProgress {
  quests: number[];
  waypoints: number[];
}

/**
 * One kill bucket, flat. v1 nests these difficulty -> class -> spec and v2 keeps them flat, but
 * flattening loses nothing and needs no interpretation, so the flat form is the shared one.
 * `superUnique` keeps the two buckets disjoint: a super-unique is never also counted by class.
 */
export interface KillCount {
  difficulty: number;
  superUnique: boolean;
  id: number;
  spec: number;
  count: bigint;
}

/** Milliseconds spent in one area, on one difficulty. */
export interface AreaDuration {
  difficulty: number;
  area: number;
  milliseconds: bigint;
}

/**
 * What the renderer needs, plus where the item sits.
 *
 * Extends `RenderableItem` rather than restating it: the renderer owns that contract, and a copy
 * here drifts the moment a field is added to one and not the other — which is exactly what
 * happened when items gained their held-Ctrl detail.
 *
 * Note what `code` means, since it is the one field whose name misleads: it is the SPRITE name,
 * not the item code. That is what it has always meant to the rendering pipeline (`<code>.dc6`).
 * v1 receives it already resolved; v2 resolves it from the game's tables, where exceptional and
 * elite tiers collapse to the base art, set and unique items get their own, and rings, amulets,
 * jewels and charms carry a variant suffix.
 */
export interface DisplayItem extends RenderableItem {
  sockets: DisplayItem[];

  /** Where it sits: grid cell and footprint, or the equip-location id in `x` for a slot set. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Session unit id — a React key that is stable while the game is, unlike the grid position. */
  gid: number;
}

/** A grid of items, or a slot set when the dimensions are zero. */
export interface DisplayContainer {
  /** A React key. Stash pages share a container name, so theirs is page-qualified. */
  id: string;
  width: number;
  height: number;
  items: DisplayItem[];
}

/**
 * What each storage container is called.
 *
 * The ids are the ones both stacks already use — v1 sends them as a container's `id`, v2 as the
 * field name — so this is a label table, not a projection: the same words wherever a container is
 * named, whether that is a grid heading in the viewer or a search result's provenance line.
 */
export const CONTAINER_LABELS: Record<string, string> = {
  equipped: "Equipped",
  inventory: "Inventory",
  cube: "Horadric Cube",
  belt: "Belt",
  stash: "Stash",
};

/** The storage grids the viewer lays out, in the order it lays them out; the stash follows. */
export const STORAGE_IDS = ["inventory", "cube", "belt"] as const;

/**
 * Which stash a page belongs to. A page's index is 0-based WITHIN its kind, so the pair is the
 * page's identity: the first personal and the first shared page are both page 0.
 *
 * v2 states it outright; v1 never had more than the personal stash, so its pages are all
 * personal. An OLDER v2 producer sent no kind either — and proto3 reads that as the zero value,
 * which is personal, which is the only kind such an engine could report. No detection needed.
 */
export type StashKind = "personal" | "shared";

/** What a page is for. Always "normal" on LoD; D2R adds stackable-only and Chronicle tabs. */
export type StashPageType = "normal" | "advanced" | "chronicle";

/** One stash page, as the viewer draws it: its identity, its gold, and its grid. */
export interface DisplayStashPage {
  kind: StashKind;
  /** 0-based within its kind. */
  index: number;
  /** The tab's own name; empty when unnamed. */
  name: string;
  type: StashPageType;
  /** Gold held on this page; 0 when none, or when the producer reports no per-page figure. */
  gold: number;
  container: DisplayContainer;
}

export const STASH_KIND_LABELS: Record<StashKind, string> = {
  personal: "Personal",
  shared: "Shared",
};

/** A qualifier for the page types that are not the plain one; the plain one needs no word. */
export const STASH_PAGE_TYPE_LABELS: Record<StashPageType, string | undefined> =
  {
    normal: undefined,
    advanced: "Stackables only",
    chronicle: "Chronicle",
  };

/** The stat ids both stacks report under: level, and gold carried and in the stash. */
export const STAT_LEVEL = 12;
export const STAT_GOLD = 14;
export const STAT_STASH_GOLD = 15;

/** A stat off a wearer as a number; 0 when unreported. Both stacks send the same `{id, value}`. */
export function statOf(stats: StatValue[] | undefined, id: number): number {
  return Number(stats?.find((s) => s.id === id)?.value ?? 0n);
}

/**
 * What to call one stash page, wherever a page is named: a tab in the viewer or a search
 * result's provenance. The page's own name if the game gave it one, else its kind and 1-based
 * index ("Personal 2", "Shared 1") — the index alone is ambiguous across kinds.
 */
export function stashPageLabel(
  page: Pick<DisplayStashPage, "kind" | "index" | "name">,
): string {
  return page.name || `${STASH_KIND_LABELS[page.kind]} ${page.index + 1}`;
}

/**
 * Gives the stash-gold stat to the first personal page when no page reports gold of its own.
 *
 * A producer that knows about per-page gold sends the figure on the page (on LoD, the first
 * personal tab carries the whole stash's, and every other tab 0). One that does not — v1, and v2
 * engines from before stash kinds — sends nothing, and the same number is still on the wearer as
 * stat 15. So a page that reports gold is believed, and only when none does is the stat used;
 * the two never disagree on LoD, and a newer producer's zeros are left alone rather than
 * overwritten with a stat that is the same zero.
 */
export function withStashGoldFallback(
  pages: DisplayStashPage[],
  bankGold: number,
): DisplayStashPage[] {
  // Gated on the PERSONAL pages only: stat 15 is the personal stash's gold, so a shared page
  // reporting gold says nothing about whether the personal figure was attributed.
  const personalReported = pages.some(
    (p) => p.kind === "personal" && p.gold > 0,
  );
  if (bankGold <= 0 || personalReported) return pages;
  const first = pages.findIndex((p) => p.kind === "personal");
  if (first < 0) return pages;
  return pages.map((p, i) => (i === first ? { ...p, gold: bankGold } : p));
}

/**
 * Difficulty names, indexed by the id both stacks send.
 *
 * One table because it is the same three words in the header line, the stats panel's penalty note
 * and both difficulty pickers — a label, like the container names above, rather than anything
 * either schema has to be interpreted to produce.
 */
export const DIFFICULTY_NAMES = ["Normal", "Nightmare", "Hell"] as const;

/**
 * The header facts, which both stacks send outright — except v2's level, which is stat 12 rather
 * than a field, because a capture stores what the game held and the game holds level as a stat.
 */
export interface CharacterFacts {
  profile: string;
  charName: string;
  account: string;
  realm: string;
  level: number;
  charClass: number;
  difficulty: number;
  area: number;
  /** When the current area was entered, for the live timer. Absent = no timer. */
  areaEnteredAt?: { seconds: bigint };
  /** Active weapon set: 0 primary, 1 secondary. */
  hand: 0 | 1;
  hardcore: boolean;
  ladder: boolean;
  expansion: boolean;
  /** Last report, for the offline caption. Absent reads as a plain "Offline". */
  updatedAt?: { seconds: bigint };
}

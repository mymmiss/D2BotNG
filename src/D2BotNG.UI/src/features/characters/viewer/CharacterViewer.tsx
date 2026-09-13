/**
 * CharacterViewer — the "Character" tab.
 *
 * There are two views because there are two stacks: `StreamedCharacterView` for wire schema v1
 * (pushed on the event stream) and `CapturedCharacterView` for v2 (pulled from the capture store).
 * See `contracts.ts` for why neither converts into the other. This shell owns what genuinely is
 * common — the character list, the selection, and liveness — and renders whichever view the
 * selected character's schema calls for.
 *
 * Online status is derived live from the owning profile's run state rather than from anything the
 * character sent, so the dot is accurate even for a stopped profile. Neither message carries an
 * `online` field for exactly that reason. A v2 capture is keyed by profile AND character name —
 * a mule profile holds one per mule — so for those "online" also means "the character this
 * profile reported most recently": the mules it logged into earlier are offline even while it
 * runs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { UserIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui";
import type { CharacterKey, CharacterSummary } from "@/generated/captures_pb";
import { isActive } from "@/features/profiles/profile-states";
import {
  captureMapKey,
  useCapturedSummaries,
  useCharacters,
  useProfiles,
} from "@/stores/event-store";
import { useCapturedCharacter } from "@/hooks/useCaptures";
import { useToolkit } from "@/hooks/useToolkit";
import { StreamedCharacterView } from "./StreamedCharacterView";
import { CapturedCharacterView } from "./CapturedCharacterView";

/**
 * A row in the picker. Deliberately the little that both stacks agree on: enough to search,
 * label and choose, and nothing that would need either schema interpreted to fill in.
 */
interface ListEntry {
  /**
   * React key and selection identity. The store's own map key for a capture; the profile name
   * for a v1 character, which the stream keys by profile alone. Never shown and never sent.
   */
  id: string;
  /** The capture's key. Absent for a v1 character, which has no key beyond its profile. */
  key?: CharacterKey;
  profile: string;
  charName: string;
  account: string;
  realm: string;
  schema: 1 | 2;
  /**
   * The character its profile reported most recently. Always true for v1 and for a profile with
   * one capture; false for the earlier mules of a mule profile, which are offline even while the
   * profile runs.
   */
  latest: boolean;
  /** The profile holds several captures, so the name alone does not say which profile this is. */
  ambiguous: boolean;
}

/** Later of two summaries by their last report; ties go to the first argument. */
function laterOf(a: CharacterSummary, b: CharacterSummary): CharacterSummary {
  const as = a.updatedAt?.seconds ?? 0n;
  const bs = b.updatedAt?.seconds ?? 0n;
  if (as !== bs) return as > bs ? a : b;
  return (a.updatedAt?.nanos ?? 0) >= (b.updatedAt?.nanos ?? 0) ? a : b;
}

/**
 * The character name, doubling as the character selector: clicking it opens a searchable dropdown
 * of all known characters. Embedded in the header line so it doesn't cost a separate row.
 */
function CharacterSelector({
  entries,
  selected,
  onSelect,
  isOnline,
}: {
  entries: ListEntry[];
  selected: ListEntry;
  onSelect: (id: string) => void;
  isOnline: (entry: ListEntry) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((c) =>
      [c.charName, c.profile, c.account, c.realm].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [entries, search]);

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group -mx-1 flex items-center gap-2 rounded px-1 hover:bg-zinc-800/60 focus:outline-none"
      >
        <span
          className={clsx(
            "h-2.5 w-2.5 flex-shrink-0 rounded-full",
            isOnline(selected) ? "bg-green-500" : "bg-zinc-600",
          )}
        />
        <h2 className="text-xl font-bold text-zinc-100">
          {selected.charName || selected.profile}
        </h2>
        {/* Named only when the name alone would not say which profile this came through. */}
        {selected.ambiguous && (
          <span className="text-sm text-zinc-500">{selected.profile}</span>
        )}
        <ChevronUpDownIcon className="h-5 w-5 flex-shrink-0 text-zinc-500 group-hover:text-zinc-300" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 max-h-80 w-80 overflow-hidden rounded-lg bg-zinc-800 shadow-lg ring-1 ring-zinc-700">
          <div className="border-b border-zinc-700 p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search characters..."
              className="block w-full rounded border-0 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-d2-gold"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelect(c.id)}
                className={clsx(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                  c.id === selected.id
                    ? "bg-d2-gold/20 text-d2-gold"
                    : "text-zinc-300 hover:bg-zinc-700",
                )}
              >
                <span
                  className={clsx(
                    "h-2 w-2 flex-shrink-0 rounded-full",
                    isOnline(c) ? "bg-green-500" : "bg-zinc-600",
                  )}
                />
                <span className="flex-1 truncate">
                  {c.charName || c.profile}
                </span>
                {/* Both stacks, not just v2: the badge is only informative if its absence means
                    something, and a list where most rows are unmarked reads as "these are normal
                    and that one is odd" rather than as two kinds. */}
                <SchemaBadge schema={c.schema} />
                {(c.ambiguous || c.account || c.realm) && (
                  <span className="truncate text-xs text-zinc-500">
                    {[c.ambiguous ? c.profile : "", c.account, c.realm]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-zinc-500">
                No matches found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Which stack this character came from. Worth surfacing because it explains what the view can
 *  show: only a v2 capture carries per-item stat lists, so a v1 character has no searchable item
 *  detail behind it. */
function SchemaBadge({ schema }: { schema: 1 | 2 }) {
  return (
    <span
      className={clsx(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        schema === 2
          ? "bg-d2-gold/15 text-d2-gold"
          : "bg-zinc-700/60 text-zinc-400",
      )}
      title={
        schema === 2
          ? "Wire schema v2 capture — full item detail, pulled on demand"
          : "Wire schema v1 — streamed live, presentation resolved by the game engine"
      }
    >
      {schema === 2 ? "v2" : "v1"}
    </span>
  );
}

/**
 * Nothing to show: no character, of either schema, has ever reported.
 *
 * It is also the v1 fallback for a selection the stream lookup cannot resolve — a state that does
 * not arise, since the list and the lookup are both built from the same render's `streamed`. That
 * branch stays because it is what narrows the selected character to a non-optional one.
 */
function NoCharacters() {
  return (
    <EmptyState
      icon={UserIcon}
      title="No live characters yet"
      description="Character state appears here once a running profile reports it. Start a profile to begin tracking."
    />
  );
}

export function CharacterViewer() {
  const streamed = useCharacters();
  const profiles = useProfiles();

  // A profile fills exactly one stack — decided by the engine DLL it runs — so the two lists are
  // normally disjoint. Where they do overlap (a profile that changed engines) v2 wins: it is the
  // richer capture and the one still being written.
  const capturedSummaries = useCapturedSummaries();

  const entries = useMemo<ListEntry[]>(() => {
    // Per profile: how many captures it holds, and which reported last. Both are what the row
    // needs to say beyond its own summary — whether its name is enough, and whether it is live.
    const perProfile = new Map<
      string,
      { count: number; latest: CharacterSummary }
    >();
    for (const s of capturedSummaries ?? []) {
      if (!s.key) continue;
      const seen = perProfile.get(s.key.profile);
      perProfile.set(s.key.profile, {
        count: (seen?.count ?? 0) + 1,
        latest: seen ? laterOf(seen.latest, s) : s,
      });
    }

    const captured = (capturedSummaries ?? []).flatMap<ListEntry>((s) => {
      if (!s.key) return [];
      const group = perProfile.get(s.key.profile)!;
      return [
        {
          id: captureMapKey(s.key),
          key: s.key,
          profile: s.key.profile,
          charName: s.key.name,
          account: s.identity?.account ?? "",
          realm: s.identity?.realm ?? "",
          schema: 2,
          latest: group.latest === s,
          ambiguous: group.count > 1,
        },
      ];
    });
    return [
      ...captured,
      ...streamed
        .filter((c) => !perProfile.has(c.profile))
        .map<ListEntry>((c) => ({
          id: c.profile,
          profile: c.profile,
          charName: c.charName,
          account: c.account,
          realm: c.realm,
          schema: 1,
          latest: true,
          ambiguous: false,
        })),
    ];
  }, [streamed, capturedSummaries]);

  // Online is derived from the owning profile's run state (keyed by name), so it tracks
  // start/stop live and never goes stale on a persisted character.
  const onlineProfiles = useMemo(
    () =>
      new Set(
        profiles
          .filter((p) => isActive(p.status?.state))
          .map((p) => p.profile.name),
      ),
    [profiles],
  );
  const isOnline = (entry: ListEntry) =>
    entry.latest && onlineProfiles.has(entry.profile);

  // Online characters first (stable within each group, so the natural order is otherwise
  // preserved). Drives both the dropdown order and the default selection below.
  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          (a.latest && onlineProfiles.has(a.profile) ? 0 : 1) -
          (b.latest && onlineProfiles.has(b.profile) ? 0 : 1),
      ),
    [entries, onlineProfiles],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (sorted.length === 0) return undefined;
    return sorted.find((c) => c.id === selectedId) ?? sorted[0];
  }, [sorted, selectedId]);

  // A v2 entry is only a summary. The whole capture is a separate pull and the tables it needs to
  // resolve sprites are a lazy chunk, so both arrive after the list does — and only for v2, so
  // selecting a v1 character costs neither request.
  const isCaptured = selected?.schema === 2;
  const { data: capturedDetail } = useCapturedCharacter(
    isCaptured ? selected.key : null,
  );
  const engine = useToolkit(!!isCaptured);

  // On entering the view, default to the first online character (falling back to the first
  // character when none are online). We commit that pick to state once — rather than leaving the
  // selection implicit — so it stays put as profiles start/stop and the list re-sorts underneath;
  // the user's later picks win.
  //
  // The same commit covers a selection that stops existing — a v1 character can drop out of the
  // stream, a capture can be forgotten. `selected` falls back to the first entry for the render,
  // and without writing that back the state would go on naming the vanished one, so the view
  // would jump back to it if it ever returned.
  useEffect(() => {
    if (sorted.length === 0) return;
    const stillThere = sorted.some((c) => c.id === selectedId);
    if (selectedId !== null && stillThere) return;
    setSelectedId(sorted[0].id);
  }, [selectedId, sorted]);

  const streamedSelected = useMemo(
    () =>
      selected && !isCaptured
        ? streamed.find((c) => c.profile === selected.profile)
        : undefined,
    [selected, isCaptured, streamed],
  );

  if (!selected) {
    return <NoCharacters />;
  }

  const selector = (
    <CharacterSelector
      entries={sorted}
      selected={selected}
      onSelect={setSelectedId}
      isOnline={isOnline}
    />
  );
  const online = isOnline(selected);

  // Neither view below is keyed on the character. The tab strip lives inside them, so remounting
  // one per switch would throw a reader on Progression or Analytics back to Inventory; the panels
  // that genuinely have to re-default per character carry keys of their own instead.
  if (isCaptured) {
    // The list knows this character exists before the capture arrives — it is a separate pull, and
    // the cache is keyed per capture, so EVERY switch to a v2 character passes through here.
    // Rendering the chrome against a half-filled message would show a level 0 nobody, so the body
    // waits for the pull; the picker does not, or the reader would lose the only way back out.
    if (!capturedDetail) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {selector}
          </div>
          <EmptyState
            icon={UserIcon}
            title={`Loading ${selected.charName || selected.profile}`}
            description="Reading the character's capture."
          />
        </div>
      );
    }
    return (
      <CapturedCharacterView
        captured={capturedDetail}
        engine={engine}
        online={online}
        selector={selector}
      />
    );
  }

  if (!streamedSelected) {
    return <NoCharacters />;
  }

  return (
    <StreamedCharacterView
      character={streamedSelected}
      online={online}
      selector={selector}
    />
  );
}

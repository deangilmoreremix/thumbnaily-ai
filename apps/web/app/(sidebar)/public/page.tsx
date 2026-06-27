"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, Search, X } from "lucide-react";
import { appCache } from "@/lib/cache";
import { cn } from "@/lib/utils";

interface Thumbnail {
  id: string;
  link: string;
  prompt: string;
  createdAt: string;
  tags: string[] | null;
  mood: string | null;
  palette: string | null;
  subject: string | null;
  critic_score: number | null;
}

interface ExploreState {
  thumbnails: Thumbnail[];
  cursor: string | null;
  hasMore: boolean;
}

interface Facets {
  moods: string[];
  palettes: string[];
  tags: string[];
}

const CACHE_KEY = "explore";

export default function ExplorePage() {
  const cached = appCache.get<ExploreState>(CACHE_KEY);

  const [thumbnails, setThumbnails] = useState<Thumbnail[]>(
    cached?.thumbnails ?? []
  );
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(!cached);
  const [mood, setMood] = useState<string>("all");
  const [palette, setPalette] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [facets, setFacets] = useState<Facets>({
    moods: [],
    palettes: [],
    tags: [],
  });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const filtersRef = useRef({ mood, palette, tag, debouncedSearch });
  filtersRef.current = { mood, palette, tag, debouncedSearch };

  const fetchPage = useCallback(
    async (pageCursor: string | null, replace = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);

      const params = new URLSearchParams({ limit: "15" });
      if (pageCursor) params.set("cursor", pageCursor);
      if (filtersRef.current.mood !== "all")
        params.set("mood", filtersRef.current.mood);
      if (filtersRef.current.palette !== "all")
        params.set("palette", filtersRef.current.palette);
      if (filtersRef.current.tag !== "all")
        params.set("tag", filtersRef.current.tag);
      if (filtersRef.current.debouncedSearch)
        params.set("q", filtersRef.current.debouncedSearch);

      try {
        const res = await fetch(`/api/explore?${params}`);
        const json = (await res.json()) as {
          data?: Thumbnail[];
          nextCursor?: string | null;
          facets?: Facets;
        };
        const fresh = Array.isArray(json.data) ? json.data : [];
        setThumbnails((prev) => {
          const next = replace
            ? fresh
            : (() => {
                const ids = new Set(prev.map((t) => t.id));
                return [...prev, ...fresh.filter((t) => !ids.has(t.id))];
              })();
          appCache.set(CACHE_KEY, {
            thumbnails: next,
            cursor: json.nextCursor ?? null,
            hasMore: !!json.nextCursor,
          } satisfies ExploreState);
          return next;
        });
        setCursor(json.nextCursor ?? null);
        setHasMore(!!json.nextCursor);
        if (json.facets) setFacets(json.facets);
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setInitialLoad(false);
      }
    },
    []
  );

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Refetch on filter change
  useEffect(() => {
    fetchPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, palette, tag, debouncedSearch]);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current && hasMore) {
          fetchPage(cursor);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, hasMore, fetchPage]);

  const clearFilters = () => {
    setMood("all");
    setPalette("all");
    setTag("all");
    setSearch("");
  };

  const hasFilters =
    mood !== "all" || palette !== "all" || tag !== "all" || search !== "";

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Explore
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Thumbnails created by the community.
        </p>
      </div>

      {/* Search + filters */}
      <div className="space-y-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts, subjects…"
            className="w-full pl-9 pr-3 h-10 rounded-lg border border-border/60 bg-card/30 text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <FilterPills
            label="Mood"
            value={mood}
            options={["all", ...facets.moods]}
            onChange={setMood}
          />
          <FilterPills
            label="Palette"
            value={palette}
            options={["all", ...facets.palettes]}
            onChange={setPalette}
          />
          {facets.tags.length > 0 && (
            <FilterPills
              label="Tag"
              value={tag}
              options={["all", ...facets.tags.slice(0, 12)]}
              onChange={setTag}
            />
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {initialLoad && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!initialLoad && thumbnails.length === 0 && (
        <div className="text-center py-20">
          <p className="text-muted-foreground">
            {hasFilters
              ? "No thumbnails match these filters."
              : "No thumbnails yet."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {thumbnails.map((t) => (
          <Link
            key={t.id}
            href={`/public/${t.id}`}
            className="group relative rounded-xl overflow-hidden border border-border/50"
          >
            <Image
              src={t.link}
              width={1920}
              height={1080}
              alt="Thumbnail"
              className="w-full transition-transform duration-300 group-hover:scale-[1.02]"
              unoptimized
            />
            {t.critic_score != null && (
              <span className="absolute top-2 right-2 text-[10px] bg-background/85 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/40 tabular-nums">
                {t.critic_score}
              </span>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-3">
              <div className="space-y-1 w-full">
                {t.mood && (
                  <span className="text-[10px] uppercase tracking-wide text-white/80">
                    {t.mood}
                  </span>
                )}
                <span className="text-xs text-white/80 line-clamp-2 block">
                  {t.prompt}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div ref={sentinelRef} className="py-8 flex justify-center">
        {loading && !initialLoad && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {!hasMore && thumbnails.length > 0 && (
          <p className="text-xs text-muted-foreground/50">
            You&apos;ve seen them all.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const displayValue =
    value === "all" ? label : value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border whitespace-nowrap",
          value !== "all"
            ? "border-foreground/40 bg-foreground/5"
            : "border-border/60 bg-card/30 hover:bg-card/50"
        )}
      >
        {displayValue}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 min-w-[140px] max-h-64 overflow-y-auto rounded-md border border-border/60 bg-popover shadow-md">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted capitalize",
                value === opt && "bg-foreground/5 font-medium"
              )}
            >
              {opt === "all" ? `All ${label.toLowerCase()}` : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
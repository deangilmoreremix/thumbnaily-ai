"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, Lock, Globe, RefreshCw, Inbox } from "lucide-react";
import { appCache } from "@/lib/cache";

interface Thumbnail {
  id: string;
  link: string;
  prompt: string;
  createdAt: string;
  isPublic: boolean;
  mode: string | null;
}

interface MyState {
  thumbnails: Thumbnail[];
  cursor: string | null;
  hasMore: boolean;
}

const CACHE_KEY = "my-thumbnails";

export default function MyThumbnailsPage() {
  const cached = appCache.get<MyState>(CACHE_KEY);

  const [thumbnails, setThumbnails] = useState<Thumbnail[]>(
    cached?.thumbnails ?? []
  );
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(!cached);
  const [refreshKey, setRefreshKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (pageCursor: string | null, replace = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);

      const params = new URLSearchParams({ limit: "24" });
      if (pageCursor) params.set("cursor", pageCursor);

      try {
        const res = await fetch(`/api/my-thumbnails?${params}`);
        const json = (await res.json()) as {
          data?: Thumbnail[];
          nextCursor?: string | null;
        };
        const fresh = Array.isArray(json.data) ? json.data : [];
        setThumbnails((prev) => {
          const next = replace ? fresh : (() => {
            const ids = new Set(prev.map((t) => t.id));
            return [...prev, ...fresh.filter((t) => !ids.has(t.id))];
          })();
          appCache.set(CACHE_KEY, {
            thumbnails: next,
            cursor: json.nextCursor ?? null,
            hasMore: !!json.nextCursor,
          } satisfies MyState);
          return next;
        });
        setCursor(json.nextCursor ?? null);
        setHasMore(!!json.nextCursor);
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setInitialLoad(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!cached) fetchPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

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

  const refresh = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            My Thumbnails
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every thumbnail you&apos;ve generated, public and private.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/60 hover:bg-card/40 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {initialLoad && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!initialLoad && thumbnails.length === 0 && (
        <div className="text-center py-20 border border-dashed border-border/60 rounded-xl">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">No thumbnails yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generated thumbnails will show up here automatically.
          </p>
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 mt-4 text-xs px-3 py-1.5 rounded-md bg-foreground text-background"
          >
            Generate your first thumbnail →
          </Link>
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
            <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full bg-background/80 backdrop-blur px-1.5 py-0.5 border border-border/40">
              {t.isPublic ? (
                <>
                  <Globe className="h-2.5 w-2.5" />
                  Public
                </>
              ) : (
                <>
                  <Lock className="h-2.5 w-2.5" />
                  Private
                </>
              )}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-3">
              <div className="text-[11px] text-white/80 line-clamp-2">
                {t.prompt}
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
            You&apos;ve reached the end.
          </p>
        )}
      </div>
    </div>
  );
}

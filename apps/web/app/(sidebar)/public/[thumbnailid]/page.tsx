"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import {
  Copy,
  User,
  Loader2,
  ArrowLeft,
  Wand2,
  Sparkles,
  ImageIcon,
  Pencil,
  X,
  Download,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Sora } from "next/font/google";
import { appCache } from "@/lib/cache";
import { consumeSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

interface ThumbnailRow {
  id: string;
  link: string;
  prompt: string;
  revised_prompt: string | null;
  createdAt: string;
  parent_id: string | null;
  mode: string | null;
  size: string | null;
  quality: string | null;
  format: string | null;
}

interface DetailsResponse {
  data: ThumbnailRow;
  parent: { id: string; link: string; prompt: string; createdAt: string } | null;
  variations: { id: string; link: string; prompt: string; createdAt: string; mode: string | null; parent_id: string | null }[];
  rootId: string;
  user: { name: string; avatar: string | null };
}

type StreamEvent =
  | { event: "progress"; data: { step: string; progress: number } }
  | { event: "partial"; data: { index: number; base64: string } }
  | { event: "complete"; data: { step: string; progress: number; imageUrl: string; thumbnailId: string | null; revisedPrompt: string | null } }
  | { event: "error"; data: { step: string; progress: number; message: string } };

const PRESET_REFINES = [
  { label: "More dramatic", instruction: "Make it more dramatic with intense lighting and stronger contrast" },
  { label: "Brighter", instruction: "Make it brighter with more vibrant, saturated colors" },
  { label: "Cinematic", instruction: "Make it more cinematic with deeper shadows and golden highlights" },
  { label: "Realistic", instruction: "Make it more photorealistic" },
  { label: "Ghibli style", instruction: "Convert to Studio Ghibli anime art style" },
  { label: "Darker mood", instruction: "Make it darker and moodier with deeper blacks" },
];

export default function ThumbnailDetails() {
  const { thumbnailid } = useParams<{ thumbnailid: string }>();
  const cacheKey = `details:${thumbnailid}`;
  const cached = appCache.get<DetailsResponse>(cacheKey);

  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState<DetailsResponse | null>(cached ?? null);
  const [showRevise, setShowRevise] = useState(false);
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineProgress, setRefineProgress] = useState<{
    step: string;
    progress: number;
    partialBase64?: string;
    resultUrl?: string;
    error?: string;
  }>({ step: "", progress: 0 });
  const [resultIds, setResultIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const loadDetails = useCallback(
    async (force = false) => {
      if (!force && cached) {
        setData(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      const response = await axios.post<DetailsResponse>("/api/getdetails", {
        thumbnailid,
      });
      setData(response.data);
      appCache.set(cacheKey, response.data);
      setLoading(false);
    },
    [thumbnailid, cacheKey, cached]
  );

  useEffect(() => {
    loadDetails(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbnailid]);

  const consumeStream = useCallback(async (response: Response) => {
    await consumeSSE(response, {
      onProgress: (data) =>
        setRefineProgress((p) => ({
          ...p,
          step: data.step ?? p.step,
          progress:
            typeof data.progress === "number" ? data.progress : p.progress,
        })),
      onPartial: (data) =>
        setRefineProgress((p) => ({
          ...p,
          partialBase64: data.base64 ?? p.partialBase64,
        })),
      onComplete: (data) => {
        setRefineProgress({
          step: "Complete",
          progress: 100,
          resultUrl: data.imageUrl ?? "",
        });
        const newId = typeof data.thumbnailId === "string" ? data.thumbnailId : null;
        if (newId) setResultIds((s) => new Set(s).add(newId));
        appCache.del("explore");
        appCache.del("my-thumbnails");
        appCache.del(`details:${thumbnailid}`);
        toast("Variation created!");
      },
      onError: (data) =>
        setRefineProgress({
          step: "Error",
          progress: 0,
          error: data.message ?? "Unknown error",
        }),
    });
  }, [thumbnailid]);

  async function startRefine(instruction: string) {
    if (!data) return;
    if (!instruction.trim()) {
      toast("Please describe the refinement.");
      return;
    }
    setRefining(true);
    setRefineProgress({ step: "Initializing", progress: 0, partialBase64: undefined });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "refine",
          thumbnailId: data.data.id,
          instruction,
          isPublic: true,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        let msg = `Request failed: ${response.status}`;
        try {
          const j = (await response.json()) as { message?: string; error?: string };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      await consumeStream(response);
      // Refresh details to include new variation
      await loadDetails(true);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        toast("Refinement cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : "Failed to refine";
        toast(msg);
        setRefineProgress({ step: "Error", progress: 0, error: msg });
      }
    } finally {
      setRefining(false);
      abortRef.current = null;
    }
  }

  function cancelRefine() {
    abortRef.current?.abort();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const allVariations = [
    {
      id: data.data.id,
      link: data.data.link,
      prompt: data.data.prompt,
      createdAt: data.data.createdAt,
      mode: data.data.mode,
      parent_id: data.data.parent_id,
    },
    ...data.variations,
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
      <Link
        href="/public"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to explore
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 lg:gap-10">
        {/* Main: current image + variations */}
        <div className="space-y-6">
          <div className="rounded-xl overflow-hidden border border-border/50">
            <Image
              src={data.data.link}
              width={1920}
              height={1080}
              alt="Thumbnail"
              className="w-full"
              unoptimized
              priority
            />
          </div>

          <div className="flex items-center gap-3">
            {data.user.avatar ? (
              <Image
                src={data.user.avatar}
                width={40}
                height={40}
                alt="Creator"
                className="rounded-full border border-border/50"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium">{data.user.name}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(data.data.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                {data.data.mode && data.data.mode !== "generate" && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                    {data.data.mode === "edit" ? (
                      <Pencil className="h-2.5 w-2.5" />
                    ) : (
                      <Wand2 className="h-2.5 w-2.5" />
                    )}
                    {data.data.mode}
                  </span>
                )}
              </p>
            </div>
            <div className="flex-1" />
            <a
              href={data.data.link}
              download
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/60 hover:bg-card/40"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          </div>

          {/* Variation tree */}
          {allVariations.length > 1 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Variations ({allVariations.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allVariations.map((v) => {
                  const isActive = v.id === data.data.id;
                  const isFresh = resultIds.has(v.id);
                  return (
                    <Link
                      key={v.id}
                      href={`/public/${v.id}`}
                      className={cn(
                        "group relative rounded-lg overflow-hidden border transition-colors",
                        isActive
                          ? "border-foreground ring-2 ring-foreground/30"
                          : "border-border/40 hover:border-foreground/40",
                        isFresh && "ring-2 ring-green-500/40"
                      )}
                    >
                      <div className="relative aspect-video">
                        <Image
                          src={v.link}
                          alt="Variation"
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      {isFresh && (
                        <span className="absolute top-1.5 right-1.5 text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-full">
                          New
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: prompt + refine */}
        <aside className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-lg font-semibold ${sora.className}`}>
                Prompt Used
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg border-border/50 gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(
                    data.data.revised_prompt ?? data.data.prompt
                  );
                  toast("Prompt copied to clipboard");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <div className="p-4 rounded-xl border border-border/50 bg-card/30">
              {data.data.revised_prompt &&
              data.data.revised_prompt !== data.data.prompt ? (
                <>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Revised by AI
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">
                    {data.data.revised_prompt}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {data.data.prompt}
                </p>
              )}
            </div>
          </div>

          {/* Refine panel */}
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRevise((v) => !v)}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Refine this thumbnail
              </span>
              <span className="text-xs text-muted-foreground">
                {showRevise ? "Hide" : "Show"}
              </span>
            </button>
            {showRevise && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Use multi-turn editing to create variations that share context with this image.
                </p>

                <div className="grid grid-cols-2 gap-2">
                  {PRESET_REFINES.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={refining}
                      onClick={() => {
                        setReviseInstruction(p.instruction);
                        startRefine(p.instruction);
                      }}
                      className="text-left text-xs px-2.5 py-2 rounded-md border border-border/60 hover:border-foreground/40 hover:bg-card/40 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Or write a custom instruction…"
                    value={reviseInstruction}
                    onChange={(e) => setReviseInstruction(e.target.value)}
                    disabled={refining}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !refining && reviseInstruction.trim()) {
                        startRefine(reviseInstruction);
                      }
                    }}
                    className="h-9"
                  />
                  {refining ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancelRefine}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => startRefine(reviseInstruction)}
                      disabled={!reviseInstruction.trim()}
                      className="gap-1.5"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Go
                    </Button>
                  )}
                </div>

                {refining && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {refineProgress.step || "Starting"}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {refineProgress.progress}%
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-foreground transition-all"
                        style={{ width: `${refineProgress.progress}%` }}
                      />
                    </div>
                    {refineProgress.partialBase64 && (
                      <div className="relative aspect-video w-full rounded-md overflow-hidden border border-border/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`data:image/png;base64,${refineProgress.partialBase64}`}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}
                {refineProgress.error && !refining && (
                  <p className="text-xs text-destructive">{refineProgress.error}</p>
                )}
              </div>
            )}
          </div>

          {(data.data.size || data.data.format || data.data.quality) && (
            <div className="text-xs text-muted-foreground flex items-center gap-3 px-1">
              {data.data.size && <span>{data.data.size}</span>}
              {data.data.quality && <span>{data.data.quality}</span>}
              {data.data.format && <span>{data.data.format.toUpperCase()}</span>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

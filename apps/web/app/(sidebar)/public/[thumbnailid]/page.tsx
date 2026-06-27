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
  Type,
  Image as ImageIcon2,
  Layers,
  GitBranch,
  TrendingUp,
  Tag,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ArrowRight,
  ChevronDown,
  ChevronRight,
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
  caption: string | null;
  critic_score: number | null;
  critic_notes: string | null;
  critic_suggestions: string[] | null;
  mood: string | null;
  palette: string | null;
  subject: string | null;
  tags: string[] | null;
  style: string | null;
  template: string | null;
}

interface VariationRow {
  id: string;
  link: string;
  prompt: string;
  createdAt: string;
  mode: string | null;
  parent_id: string | null;
  caption: string | null;
  critic_score: number | null;
  mood: string | null;
  palette: string | null;
  tags: string[] | null;
  style: string | null;
  template: string | null;
}

interface ChannelRow {
  id: string;
  platform: string;
  size: string;
  link: string;
}

interface DetailsResponse {
  data: ThumbnailRow;
  parent: { id: string; link: string; prompt: string; createdAt: string; mode: string | null } | null;
  variations: VariationRow[];
  rootId: string;
  channels: ChannelRow[];
  user: { name: string; avatar: string | null };
}

const PRESET_REFINES = [
  { label: "More dramatic", instruction: "Make it more dramatic with intense lighting and stronger contrast" },
  { label: "Brighter", instruction: "Make it brighter with more vibrant, saturated colors" },
  { label: "Cinematic", instruction: "Make it more cinematic with deeper shadows and golden highlights" },
  { label: "Realistic", instruction: "Make it more photorealistic" },
  { label: "Ghibli style", instruction: "Convert to Studio Ghibli anime art style" },
  { label: "Darker mood", instruction: "Make it darker and moodier with deeper blacks" },
];

type ActionMode = "refine" | "caption" | "background" | "channel";

interface ActionState {
  mode: ActionMode;
  loading: boolean;
  step: string;
  progress: number;
  partialBase64?: string;
  resultUrl?: string;
  error?: string;
}

export default function ThumbnailDetails() {
  const { thumbnailid } = useParams<{ thumbnailid: string }>();
  const cacheKey = `details:${thumbnailid}`;
  const cached = appCache.get<DetailsResponse>(cacheKey);

  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState<DetailsResponse | null>(cached ?? null);
  const [showRevise, setShowRevise] = useState(false);
  const [reviseInstruction, setReviseInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [resultIds, setResultIds] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  // New action panels
  const [showCaption, setShowCaption] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [captionPosition, setCaptionPosition] = useState<"top" | "center" | "bottom">("bottom");

  const [showBackground, setShowBackground] = useState(false);
  const [backgroundPrompt, setBackgroundPrompt] = useState("");

  const [showChannel, setShowChannel] = useState(false);
  const [channelPlatforms, setChannelPlatforms] = useState<{
    youtube: boolean;
    instagram: boolean;
    tiktok: boolean;
  }>({ youtube: true, instagram: true, tiktok: true });

  const [action, setAction] = useState<ActionState>({
    mode: "refine",
    loading: false,
    step: "",
    progress: 0,
  });

  const [showPromptDiff, setShowPromptDiff] = useState(false);
  const [showConversationTree, setShowConversationTree] = useState(false);
  const [criticLoading, setCriticLoading] = useState(false);
  const [critic, setCritic] = useState<{
    score: number;
    notes: string;
    suggestions: string[];
  } | null>(
    data?.data.critic_score != null && data?.data.critic_notes
      ? {
          score: data.data.critic_score,
          notes: data.data.critic_notes,
          suggestions: data.data.critic_suggestions ?? [],
        }
      : null
  );

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

  const consumeStream = useCallback(
    async (response: Response) => {
      await consumeSSE(response, {
        onProgress: (data) =>
          setAction((a) => ({
            ...a,
            step: data.step ?? a.step,
            progress:
              typeof data.progress === "number" ? data.progress : a.progress,
          })),
        onPartial: (data) =>
          setAction((a) => ({ ...a, partialBase64: data.base64 ?? a.partialBase64 })),
        onComplete: (data) => {
          setAction((a) => ({
            ...a,
            loading: false,
            step: "Complete",
            progress: 100,
            resultUrl: data.imageUrl,
          }));
          const newId =
            typeof data.thumbnailId === "string" ? data.thumbnailId : null;
          if (newId) setResultIds((s) => new Set(s).add(newId));
          appCache.del("explore");
          appCache.del("my-thumbnails");
          appCache.del(`details:${thumbnailid}`);
          toast("Done!");
          loadDetails(true);
        },
        onError: (data) =>
          setAction({
            mode: action.mode,
            loading: false,
            step: "Error",
            progress: 0,
            error: data.message ?? "Unknown error",
          }),
      });
    },
    [thumbnailid, loadDetails, action.mode]
  );

  async function runAction(
    endpoint: string,
    body: Record<string, unknown>,
    mode: ActionMode
  ) {
    if (!data) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAction({ mode, loading: true, step: "Initializing", progress: 0 });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        toast("Cancelled.");
      } else {
        const msg = err instanceof Error ? err.message : "Failed";
        toast(msg);
        setAction({ mode, loading: false, step: "Error", progress: 0, error: msg });
      }
    } finally {
      abortRef.current = null;
    }
  }

  async function startRefine(instruction: string) {
    await runAction(
      "/api/generate-thumbnail",
      {
        mode: "refine",
        thumbnailId: data?.data.id,
        instruction,
        isPublic: true,
      },
      "refine"
    );
  }

  async function renderCaption() {
    if (!captionText.trim()) {
      toast("Enter caption text");
      return;
    }
    await runAction(
      "/api/generate-thumbnail",
      {
        mode: "caption",
        thumbnailId: data?.data.id,
        text: captionText,
        position: captionPosition,
        isPublic: true,
      },
      "caption"
    );
    setShowCaption(false);
    setCaptionText("");
  }

  async function replaceBackground() {
    if (!backgroundPrompt.trim()) {
      toast("Describe the new background");
      return;
    }
    await runAction(
      "/api/generate-thumbnail",
      {
        mode: "background",
        thumbnailId: data?.data.id,
        prompt: backgroundPrompt,
        isPublic: true,
      },
      "background"
    );
    setShowBackground(false);
    setBackgroundPrompt("");
  }

  async function generateChannels() {
    const channels: { platform: string; size: "1024x1024" | "1024x1536" | "1536x1024" }[] = [];
    if (channelPlatforms.youtube) channels.push({ platform: "youtube", size: "1536x1024" });
    if (channelPlatforms.instagram) channels.push({ platform: "instagram", size: "1024x1024" });
    if (channelPlatforms.tiktok) channels.push({ platform: "tiktok", size: "1024x1536" });
    if (channels.length === 0) {
      toast("Select at least one platform");
      return;
    }
    await runAction(
      "/api/generate-thumbnail",
      {
        mode: "channel",
        thumbnailId: data?.data.id,
        channels,
        isPublic: true,
      },
      "channel"
    );
    setShowChannel(false);
  }

  async function runCritic() {
    if (!data) return;
    setCriticLoading(true);
    try {
      const res = await fetch("/api/thumbnail-critic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thumbnailId: data.data.id,
          persist: true,
        }),
      });
      if (!res.ok) throw new Error("Critic failed");
      const j = (await res.json()) as {
        score: number;
        notes: string;
        suggestions: string[];
        mood: string;
        palette: string;
        subject: string;
        tags: string[];
      };
      setCritic({ score: j.score, notes: j.notes, suggestions: j.suggestions });
      toast(`Score: ${j.score}/100`);
      loadDetails(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      toast(msg);
    } finally {
      setCriticLoading(false);
    }
  }

  function cancelAction() {
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
      caption: data.data.caption,
      critic_score: data.data.critic_score,
      mood: data.data.mood,
      palette: data.data.palette,
      tags: data.data.tags,
      style: data.data.style,
      template: data.data.template,
    },
    ...data.variations,
  ];

  const criticScore = critic?.score ?? data.data.critic_score ?? null;
  const criticNotes = critic?.notes ?? data.data.critic_notes ?? null;
  const criticSuggestions =
    critic?.suggestions ?? data.data.critic_suggestions ?? [];

  const scoreColor =
    criticScore == null
      ? "text-muted-foreground"
      : criticScore >= 80
      ? "text-green-500"
      : criticScore >= 60
      ? "text-yellow-500"
      : "text-red-500";

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

          <div className="flex items-center gap-3 flex-wrap">
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
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {data.data.mode && data.data.mode !== "generate" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {data.data.mode === "edit" ? (
                    <Pencil className="h-2.5 w-2.5" />
                  ) : data.data.mode === "caption" ? (
                    <Type className="h-2.5 w-2.5" />
                  ) : data.data.mode === "background" ? (
                    <ImageIcon2 className="h-2.5 w-2.5" />
                  ) : data.data.mode === "variants" ? (
                    <Layers className="h-2.5 w-2.5" />
                  ) : (
                    <Wand2 className="h-2.5 w-2.5" />
                  )}
                  {data.data.mode}
                </span>
              )}
              {data.data.template && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  <Tag className="h-2.5 w-2.5" />
                  {data.data.template}
                </span>
              )}
              {data.data.style && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {data.data.style}
                </span>
              )}
              {data.data.mood && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {data.data.mood}
                </span>
              )}
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

          {/* Tags */}
          {data.data.tags && data.data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.data.tags.map((t) => (
                <span
                  key={t}
                  className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Channel variants */}
          {data.channels && data.channels.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Channel Variants ({data.channels.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {data.channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="rounded-lg overflow-hidden border border-border/50"
                  >
                    <div className="relative aspect-video">
                      <Image
                        src={ch.link}
                        alt={ch.platform}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide">
                      <span className="font-semibold">{ch.platform}</span>
                      <span className="text-muted-foreground">{ch.size}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Variation tree */}
          {allVariations.length > 1 && (
            <div>
              <button
                onClick={() => setShowConversationTree((v) => !v)}
                className="text-sm font-semibold mb-3 flex items-center gap-2"
              >
                {showConversationTree ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <GitBranch className="h-4 w-4" />
                Conversation ({allVariations.length})
              </button>
              {showConversationTree && (
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
                        {v.critic_score != null && (
                          <span className="absolute top-1.5 left-1.5 text-[10px] bg-background/85 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/40 tabular-nums">
                            {v.critic_score}
                          </span>
                        )}
                        {v.mode && v.mode !== "generate" && (
                          <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-background/85 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/40 uppercase tracking-wide">
                            {v.mode}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar: actions + prompt + critic */}
        <aside className="space-y-5">
          {/* Critic widget */}
          <div className="rounded-xl border border-border/60 bg-card/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className={`text-sm font-semibold ${sora.className} flex items-center gap-1.5`}>
                <TrendingUp className="h-4 w-4" />
                Thumbnail Health
              </h2>
              <button
                type="button"
                onClick={runCritic}
                disabled={criticLoading || action.loading}
                className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 inline-flex items-center gap-1"
              >
                {criticLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {criticScore == null ? "Analyze" : "Re-analyze"}
              </button>
            </div>

            {criticScore != null ? (
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <span className={cn("text-3xl font-bold tabular-nums", scoreColor)}>
                    {criticScore}
                  </span>
                  <span className="text-xs text-muted-foreground mb-1">/100</span>
                </div>
                {criticNotes && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {criticNotes}
                  </p>
                )}
                {criticSuggestions.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {criticSuggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <Lightbulb className="h-3 w-3 mt-0.5 shrink-0 text-yellow-500" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground pt-1">
                  Subject: {data.data.subject ?? "—"} · Palette: {data.data.palette ?? "—"}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Run an AI critique to get a CTR quality score and improvement suggestions.
              </p>
            )}
          </div>

          {/* Prompt panel with diff */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-lg font-semibold ${sora.className}`}>
                Prompt
              </h2>
              <div className="flex items-center gap-2">
                {data.data.revised_prompt &&
                  data.data.revised_prompt !== data.data.prompt && (
                    <button
                      type="button"
                      onClick={() => setShowPromptDiff((v) => !v)}
                      className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <GitBranch className="h-3 w-3" />
                      {showPromptDiff ? "Hide diff" : "Show diff"}
                    </button>
                  )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-border/50 gap-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      data.data.revised_prompt ?? data.data.prompt
                    );
                    toast("Prompt copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/50 bg-card/30 space-y-2">
              {showPromptDiff && data.data.revised_prompt ? (
                <PromptDiff
                  original={data.data.prompt}
                  revised={data.data.revised_prompt}
                />
              ) : data.data.revised_prompt &&
                data.data.revised_prompt !== data.data.prompt ? (
                <>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
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

          {/* Action: Refine */}
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShowRevise((v) => !v);
                setShowCaption(false);
                setShowBackground(false);
                setShowChannel(false);
              }}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Refine
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showRevise && "rotate-180"
                )}
              />
            </button>
            {showRevise && (
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_REFINES.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={action.loading}
                      onClick={() => startRefine(p.instruction)}
                      className="text-left text-xs px-2.5 py-2 rounded-md border border-border/60 hover:border-foreground/40 hover:bg-card/40 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Custom refinement…"
                    value={reviseInstruction}
                    onChange={(e) => setReviseInstruction(e.target.value)}
                    disabled={action.loading}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !action.loading &&
                        reviseInstruction.trim()
                      ) {
                        startRefine(reviseInstruction);
                      }
                    }}
                    className="h-9"
                  />
                  {action.loading && action.mode === "refine" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancelAction}
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
              </div>
            )}
          </div>

          {/* Action: Caption */}
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShowCaption((v) => !v);
                setShowRevise(false);
                setShowBackground(false);
                setShowChannel(false);
              }}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Type className="h-4 w-4" />
                Add Caption
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showCaption && "rotate-180"
                )}
              />
            </button>
            {showCaption && (
              <div className="px-4 pb-4 space-y-3">
                <Input
                  placeholder='e.g. "MIND BLOWN"'
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  disabled={action.loading}
                />
                <div className="flex items-center gap-1">
                  {(["top", "center", "bottom"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCaptionPosition(p)}
                      className={cn(
                        "flex-1 text-xs py-1.5 rounded-md border transition-colors capitalize",
                        captionPosition === p
                          ? "border-foreground/60 bg-foreground/5"
                          : "border-border/60 hover:border-foreground/40"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                {action.loading && action.mode === "caption" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelAction}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={renderCaption}
                    disabled={!captionText.trim()}
                    className="w-full gap-1.5"
                  >
                    <Type className="h-3.5 w-3.5" />
                    Render caption
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Action: Background */}
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShowBackground((v) => !v);
                setShowRevise(false);
                setShowCaption(false);
                setShowChannel(false);
              }}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <ImageIcon2 className="h-4 w-4" />
                Replace Background
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showBackground && "rotate-180"
                )}
              />
            </button>
            {showBackground && (
              <div className="px-4 pb-4 space-y-3">
                <textarea
                  placeholder="Describe the new background (e.g. 'sunset over Tokyo skyline')"
                  value={backgroundPrompt}
                  onChange={(e) => setBackgroundPrompt(e.target.value)}
                  disabled={action.loading}
                  rows={3}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none"
                />
                {action.loading && action.mode === "background" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelAction}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={replaceBackground}
                    disabled={!backgroundPrompt.trim()}
                    className="w-full gap-1.5"
                  >
                    <ImageIcon2 className="h-3.5 w-3.5" />
                    Replace
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Action: Multi-channel */}
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setShowChannel((v) => !v);
                setShowRevise(false);
                setShowCaption(false);
                setShowBackground(false);
              }}
              className="w-full flex items-center justify-between p-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Multi-Channel Resize
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  showChannel && "rotate-180"
                )}
              />
            </button>
            {showChannel && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Auto-recompose for each platform.
                </p>
                {(["youtube", "instagram", "tiktok"] as const).map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={channelPlatforms[p]}
                      onChange={(e) =>
                        setChannelPlatforms((s) => ({
                          ...s,
                          [p]: e.target.checked,
                        }))
                      }
                      className="rounded"
                    />
                    <span className="capitalize">{p}</span>
                    <span className="text-muted-foreground ml-auto">
                      {p === "youtube"
                        ? "16:9"
                        : p === "instagram"
                        ? "1:1"
                        : "9:16"}
                    </span>
                  </label>
                ))}
                {action.loading && action.mode === "channel" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelAction}
                    className="w-full"
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={generateChannels}
                    className="w-full gap-1.5"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Generate
                  </Button>
                )}
              </div>
            )}
          </div>

          {(action.loading || action.error) && (
            <div className="rounded-xl border border-border/60 bg-card/30 p-3 space-y-2">
              {action.loading && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {action.step}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {action.progress}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-foreground transition-all"
                      style={{ width: `${action.progress}%` }}
                    />
                  </div>
                  {action.partialBase64 && (
                    <div className="relative aspect-video w-full rounded-md overflow-hidden border border-border/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${action.partialBase64}`}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </>
              )}
              {action.error && (
                <p className="text-xs text-destructive">{action.error}</p>
              )}
            </div>
          )}

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

// Simple line-level diff renderer
function PromptDiff({ original, revised }: { original: string; revised: string }) {
  const originalWords = new Set(
    original.toLowerCase().split(/\s+/).filter(Boolean)
  );
  const revisedWords = revised.split(/(\s+)/);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Your prompt
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {original}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <ArrowRight className="h-2.5 w-2.5" />
          AI-revised
        </p>
        <p className="text-xs text-foreground leading-relaxed">
          {revisedWords.map((token, i) => {
            if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
            const isNew = !originalWords.has(token.toLowerCase().replace(/[^a-z0-9]/g, ""));
            return (
              <span
                key={i}
                className={cn(
                  isNew && "bg-green-500/15 text-green-700 dark:text-green-300 rounded px-0.5"
                )}
              >
                {token}
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
}
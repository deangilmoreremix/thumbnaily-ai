"use client";

import axios from "axios";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ImagePlus,
  ArrowUp,
  Loader2,
  X,
  Globe,
  Lock,
  Sparkles,
  Wand2,
  Pencil,
  Settings2,
  LayoutGrid,
  Lightbulb,
  Check,
  ChevronDown,
  History,
  Trash2,
  Library,
  Palette,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { Sora } from "next/font/google";
import { appCache } from "@/lib/cache";
import { consumeSSE } from "@/lib/sse";
import { cn } from "@/lib/utils";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

type Mode = "generate" | "edit";
type ImageSize = "auto" | "1024x1024" | "1024x1536" | "1536x1024";
type Quality = "auto" | "low" | "medium" | "high";
type ImgFormat = "png" | "jpeg" | "webp";
type Background = "auto" | "transparent" | "opaque";

interface ProgressState {
  step: string;
  progress: number;
  partialBase64?: string;
  partialVariantIndex?: number;
  imageUrl?: string;
  thumbnailId?: string;
  error?: string;
}

interface VariantResult {
  thumbnailId: string | null;
  imageUrl: string;
  angle: string;
  revisedPrompt: string | null;
}

interface CoachState {
  score: number;
  issues: string[];
  suggestions: string[];
  enhanced: string | null;
  loading: boolean;
}

interface Template {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  prefix: string;
  suffix: string | null;
  example_prompt: string | null;
  recommended_size: string | null;
  recommended_quality: string | null;
}

interface StylePreset {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  prompt_fragment: string;
}

interface HistoryEntry {
  id: string;
  videoTitle: string;
  externalPrompt: string;
  template: string | null;
  style: string | null;
  usedAt: number;
}

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SIZE_OPTIONS: { value: ImageSize; label: string }[] = [
  { value: "1024x1024", label: "Square (1:1)" },
  { value: "1024x1536", label: "Portrait (2:3)" },
  { value: "1536x1024", label: "Landscape (3:2)" },
  { value: "auto", label: "Auto" },
];

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "auto", label: "Auto" },
];

const FORMAT_OPTIONS: { value: ImgFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

const BACKGROUND_OPTIONS: { value: Background; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
];

interface DraftData {
  videoTitle: string;
  externalPrompt: string;
  imageLinks: string[];
  isPublic: boolean;
  mode: Mode;
  size: ImageSize;
  quality: Quality;
  format: ImgFormat;
  background: Background;
  templateSlug: string | null;
  styleSlug: string | null;
}

const HISTORY_KEY = "thumbnaily.history.v1";
const HISTORY_MAX = 25;

export default function GenerationPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const coachAbortRef = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [images, setImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [imageLinks, setImageLinks] = useState<string[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [mode, setMode] = useState<Mode>("generate");
  const [variantsMode, setVariantsMode] = useState(false);
  const [variantResults, setVariantResults] = useState<VariantResult[]>([]);

  const [videoTitle, setVideoTitle] = useState("");
  const [externalPrompt, setExternalPrompt] = useState("");

  const [size, setSize] = useState<ImageSize>("1536x1024");
  const [quality, setQuality] = useState<Quality>("medium");
  const [format, setFormat] = useState<ImgFormat>("png");
  const [background, setBackground] = useState<Background>("auto");

  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [styleSlug, setStyleSlug] = useState<string | null>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [uploadError, setUploadError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const [progressState, setProgressState] = useState<ProgressState>({
    step: "",
    progress: 0,
  });

  const [coach, setCoach] = useState<CoachState>({
    score: 0,
    issues: [],
    suggestions: [],
    enhanced: null,
    loading: false,
  });

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Load templates + styles + history on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j: { templates?: Template[]; styles?: StylePreset[] }) => {
        setTemplates(j.templates ?? []);
        setStyles(j.styles ?? []);
      })
      .catch(() => {});
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryEntry[]);
    } catch {
      /* ignore */
    }
  }, []);

  const draftData: DraftData = useMemo(
    () => ({
      videoTitle,
      externalPrompt,
      imageLinks,
      isPublic,
      mode,
      size,
      quality,
      format,
      background,
      templateSlug,
      styleSlug,
    }),
    [
      videoTitle,
      externalPrompt,
      imageLinks,
      isPublic,
      mode,
      size,
      quality,
      format,
      background,
      templateSlug,
      styleSlug,
    ]
  );

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // Draft auto-save
  useEffect(() => {
    if (
      !videoTitle &&
      !externalPrompt &&
      imageLinks.length === 0 &&
      mode === "generate" &&
      size === "1536x1024" &&
      quality === "medium" &&
      format === "png" &&
      background === "auto" &&
      !templateSlug &&
      !styleSlug
    ) {
      return;
    }
    const timeout = setTimeout(() => {
      localStorage.setItem("thumbnail-draft", JSON.stringify(draftData));
      setDraftSaved(true);
      const hide = setTimeout(() => setDraftSaved(false), 1500);
      return () => clearTimeout(hide);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [
    draftData,
    videoTitle,
    externalPrompt,
    imageLinks,
    mode,
    size,
    quality,
    format,
    background,
    templateSlug,
    styleSlug,
  ]);

  // Restore draft
  useEffect(() => {
    const savedDraft = localStorage.getItem("thumbnail-draft");
    if (!savedDraft) return;
    try {
      const parsed = JSON.parse(savedDraft) as Partial<DraftData>;
      setVideoTitle(parsed.videoTitle ?? "");
      setExternalPrompt(parsed.externalPrompt ?? "");
      setImageLinks(parsed.imageLinks ?? []);
      setIsPublic(parsed.isPublic ?? true);
      setMode(parsed.mode ?? "generate");
      setSize(parsed.size ?? "1536x1024");
      setQuality(parsed.quality ?? "medium");
      setFormat(parsed.format ?? "png");
      setBackground(parsed.background ?? "auto");
      setTemplateSlug(parsed.templateSlug ?? null);
      setStyleSlug(parsed.styleSlug ?? null);
      toast("Recovered previous draft");
    } catch (err) {
      console.error("Failed to restore draft:", err);
    }
  }, []);

  // Prompt coach: debounced critique as the user types
  useEffect(() => {
    if (!externalPrompt.trim() || externalPrompt.trim().length < 8) {
      setCoach({ score: 0, issues: [], suggestions: [], enhanced: null, loading: false });
      return;
    }
    coachAbortRef.current?.abort();
    const controller = new AbortController();
    coachAbortRef.current = controller;
    setCoach((c) => ({ ...c, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/prompt-coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: externalPrompt,
            videoTitle,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Coach failed");
        const j = (await res.json()) as Omit<CoachState, "loading">;
        setCoach({ ...j, loading: false });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setCoach((c) => ({ ...c, loading: false }));
      }
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [externalPrompt, videoTitle]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.slug === templateSlug) ?? null,
    [templates, templateSlug]
  );
  const selectedStyle = useMemo(
    () => styles.find((s) => s.slug === styleSlug) ?? null,
    [styles, styleSlug]
  );

  const composedPrompt = useMemo(() => {
    const parts: string[] = [];
    if (selectedTemplate?.prefix) parts.push(selectedTemplate.prefix);
    if (externalPrompt.trim()) parts.push(externalPrompt.trim());
    if (selectedStyle?.prompt_fragment)
      parts.push(`Style: ${selectedStyle.prompt_fragment}.`);
    if (selectedTemplate?.suffix) parts.push(selectedTemplate.suffix);
    return parts.join("\n\n");
  }, [selectedTemplate, selectedStyle, externalPrompt]);

  const uploadWithPresignedUrl = async (file: File): Promise<string> => {
    const response = await fetch("/api/presigned-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        `Failed to get upload URL: ${errorData.error || response.statusText}`
      );
    }
    const { fileUrl, key } = (await response.json()) as {
      fileUrl: string;
      key: string;
    };
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error: uploadError } = await supabase.storage
      .from("thumbnails")
      .upload(key, file);
    if (uploadError) {
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }
    return fileUrl;
  };

  const validateImage = (file: File): boolean => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("Please upload JPG, PNG, or WEBP");
      return false;
    }
    if (file.size > MAX_SIZE) {
      setUploadError("File must be under 20MB");
      return false;
    }
    if (file.size === 0) {
      setUploadError("File is corrupted or empty");
      return false;
    }
    return true;
  };

  const processSelectedFiles = async (files: File[]) => {
    setUploadError("");
    if (files.length === 0) return;
    if (files.length > 5) {
      setUploadError("You can upload up to 5 images.");
      return;
    }
    for (const file of files) {
      if (!validateImage(file)) return;
    }
    try {
      setUploading(true);
      setSelectedFiles(files);
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      const urls = files.map((file) => URL.createObjectURL(file));
      setPreviewUrls(urls);
      const uploadedLinks = await Promise.all(
        files.map((file) => uploadWithPresignedUrl(file))
      );
      setImageLinks(uploadedLinks);
    } catch (error) {
      console.error("Error uploading selected files:", error);
      setUploadError("Failed to upload one or more images.");
      setSelectedFiles([]);
      setImageLinks([]);
      setPreviewUrls([]);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    await processSelectedFiles(files);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) {
      toast("Please drop image files only.");
      return;
    }
    await processSelectedFiles(files);
  };

  const clearImages = () => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setSelectedFiles([]);
    setImageLinks([]);
    setPreviewUrls([]);
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const recordHistory = (entry: Omit<HistoryEntry, "id" | "usedAt">) => {
    setHistory((prev) => {
      const next: HistoryEntry[] = [
        { id: crypto.randomUUID(), usedAt: Date.now(), ...entry },
        ...prev.filter(
          (h) =>
            !(h.videoTitle === entry.videoTitle && h.externalPrompt === entry.externalPrompt)
        ),
      ].slice(0, HISTORY_MAX);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* quota */
      }
      return next;
    });
  };

  const consumeStream = useCallback(async (response: Response) => {
    await consumeSSE(response, {
      onProgress: (data) =>
        setProgressState((prev) => ({
          ...prev,
          step: data.step ?? prev.step,
          progress:
            typeof data.progress === "number" ? data.progress : prev.progress,
        })),
      onPartial: (data) =>
        setProgressState((prev) => ({
          ...prev,
          partialBase64: data.base64 ?? prev.partialBase64,
          partialVariantIndex:
            (data as { variantIndex?: number }).variantIndex ?? prev.partialVariantIndex,
        })),
      onComplete: (data) => {
        const variants = (data as { variants?: VariantResult[] }).variants;
        if (variants && variants.length > 0) {
          setVariantResults(variants);
          setProgressState({
            step: "Variants ready",
            progress: 100,
            imageUrl: variants[0]?.imageUrl,
            thumbnailId: variants[0]?.thumbnailId ?? undefined,
          });
        } else {
          setProgressState((prev) => ({
            ...prev,
            step: "Complete",
            progress: 100,
            imageUrl: data.imageUrl,
            thumbnailId: data.thumbnailId ?? undefined,
            revisedPrompt: data.revisedPrompt ?? undefined,
          }));
        }
      },
      onError: (data) =>
        setProgressState((prev) => ({
          ...prev,
          step: "Error",
          progress: 0,
          error: data.message ?? "Unknown error",
        })),
    });
  }, []);

  async function handleClick() {
    if (!videoTitle.trim()) {
      toast("Please enter the video title.");
      return;
    }
    if (!externalPrompt.trim()) {
      toast("Please enter a prompt.");
      return;
    }
    if (mode === "edit" && imageLinks.length === 0) {
      toast("Upload at least one image to edit.");
      return;
    }

    setLoading(true);
    setVariantResults([]);
    setProgressState({
      step: "Initializing...",
      progress: 0,
      partialBase64: undefined,
      partialVariantIndex: undefined,
      imageUrl: undefined,
    });

    const basicPrompt = [
      `Video title: ${videoTitle.trim()}`,
      `Visual brief: ${externalPrompt.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const finalPrompt = composedPrompt || basicPrompt;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/generate-thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: variantsMode ? "variants" : mode,
          basicPrompt: finalPrompt,
          isPublic,
          image_urls: imageLinks.length > 0 ? imageLinks : undefined,
          options: { size, quality, format, background },
          templateSlug,
          styleSlug,
          variantCount: variantsMode ? 4 : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let msg = `Request failed: ${response.status}`;
        try {
          const j = (await response.json()) as { error?: string; message?: string };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      await consumeStream(response);

      setProgressState((prev) => {
        if (prev.imageUrl) {
          localStorage.removeItem("thumbnail-draft");
          if (!variantsMode) {
            setImages((existing) => [...existing, prev.imageUrl as string]);
          }
          appCache.del("my-thumbnails");
          appCache.del("explore");
          toast(variantsMode ? "Variants generated!" : "Thumbnail generated!");
          recordHistory({
            videoTitle: videoTitle.trim(),
            externalPrompt: externalPrompt.trim(),
            template: templateSlug,
            style: styleSlug,
          });
        } else if (prev.error) {
          toast(`Error: ${prev.error}`);
        }
        return prev;
      });
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        toast("Generation cancelled.");
      } else {
        const message = err instanceof Error ? err.message : "Failed to generate";
        toast(message);
        setProgressState({ step: "Error", progress: 0, error: message });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  const cancel = () => {
    abortRef.current?.abort();
  };

  const applyEnhanced = () => {
    if (coach.enhanced) {
      setExternalPrompt(coach.enhanced);
      toast("Applied coach suggestions");
    }
  };

  const applyHistoryEntry = (entry: HistoryEntry) => {
    setVideoTitle(entry.videoTitle);
    setExternalPrompt(entry.externalPrompt);
    setTemplateSlug(entry.template);
    setStyleSlug(entry.style);
    setShowHistory(false);
    toast("Loaded from history");
  };

  const removeHistoryEntry = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
  };

  const coachColor =
    coach.score >= 85
      ? "text-green-500"
      : coach.score >= 60
      ? "text-yellow-500"
      : coach.score > 0
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <div className="w-full min-h-full">
      <div className="max-w-3xl mx-auto px-4 pt-12 md:pt-20 pb-12">
        <div className="text-center mb-8">
          <h1
            className={`text-3xl md:text-4xl font-bold tracking-tight ${sora.className}`}
          >
            Describe your thumbnail.
          </h1>
          <p className="text-muted-foreground mt-2">
            AI turns your words into click-worthy visuals.
          </p>
          {draftSaved && (
            <p className="text-sm text-green-500 mt-2">Draft Saved</p>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/30 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("generate");
                setVariantsMode(false);
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                mode === "generate" && !variantsMode
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Single
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("generate");
                setVariantsMode(true);
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                variantsMode
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              4 Variants
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("edit");
                setVariantsMode(false);
              }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                mode === "edit"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        </div>

        {/* Image drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={cn(
            "relative rounded-xl border border-dashed transition-colors cursor-pointer overflow-hidden",
            isDragging
              ? "border-foreground bg-foreground/5"
              : "border-border/60 hover:border-foreground/50 bg-card/30",
            uploading && "pointer-events-none opacity-60"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          {previewUrls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <ImagePlus className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                {mode === "edit"
                  ? "Upload images to edit (1–5)"
                  : "Drop reference images (optional, up to 5)"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                JPG, PNG or WEBP · max 20MB each
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 p-3">
              {previewUrls.map((url, idx) => (
                <div
                  key={url}
                  className="relative aspect-square rounded-md overflow-hidden border border-border/40"
                >
                  <Image
                    src={url}
                    alt={`Reference ${idx + 1}`}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearImages();
                }}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background border border-border/50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>

        {uploadError && (
          <p className="text-sm text-destructive mt-2">{uploadError}</p>
        )}

        {/* Inputs */}
        <div className="mt-6 space-y-3">
          <Input
            placeholder="Video title (e.g. How AI is changing Hollywood)"
            value={videoTitle}
            onChange={(e) => setVideoTitle(e.target.value)}
            disabled={loading}
            className="h-11 rounded-lg"
          />

          {/* Template + Style + History pickers row */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowTemplatePicker((v) => !v)}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                templateSlug
                  ? "border-foreground/40 bg-foreground/5"
                  : "border-border/60 bg-card/30 hover:bg-card/50"
              )}
            >
              <Library className="h-3.5 w-3.5" />
              {selectedTemplate ? selectedTemplate.name : "Template"}
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setShowStylePicker((v) => !v)}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                styleSlug
                  ? "border-foreground/40 bg-foreground/5"
                  : "border-border/60 bg-card/30 hover:bg-card/50"
              )}
            >
              <Palette className="h-3.5 w-3.5" />
              {selectedStyle ? selectedStyle.name : "Style"}
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              disabled={loading || history.length === 0}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/60 bg-card/30 hover:bg-card/50 disabled:opacity-50"
            >
              <History className="h-3.5 w-3.5" />
              History ({history.length})
            </button>
            {(templateSlug || styleSlug) && (
              <button
                type="button"
                onClick={() => {
                  setTemplateSlug(null);
                  setStyleSlug(null);
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          {/* Template picker dropdown */}
          {showTemplatePicker && (
            <div className="rounded-lg border border-border/60 bg-card/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Template
                </p>
                <button
                  onClick={() => setShowTemplatePicker(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTemplateSlug(t.slug === templateSlug ? null : t.slug);
                      if (t.recommended_size && t.recommended_size !== "auto") {
                        setSize(t.recommended_size as ImageSize);
                      }
                      if (t.recommended_quality && t.recommended_quality !== "auto") {
                        setQuality(t.recommended_quality as Quality);
                      }
                      setShowTemplatePicker(false);
                    }}
                    className={cn(
                      "text-left p-3 rounded-md border transition-colors",
                      templateSlug === t.slug
                        ? "border-foreground/60 bg-foreground/5"
                        : "border-border/40 hover:border-foreground/40"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{t.name}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t.category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {t.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Style picker dropdown */}
          {showStylePicker && (
            <div className="rounded-lg border border-border/60 bg-card/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Style
                </p>
                <button
                  onClick={() => setShowStylePicker(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {styles.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStyleSlug(s.slug === styleSlug ? null : s.slug);
                      setShowStylePicker(false);
                    }}
                    className={cn(
                      "text-left p-2.5 rounded-md border transition-colors",
                      styleSlug === s.slug
                        ? "border-foreground/60 bg-foreground/5"
                        : "border-border/40 hover:border-foreground/40"
                    )}
                  >
                    <p className="text-sm font-medium">{s.name}</p>
                    {s.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                        {s.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* History dropdown */}
          {showHistory && history.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-card/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={clearHistory}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </button>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="group flex items-start gap-2 p-2 rounded-md border border-border/40 hover:border-foreground/40"
                  >
                    <button
                      type="button"
                      onClick={() => applyHistoryEntry(h)}
                      className="flex-1 text-left"
                    >
                      <p className="text-sm font-medium line-clamp-1">
                        {h.videoTitle}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {h.externalPrompt}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        {h.template && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10">
                            {h.template}
                          </span>
                        )}
                        {h.style && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10">
                            {h.style}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeHistoryEntry(h.id)}
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <textarea
              placeholder={
                mode === "edit"
                  ? "Describe how to edit the uploaded image(s)…"
                  : "Describe the thumbnail you want (subjects, mood, lighting, text overlay, etc.)…"
              }
              value={externalPrompt}
              onChange={(e) => setExternalPrompt(e.target.value)}
              disabled={loading}
              rows={4}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none resize-none"
            />
          </div>

          {/* Prompt Coach */}
          {(coach.score > 0 || coach.loading) && (
            <div className="rounded-lg border border-border/60 bg-card/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Prompt Coach
                </p>
                {coach.loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span className={cn("text-sm font-semibold tabular-nums", coachColor)}>
                    {coach.score}/100
                  </span>
                )}
              </div>
              {!coach.loading && coach.issues.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                  {coach.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
              {!coach.loading && coach.suggestions.length > 0 && (
                <ul className="text-xs space-y-1 list-disc pl-4">
                  {coach.suggestions.map((s, i) => (
                    <li key={i} className="text-foreground/80">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {!coach.loading && coach.enhanced && coach.enhanced !== externalPrompt && (
                <button
                  type="button"
                  onClick={applyEnhanced}
                  className="w-full text-left text-xs px-3 py-2 rounded-md border border-border/60 bg-background/40 hover:border-foreground/40 flex items-start gap-2"
                >
                  <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-green-500" />
                  <span className="line-clamp-2">{coach.enhanced}</span>
                </button>
              )}
            </div>
          )}

          {/* Options panel */}
          <div className="rounded-lg border border-border/60 bg-card/30">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Image options
              </span>
              <span className="text-xs text-muted-foreground">
                {size} · {quality} · {format.toUpperCase()}
              </span>
            </button>
            {showOptions && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 pt-0">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Size</label>
                  <Select
                    value={size}
                    onValueChange={(v) => setSize(v as ImageSize)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIZE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Quality</label>
                  <Select
                    value={quality}
                    onValueChange={(v) => setQuality(v as Quality)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUALITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Format</label>
                  <Select
                    value={format}
                    onValueChange={(v) => setFormat(v as ImgFormat)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Background</label>
                  <Select
                    value={background}
                    onValueChange={(v) => setBackground(v as Background)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BACKGROUND_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          {/* Visibility + Generate */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
                isPublic
                  ? "border-border/60 bg-card/40 text-muted-foreground"
                  : "border-foreground/40 bg-foreground/5"
              )}
            >
              {isPublic ? (
                <Globe className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              {isPublic ? "Public" : "Private"}
            </button>

            <div className="flex-1" />

            {loading ? (
              <Button
                type="button"
                onClick={cancel}
                variant="outline"
                className="rounded-full px-5"
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleClick}
                disabled={loading}
                className="rounded-full px-5 gap-2"
              >
                <Wand2 className="h-4 w-4" />
                {variantsMode ? "Generate 4 Variants" : "Generate"}
                <ArrowUp className="h-4 w-4 -rotate-45" />
              </Button>
            )}
          </div>
        </div>

        {/* Variant results */}
        {variantResults.length > 0 && (
          <div className="mt-8 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Variants</h3>
              <button
                onClick={() => setVariantResults([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {variantResults.map((v, idx) => (
                <Link
                  key={idx}
                  href={v.thumbnailId ? `/public/${v.thumbnailId}` : "#"}
                  className="group relative rounded-xl overflow-hidden border border-border/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.imageUrl}
                    alt={`Variant ${idx + 1}`}
                    className="w-full aspect-video object-cover transition-transform group-hover:scale-[1.02]"
                  />
                  <div className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full bg-background/85 backdrop-blur px-2 py-0.5 border border-border/40">
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                    <span className="text-[11px] text-white/85 line-clamp-2">
                      {v.angle.replace(/^Variant [A-D]:\s*/, "")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Streaming preview + result (single mode) */}
        {!variantsMode && (loading || images.length > 0) && (
          <div className="mt-8 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="font-medium">
                  {progressState.step || "Ready"}
                </span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {progressState.progress}%
              </span>
            </div>

            <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
              <div
                className="h-full bg-foreground transition-all duration-300"
                style={{ width: `${progressState.progress}%` }}
              />
            </div>

            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted/30 border border-border/40">
              {progressState.partialBase64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/png;base64,${progressState.partialBase64}`}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              ) : images.length > 0 ? (
                <Image
                  src={images[images.length - 1] ?? ""}
                  alt="Generated"
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                  Waiting for AI…
                </div>
              )}
            </div>

            {progressState.imageUrl && (
              <div className="flex items-center justify-between mt-4 text-sm">
                <Link
                  href={`/public/${progressState.thumbnailId ?? ""}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  View details →
                </Link>
                <a
                  href={progressState.imageUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Download
                </a>
              </div>
            )}
          </div>
        )}

        {/* Variant-mode streaming preview */}
        {variantsMode && loading && progressState.partialBase64 && (
          <div className="mt-8 rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-medium">{progressState.step}</span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {progressState.progress}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
              <div
                className="h-full bg-foreground transition-all duration-300"
                style={{ width: `${progressState.progress}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((idx) => {
                const showHere =
                  progressState.partialBase64 &&
                  progressState.partialVariantIndex === idx;
                return (
                  <div
                    key={idx}
                    className="relative aspect-video rounded-md overflow-hidden bg-muted/30 border border-border/40"
                  >
                    {showHere ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/png;base64,${progressState.partialBase64}`}
                        alt={`Variant ${String.fromCharCode(65 + idx)} preview`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                        {String.fromCharCode(65 + idx)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
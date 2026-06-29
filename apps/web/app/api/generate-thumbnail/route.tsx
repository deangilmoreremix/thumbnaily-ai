import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getOpenAIKey } from "@/lib/getOpenAIKey";
import { supabase } from "@/lib/supabase";
import { systemPrompt } from "@/lib/prompts";
import { criticThumbnail } from "@/lib/thumbnailCritic";
import { streamEnhancePrompt } from "@/lib/enhancePrompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerationOptions = {
  size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "auto" | "low" | "medium" | "high";
  format?: "png" | "jpeg" | "webp";
  background?: "auto" | "transparent" | "opaque";
  compression?: number;
  moderation?: "auto" | "low" | "medium" | "high";
};

type RefinePayload = {
  mode: "refine";
  thumbnailId: string;
  instruction: string;
  isPublic?: boolean;
  options?: GenerationOptions;
};

type GeneratePayload = {
  mode?: "generate" | "edit";
  basicPrompt: string;
  isPublic?: boolean;
  image_urls?: string[];
  options?: GenerationOptions;
  templateSlug?: string | null;
  styleSlug?: string | null;
};

type VariantsPayload = {
  mode: "variants";
  basicPrompt: string;
  isPublic?: boolean;
  image_urls?: string[];
  options?: GenerationOptions;
  templateSlug?: string | null;
  styleSlug?: string | null;
  variantCount?: number;
};

type CaptionPayload = {
  mode: "caption";
  thumbnailId: string;
  text: string;
  position?: "top" | "center" | "bottom";
  isPublic?: boolean;
};

type BackgroundPayload = {
  mode: "background";
  thumbnailId: string;
  prompt: string;
  isPublic?: boolean;
};

type ResizeChannelPayload = {
  mode: "channel";
  thumbnailId: string;
  channels: { platform: string; size: "1024x1024" | "1024x1536" | "1536x1024" }[];
};

type ResearchPayload = {
  mode: "research";
  basicPrompt: string;
  searchContext?: string;
  isPublic?: boolean;
  options?: GenerationOptions;
  templateSlug?: string | null;
  styleSlug?: string | null;
};

type AnalyzeImprovePayload = {
  mode: "analyze-and-improve";
  thumbnailId?: string;
  imageUrl?: string;
  instruction?: string;
  isPublic?: boolean;
  options?: GenerationOptions;
};

type RequestPayload =
  | GeneratePayload
  | RefinePayload
  | VariantsPayload
  | CaptionPayload
  | BackgroundPayload
  | ResizeChannelPayload
  | ResearchPayload
  | AnalyzeImprovePayload;

function isRefine(p: RequestPayload): p is RefinePayload {
  return (p as RefinePayload).mode === "refine";
}
function isVariants(p: RequestPayload): p is VariantsPayload {
  return (p as VariantsPayload).mode === "variants";
}
function isCaption(p: RequestPayload): p is CaptionPayload {
  return (p as CaptionPayload).mode === "caption";
}
function isBackground(p: RequestPayload): p is BackgroundPayload {
  return (p as BackgroundPayload).mode === "background";
}
function isChannel(p: RequestPayload): p is ResizeChannelPayload {
  return (p as ResizeChannelPayload).mode === "channel";
}
function isResearch(p: RequestPayload): p is ResearchPayload {
  return (p as ResearchPayload).mode === "research";
}
function isAnalyzeImprove(p: RequestPayload): p is AnalyzeImprovePayload {
  return (p as AnalyzeImprovePayload).mode === "analyze-and-improve";
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

async function streamEnhanceIntoSSE(
  send: (event: string, data: unknown) => void,
  userPrompt: string,
  image_urls: string[] = [],
  apiKey?: string
): Promise<string> {
  let result = "";
  for await (const ev of streamEnhancePrompt(userPrompt, image_urls, apiKey)) {
    send(ev.type, ev);
    if (ev.type === "complete") result = ev.prompt;
  }
  return result;
}

async function streamOneVariant(
  openai: OpenAI,
  args: {
    input: OpenAI.Responses.ResponseInputItem[];
    previousResponseId?: string;
    imageGenTool: Record<string, unknown>;
    toolChoice: OpenAI.Responses.ResponseCreateParams["tool_choice"];
    sendPartial: (idx: number, base64: string) => void;
  }
): Promise<{
  base64?: string;
  revisedPrompt?: string;
  responseId?: string;
  imageCallId?: string;
}> {
  const params: OpenAI.Responses.ResponseCreateParams = {
    model: "gpt-5.5",
    instructions: systemPrompt,
    input: args.input,
    tools: [args.imageGenTool as unknown as OpenAI.Responses.Tool],
    tool_choice: args.toolChoice,
    stream: true,
  };
  if (args.previousResponseId) params.previous_response_id = args.previousResponseId;

  const openaiStream = await openai.responses.create(params);

  let base64: string | undefined;
  let revisedPrompt: string | undefined;
  let responseId: string | undefined;
  let imageCallId: string | undefined;
  let lastImageCallId: string | undefined;

  for await (const event of openaiStream) {
    if (event.type === "response.image_generation_call.partial_image") {
      args.sendPartial(event.partial_image_index, event.partial_image_b64);
    } else if (event.type === "response.output_item.done") {
      const item = event.item as unknown as {
        id?: string;
        type?: string;
        result?: string;
        revised_prompt?: string;
      };
      if (item?.type === "image_generation_call") {
        if (item.id) lastImageCallId = item.id;
        if (typeof item.result === "string" && item.result.length > 0) {
          base64 = item.result;
        }
        if (typeof item.revised_prompt === "string") {
          revisedPrompt = item.revised_prompt;
        }
      }
    } else if (event.type === "response.completed") {
      const resp = event.response;
      responseId = resp.id;
      for (const out of (resp.output ?? []) as Array<{
        id?: string;
        type?: string;
        result?: string;
        revised_prompt?: string;
      }>) {
        if (out.type === "image_generation_call") {
          if (typeof out.result === "string" && out.result.length > 0) {
            base64 = out.result;
          }
          if (typeof out.revised_prompt === "string") {
            revisedPrompt = out.revised_prompt;
          }
          if (out.id) imageCallId = out.id;
        }
      }
    }
  }

  return {
    base64,
    revisedPrompt,
    responseId,
    imageCallId: imageCallId ?? lastImageCallId,
  };
}

type MultiToolEvent =
  | { type: "tool-start"; tool: string }
  | { type: "searching" }
  | { type: "search-complete" }
  | { type: "search-result"; url?: string; title?: string; snippet?: string }
  | { type: "partial"; index: number; base64: string }
  | { type: "image-complete"; result?: string; revisedPrompt?: string; responseId?: string; imageCallId?: string }
  | { type: "complete"; images: Array<{ base64: string; revisedPrompt?: string; index: number }>; searchResults: Array<{ url?: string; title?: string; snippet?: string }>; responseId?: string; revisedPrompt?: string; imageCallId?: string }
  | { type: "error"; message: string };

async function* streamMultiTool(
  openai: OpenAI,
  opts: {
    prompt: string;
    imageInputs?: string[];
    tools: Array<Record<string, unknown>>;
    model?: string;
    options?: GenerationOptions;
    toolChoice?: OpenAI.Responses.ResponseCreateParams["tool_choice"];
    instructions?: string;
  }
): AsyncGenerator<MultiToolEvent> {
  const model = opts.model ?? "gpt-5.5";
  const imageInputs = (opts.imageInputs ?? []).filter(Boolean).slice(0, 5);

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: opts.prompt },
    ...imageInputs.map((url) => ({
      type: "input_image",
      image_url: url,
      detail: "high",
    })),
  ];

  const params: OpenAI.Responses.ResponseCreateParams = {
    model,
    instructions: opts.instructions ?? systemPrompt,
    input: [{ role: "user", content: content as unknown as OpenAI.Responses.ResponseInputMessageContentList }],
    tools: opts.tools as unknown as OpenAI.Responses.Tool[],
    stream: true,
  };
  if (opts.toolChoice) params.tool_choice = opts.toolChoice;

  const stream = await openai.responses.create(params);

  const searchResults: Array<{ url?: string; title?: string; snippet?: string }> = [];
  const images: Array<{ base64: string; revisedPrompt?: string; index: number }> = [];
  let responseId: string | undefined;
  let imageCallId: string | undefined;
  let lastRevisedPrompt: string | undefined;
  let webSearchStarted = false;
  let imageGenStarted = false;

  try {
    for await (const event of stream) {
      const evtType = (event as { type: string }).type;

      if (evtType === "response.web_search_call.searching") {
        if (!webSearchStarted) {
          webSearchStarted = true;
          yield { type: "tool-start", tool: "web_search" };
        }
        yield { type: "searching" };
      } else if (evtType === "response.web_search_call.completed") {
        yield { type: "search-complete" };
      } else if (evtType === "response.image_generation_call.partial_image") {
        const e = event as unknown as {
          partial_image_index: number;
          partial_image_b64: string;
        };
        if (!imageGenStarted) {
          imageGenStarted = true;
          yield { type: "tool-start", tool: "image_generation" };
        }
        yield {
          type: "partial",
          index: e.partial_image_index,
          base64: e.partial_image_b64,
        };
      } else if (evtType === "response.image_generation_call.completed") {
        const e = event as unknown as { result?: string };
        yield {
          type: "image-complete",
          result: typeof e.result === "string" ? e.result : undefined,
        };
      } else if (evtType === "response.output_item.done") {
        const item = (event as { item: unknown }).item as {
          id?: string;
          type?: string;
          result?: string;
          revised_prompt?: string;
          action?: string;
          query?: string;
          sources?: Array<{
            url?: string;
            title?: string;
            snippet?: string;
          }>;
        };
        const t = item?.type;
        if (t === "web_search_call") {
          if (!webSearchStarted) {
            webSearchStarted = true;
            yield { type: "tool-start", tool: "web_search" };
          }
          const sources = Array.isArray(item.sources) ? item.sources : [];
          for (const s of sources) {
            const rec = {
              url: typeof s?.url === "string" ? s.url : undefined,
              title: typeof s?.title === "string" ? s.title : undefined,
              snippet: typeof s?.snippet === "string" ? s.snippet : undefined,
            };
            searchResults.push(rec);
            yield { type: "search-result", ...rec };
          }
          if (sources.length === 0) {
            const placeholder = {
              url: undefined,
              title: undefined,
              snippet: typeof item.query === "string" ? item.query : undefined,
            };
            searchResults.push(placeholder);
            yield { type: "search-result", ...placeholder };
          }
        } else if (t === "image_generation_call") {
          if (!imageGenStarted) {
            imageGenStarted = true;
            yield { type: "tool-start", tool: "image_generation" };
          }
          if (typeof item.id === "string") imageCallId = item.id;
          if (typeof item.result === "string" && item.result.length > 0) {
            const rec = {
              base64: item.result,
              revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
              index: images.length,
            };
            images.push(rec);
            lastRevisedPrompt = rec.revisedPrompt ?? lastRevisedPrompt;
            yield {
              type: "image-complete",
              result: rec.base64,
              revisedPrompt: rec.revisedPrompt,
              imageCallId,
            };
          }
          if (typeof item.revised_prompt === "string") {
            lastRevisedPrompt = item.revised_prompt;
          }
        }
      } else if (evtType === "response.completed") {
        const resp = (event as { response: unknown }).response as {
          id?: string;
          output?: Array<{
            id?: string;
            type?: string;
            result?: string;
            revised_prompt?: string;
            sources?: Array<{
              url?: string;
              title?: string;
              snippet?: string;
            }>;
          }>;
        };
        if (typeof resp.id === "string") responseId = resp.id;
        const outs = Array.isArray(resp.output) ? resp.output : [];
        for (const out of outs) {
          if (out.type === "web_search_call") {
            const sources = Array.isArray(out.sources) ? out.sources : [];
            for (const s of sources) {
              const rec = {
                url: typeof s?.url === "string" ? s.url : undefined,
                title: typeof s?.title === "string" ? s.title : undefined,
                snippet: typeof s?.snippet === "string" ? s.snippet : undefined,
              };
              if (!searchResults.some((x) => x.url === rec.url && x.title === rec.title)) {
                searchResults.push(rec);
                yield { type: "search-result", ...rec };
              }
            }
          } else if (out.type === "image_generation_call") {
            if (typeof out.id === "string") imageCallId = out.id;
            if (typeof out.result === "string" && out.result.length > 0) {
              const idx = images.findIndex((i) => i.base64 === out.result);
              if (idx === -1) {
                const rec = {
                  base64: out.result,
                  revisedPrompt: typeof out.revised_prompt === "string" ? out.revised_prompt : undefined,
                  index: images.length,
                };
                images.push(rec);
              } else if (typeof out.revised_prompt === "string") {
                images[idx]!.revisedPrompt = out.revised_prompt;
              }
            }
            if (typeof out.revised_prompt === "string") {
              lastRevisedPrompt = out.revised_prompt;
            }
          }
        }
      } else if (evtType === "response.failed" || evtType === "error") {
        const e = event as { error?: { message?: string }; message?: string };
        const message =
          typeof e?.error?.message === "string"
            ? e.error.message
            : typeof e?.message === "string"
            ? e.message
            : "OpenAI stream error";
        yield { type: "error", message };
        return;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown streaming error";
    yield { type: "error", message };
    return;
  }

  const completeEvent: MultiToolEvent = {
    type: "complete",
    images,
    searchResults,
    responseId,
    revisedPrompt: lastRevisedPrompt,
  };
  if (imageCallId) {
    (completeEvent as { imageCallId?: string }).imageCallId = imageCallId;
  }
  yield completeEvent;
}

export async function POST(req: NextRequest) {
  let payload: RequestPayload;
  try {
    payload = (await req.json()) as RequestPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          /* controller closed */
        }
      };

      const apiKey = getOpenAIKey(req);
      if (!apiKey) {
        send("error", { step: "Error", progress: 0, message: "OpenAI API key missing. Add your key in Settings → API Keys." });
        controller.close();
        return;
      }
      const openai = new OpenAI({ apiKey });

      try {
        // =========================================================
        // Analyze & Improve: image input + image_generation (edit action)
        // =========================================================
        if (isAnalyzeImprove(payload)) {
          send("progress", { step: "Loading reference", progress: 5 });

          let refImageUrl: string | undefined = payload.imageUrl;
          let parentThumbnailId: string | undefined;
          let parentPrompt: string | undefined;

          if (!refImageUrl && payload.thumbnailId) {
            const { data: parent, error: parentErr } = await supabase
              .from("thumbnails")
              .select("id, link, prompt")
              .eq("id", payload.thumbnailId)
              .single();
            if (parentErr || !parent) throw new Error("Reference thumbnail not found");
            refImageUrl = parent.link as string;
            parentThumbnailId = parent.id as string;
            parentPrompt = (parent.prompt as string) ?? undefined;
          }
          if (!refImageUrl) throw new Error("Provide either imageUrl or thumbnailId");

          const instruction =
            payload.instruction?.trim() ||
            `Analyze this thumbnail and create an improved version. Identify the dominant subject, color palette, lighting style, and composition. Then regenerate a sharper, higher-impact version that keeps the same subject and mood but improves clarity, contrast, and overall thumbnail punch.${parentPrompt ? ` Original concept: ${parentPrompt}` : ""}`;

          const optsForAnalyze: GenerationOptions = payload.options ?? {};
          const imageGenTool: Record<string, unknown> = {
            type: "image_generation",
            action: "edit",
            partial_images: 2,
          };
          if (optsForAnalyze.size && optsForAnalyze.size !== "auto") imageGenTool.size = optsForAnalyze.size;
          if (optsForAnalyze.quality && optsForAnalyze.quality !== "auto") imageGenTool.quality = optsForAnalyze.quality;
          if (optsForAnalyze.format) imageGenTool.format = optsForAnalyze.format;
          if (optsForAnalyze.moderation && optsForAnalyze.moderation !== "auto") imageGenTool.moderation = optsForAnalyze.moderation;

          const analyzeTools: Array<Record<string, unknown>> = [imageGenTool];

          send("progress", { step: "Analyzing and improving", progress: 25 });

          let finalBase64: string | undefined;
          let revisedPrompt: string | undefined;
          let responseId: string | undefined;
          let imageCallId: string | undefined;

          for await (const evt of streamMultiTool(openai, {
            prompt: instruction,
            imageInputs: [refImageUrl],
            tools: analyzeTools,
            model: "gpt-5.5",
            options: optsForAnalyze,
            toolChoice: { type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"],
          })) {
            if (evt.type === "tool-start") {
              send("tool-start", { tool: evt.tool });
            } else if (evt.type === "partial") {
              send("partial", { index: evt.index, base64: evt.base64 });
            } else if (evt.type === "image-complete") {
              if (evt.result) finalBase64 = evt.result;
              if (evt.revisedPrompt) revisedPrompt = evt.revisedPrompt;
              if (evt.imageCallId) imageCallId = evt.imageCallId;
            } else if (evt.type === "complete") {
              if (evt.responseId) responseId = evt.responseId;
              if (evt.imageCallId) imageCallId = evt.imageCallId;
              if (evt.revisedPrompt) revisedPrompt = evt.revisedPrompt;
              const first = evt.images[0];
              if (first?.base64) finalBase64 = first.base64;
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            }
          }

          if (!finalBase64) throw new Error("Analyze-and-improve returned no image");

          send("progress", { step: "Saving to storage", progress: 88 });

          const buffer = Buffer.from(finalBase64, "base64");
          const fmt: "png" | "jpeg" | "webp" = optsForAnalyze.format ?? "png";
          const ext = fmt === "jpeg" ? "jpg" : fmt === "webp" ? "webp" : "png";
          const contentType =
            ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
          const key = `thumbnails/improvements/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("thumbnails")
            .upload(key, buffer, { contentType });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: pub } = supabase.storage.from("thumbnails").getPublicUrl(key);
          const finalImageUrl = pub.publicUrl;

          const isPublic = typeof payload.isPublic === "boolean" ? payload.isPublic : true;
          const { data: inserted } = await supabase
            .from("thumbnails")
            .insert({
              link: finalImageUrl,
              prompt: instruction,
              revised_prompt: revisedPrompt ?? null,
              isPublic,
              openai_response_id: responseId ?? null,
              openai_image_call_id: imageCallId ?? null,
              parent_id: parentThumbnailId ?? null,
              mode: "analyze-and-improve",
              size: optsForAnalyze.size ?? "1536x1024",
              quality: optsForAnalyze.quality ?? "high",
              format: fmt,
            })
            .select("id")
            .single();

          send("complete", {
            step: "Improvement ready",
            progress: 100,
            imageUrl: finalImageUrl,
            thumbnailId: inserted?.id ?? null,
            revisedPrompt: revisedPrompt ?? null,
          });
          controller.close();
          return;
        }

        // =========================================================
        // Research: web_search + image_generation (gpt-5.5, streamed)
        // =========================================================
        if (isResearch(payload)) {
          const basicPrompt = payload.basicPrompt?.trim();
          if (!basicPrompt) throw new Error("Prompt is required");

          const optsForResearch: GenerationOptions = payload.options ?? {};
          const ctx = payload.searchContext?.trim();
          const instruction = ctx
            ? `${basicPrompt}\n\nResearch focus: ${ctx}. Use the web search to ground the image in real, current, factual details (trends, places, products, terminology, faces, objects) relevant to the topic. Then generate a thumbnail that visually represents these real-world references.`
            : `${basicPrompt}\n\nUse web search to gather current, real-world context (trends, places, products, factual references) that would make this thumbnail more accurate and impactful, then generate a thumbnail grounded in that research.`;

          const imageGenTool: Record<string, unknown> = {
            type: "image_generation",
            action: "generate",
            partial_images: 2,
          };
          if (optsForResearch.size && optsForResearch.size !== "auto") imageGenTool.size = optsForResearch.size;
          if (optsForResearch.quality && optsForResearch.quality !== "auto") imageGenTool.quality = optsForResearch.quality;
          if (optsForResearch.format) imageGenTool.format = optsForResearch.format;
          if (optsForResearch.background && optsForResearch.background !== "auto")
            imageGenTool.background = optsForResearch.background;
          if (optsForResearch.moderation && optsForResearch.moderation !== "auto")
            imageGenTool.moderation = optsForResearch.moderation;

          const researchTools: Array<Record<string, unknown>> = [
            { type: "web_search" },
            imageGenTool,
          ];

          send("progress", { step: "Researching and generating", progress: 15 });

          const collectedSearchResults: Array<{ url?: string; title?: string; snippet?: string }> = [];
          let finalBase64: string | undefined;
          let revisedPrompt: string | undefined;
          let responseId: string | undefined;
          let imageCallId: string | undefined;
          let lastProgress = 15;

          for await (const evt of streamMultiTool(openai, {
            prompt: instruction,
            tools: researchTools,
            model: "gpt-5.5",
            options: optsForResearch,
          })) {
            if (evt.type === "tool-start") {
              send("tool-start", { tool: evt.tool });
            } else if (evt.type === "searching") {
              if (lastProgress < 25) {
                lastProgress = 25;
                send("progress", { step: "Searching the web", progress: lastProgress });
              }
            } else if (evt.type === "search-complete") {
              if (lastProgress < 35) {
                lastProgress = 35;
                send("progress", { step: "Search complete", progress: lastProgress });
              }
            } else if (evt.type === "search-result") {
              collectedSearchResults.push({
                url: evt.url,
                title: evt.title,
                snippet: evt.snippet,
              });
              send("search-result", { url: evt.url, title: evt.title, snippet: evt.snippet });
            } else if (evt.type === "partial") {
              if (lastProgress < 70) {
                lastProgress = 70;
                send("progress", { step: "Generating image", progress: lastProgress });
              }
              send("partial", { index: evt.index, base64: evt.base64 });
            } else if (evt.type === "image-complete") {
              if (evt.result) finalBase64 = evt.result;
              if (evt.revisedPrompt) revisedPrompt = evt.revisedPrompt;
              if (evt.imageCallId) imageCallId = evt.imageCallId;
            } else if (evt.type === "complete") {
              if (evt.responseId) responseId = evt.responseId;
              if (evt.imageCallId) imageCallId = evt.imageCallId;
              if (evt.revisedPrompt) revisedPrompt = evt.revisedPrompt;
              for (const r of evt.searchResults) collectedSearchResults.push(r);
              const first = evt.images[0];
              if (first?.base64) finalBase64 = first.base64;
              if (first?.revisedPrompt) revisedPrompt = first.revisedPrompt;
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            }
          }

          if (!finalBase64) throw new Error("Research returned no image");

          send("progress", { step: "Saving to storage", progress: 88 });

          const buffer = Buffer.from(finalBase64, "base64");
          const fmt: "png" | "jpeg" | "webp" = optsForResearch.format ?? "png";
          const ext = fmt === "jpeg" ? "jpg" : fmt === "webp" ? "webp" : "png";
          const contentType =
            ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
          const key = `thumbnails/research/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("thumbnails")
            .upload(key, buffer, { contentType });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: pub } = supabase.storage.from("thumbnails").getPublicUrl(key);
          const finalImageUrl = pub.publicUrl;

          const isPublic = typeof payload.isPublic === "boolean" ? payload.isPublic : true;
          const { data: inserted } = await supabase
            .from("thumbnails")
            .insert({
              link: finalImageUrl,
              prompt: basicPrompt,
              revised_prompt: revisedPrompt ?? null,
              isPublic,
              openai_response_id: responseId ?? null,
              openai_image_call_id: imageCallId ?? null,
              mode: "research",
              size: optsForResearch.size ?? "1536x1024",
              quality: optsForResearch.quality ?? "medium",
              format: fmt,
              template: payload.templateSlug ?? null,
              style: payload.styleSlug ?? null,
            })
            .select("id")
            .single();

          send("complete", {
            step: "Research thumbnail ready",
            progress: 100,
            imageUrl: finalImageUrl,
            thumbnailId: inserted?.id ?? null,
            revisedPrompt: revisedPrompt ?? null,
            searchResults: collectedSearchResults,
          });
          controller.close();
          return;
        }

        // =========================================================
        // Channel resize: parallel small image_generation calls per size
        // =========================================================
        if (isChannel(payload)) {
          send("progress", { step: "Loading parent", progress: 5 });
          const { data: parent, error: parentErr } = await supabase
            .from("thumbnails")
            .select("id, link")
            .eq("id", payload.thumbnailId)
            .single();
          if (parentErr || !parent) throw new Error("Parent not found");

          const channels = payload.channels?.length
            ? payload.channels
            : [
                { platform: "youtube", size: "1536x1024" as const },
                { platform: "instagram", size: "1024x1024" as const },
                { platform: "tiktok", size: "1024x1536" as const },
              ];

          const results: { platform: string; size: string; link: string }[] = [];
          let done = 0;
          await Promise.all(
            channels.map(async (ch) => {
              const sizeStr =
                ch.size === "1024x1024"
                  ? "1:1 square"
                  : ch.size === "1024x1536"
                  ? "9:16 vertical"
                  : "16:9 horizontal";
              send("progress", {
                step: `Resizing for ${ch.platform} (${sizeStr})`,
                progress: 10 + Math.floor((done / channels.length) * 75),
              });

              const r = await streamOneVariant(openai, {
                input: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "input_text",
                        text: `Recompose this thumbnail for a ${ch.platform} ${sizeStr} format. Keep the same subject and mood.`,
                      },
                      {
                        type: "input_image",
                        image_url: parent.link as string,
                        detail: "high",
                      },
                    ],
                  },
                ],
                imageGenTool: {
                  type: "image_generation",
                  size: ch.size,
                  quality: "medium",
                },
                toolChoice: { type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"],
                sendPartial: () => {},
              });

              if (!r.base64) throw new Error(`${ch.platform} resize failed`);
              const buffer = Buffer.from(r.base64, "base64");
              const key = `thumbnails/channels/${Date.now()}-${ch.platform}-${Math.floor(Math.random() * 1000)}.png`;
              const { error: upErr } = await supabase.storage
                .from("thumbnails")
                .upload(key, buffer, { contentType: "image/png" });
              if (upErr) throw new Error(`Upload failed for ${ch.platform}: ${upErr.message}`);
              const { data: pub } = supabase.storage.from("thumbnails").getPublicUrl(key);

              await supabase.from("channel_variants").insert({
                thumbnail_id: parent.id,
                platform: ch.platform,
                size: ch.size,
                link: pub.publicUrl,
              });

              results.push({ platform: ch.platform, size: ch.size, link: pub.publicUrl });
              done += 1;
              send("progress", {
                step: `${ch.platform} ready`,
                progress: 10 + Math.floor((done / channels.length) * 75),
              });
            })
          );

          send("complete", { step: "Channels ready", progress: 100, channels: results });
          controller.close();
          return;
        }

        // =========================================================
        // Caption overlay: edit-mode call with text instruction
        // =========================================================
        if (isCaption(payload)) {
          send("progress", { step: "Loading thumbnail", progress: 5 });
          const { data: parent, error: parentErr } = await supabase
            .from("thumbnails")
            .select("id, link, openai_response_id, openai_image_call_id, prompt")
            .eq("id", payload.thumbnailId)
            .single();
          if (parentErr || !parent) throw new Error("Thumbnail not found");

          const text = payload.text?.trim();
          if (!text) throw new Error("Caption text required");
          const pos = payload.position ?? "bottom";
          const posInstruction =
            pos === "top"
              ? "Place the text in the upper third"
              : pos === "center"
              ? "Place the text centered with high contrast"
              : "Place the text in the lower third";

          send("progress", { step: "Rendering caption", progress: 30 });
          const r = await streamOneVariant(openai, {
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `Edit this thumbnail by adding bold on-image text that reads exactly: "${text}". ${posInstruction}. Use thick stroke or strong contrast so the text is readable at small sizes. Keep the original composition and subject. Do NOT change anything else.`,
                  },
                  {
                    type: "input_image",
                    image_url: parent.link as string,
                    detail: "high",
                  },
                ],
              },
            ],
            imageGenTool: {
              type: "image_generation",
              quality: "high",
            },
            toolChoice: { type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"],
            sendPartial: (_i, b64) =>
              send("partial", { index: 0, base64: b64 }),
          });

          if (!r.base64) throw new Error("Caption render failed");
          const buffer = Buffer.from(r.base64, "base64");
          const key = `thumbnails/captions/${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
          const { error: upErr } = await supabase.storage
            .from("thumbnails")
            .upload(key, buffer, { contentType: "image/png" });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: pub } = supabase.storage.from("thumbnails").getPublicUrl(key);

          const { data: inserted } = await supabase
            .from("thumbnails")
            .insert({
              link: pub.publicUrl,
              prompt: `Caption: ${text}`,
              revised_prompt: r.revisedPrompt ?? null,
              isPublic: payload.isPublic ?? true,
              openai_response_id: r.responseId ?? null,
              openai_image_call_id: r.imageCallId ?? null,
              parent_id: parent.id,
              mode: "caption",
              caption: text,
              size: "1536x1024",
              quality: "high",
              format: "png",
            })
            .select("id")
            .single();

          send("complete", {
            step: "Caption rendered",
            progress: 100,
            imageUrl: pub.publicUrl,
            thumbnailId: inserted?.id ?? null,
          });
          controller.close();
          return;
        }

        // =========================================================
        // Background replace: edit-mode with new background prompt
        // =========================================================
        if (isBackground(payload)) {
          send("progress", { step: "Loading thumbnail", progress: 5 });
          const { data: parent, error: parentErr } = await supabase
            .from("thumbnails")
            .select("id, link, openai_response_id, prompt")
            .eq("id", payload.thumbnailId)
            .single();
          if (parentErr || !parent) throw new Error("Thumbnail not found");

          const bgPrompt = payload.prompt?.trim();
          if (!bgPrompt) throw new Error("Background prompt required");

          send("progress", { step: "Replacing background", progress: 30 });
          const r = await streamOneVariant(openai, {
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `Edit this thumbnail: keep the main subject and foreground exactly as-is, but replace the entire background with: ${bgPrompt}. Preserve lighting direction and edges around the subject.`,
                  },
                  {
                    type: "input_image",
                    image_url: parent.link as string,
                    detail: "high",
                  },
                ],
              },
            ],
            imageGenTool: {
              type: "image_generation",
              quality: "high",
            },
            toolChoice: { type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"],
            sendPartial: (_i, b64) => send("partial", { index: 0, base64: b64 }),
          });

          if (!r.base64) throw new Error("Background replace failed");
          const buffer = Buffer.from(r.base64, "base64");
          const key = `thumbnails/backgrounds/${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
          const { error: upErr } = await supabase.storage
            .from("thumbnails")
            .upload(key, buffer, { contentType: "image/png" });
          if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
          const { data: pub } = supabase.storage.from("thumbnails").getPublicUrl(key);

          const { data: inserted } = await supabase
            .from("thumbnails")
            .insert({
              link: pub.publicUrl,
              prompt: `Background: ${bgPrompt}`,
              revised_prompt: r.revisedPrompt ?? null,
              isPublic: payload.isPublic ?? true,
              openai_response_id: r.responseId ?? null,
              openai_image_call_id: r.imageCallId ?? null,
              parent_id: parent.id,
              mode: "background",
              size: "1536x1024",
              quality: "high",
              format: "png",
            })
            .select("id")
            .single();

          send("complete", {
            step: "Background replaced",
            progress: 100,
            imageUrl: pub.publicUrl,
            thumbnailId: inserted?.id ?? null,
          });
          controller.close();
          return;
        }

        // =========================================================
        // Generation / Refine / Variants (single image)
        // =========================================================
        const options: Required<Pick<GenerationOptions, "size" | "quality" | "format" | "background">> & {
          compression?: number;
          moderation?: GenerationOptions["moderation"];
        } = {
          size: (payload as GeneratePayload | VariantsPayload).options?.size ?? "1024x1024",
          quality: (payload as GeneratePayload | VariantsPayload).options?.quality ?? "medium",
          format: (payload as GeneratePayload | VariantsPayload).options?.format ?? "png",
          background: (payload as GeneratePayload | VariantsPayload).options?.background ?? "auto",
        };
        if (typeof (payload as GeneratePayload | VariantsPayload).options?.compression === "number") {
          options.compression = Math.max(0, Math.min(100, (payload as GeneratePayload | VariantsPayload).options!.compression!));
        }
        if ((payload as GeneratePayload | VariantsPayload).options?.moderation) {
          options.moderation = (payload as GeneratePayload | VariantsPayload).options!.moderation!;
        }

        const isPublic =
          typeof payload.isPublic === "boolean" ? payload.isPublic : true;

        let input: OpenAI.Responses.ResponseInputItem[];
        let previousResponseId: string | undefined;
        let parentThumbnailId: string | undefined;
        let basicPrompt: string;
        let inputImages: string[] = [];

        if (isRefine(payload)) {
          send("progress", { step: "Loading parent thumbnail", progress: 5 });
          const { data: parent, error: parentErr } = await supabase
            .from("thumbnails")
            .select("id, link, openai_response_id, openai_image_call_id, prompt")
            .eq("id", payload.thumbnailId)
            .single();
          if (parentErr || !parent) throw new Error("Parent thumbnail not found");

          parentThumbnailId = parent.id as string;
          previousResponseId = (parent.openai_response_id as string) ?? undefined;
          basicPrompt = payload.instruction?.trim();
          if (!basicPrompt) throw new Error("Refinement instruction is required");
          if (parent.link && typeof parent.link === "string") inputImages = [parent.link];

          input = [
            {
              role: "user",
              content: [
                { type: "input_text", text: basicPrompt },
                ...inputImages.map((url) => ({
                  type: "input_image" as const,
                  image_url: url,
                  detail: "auto" as const,
                })),
              ],
            },
          ];
        } else if (isVariants(payload)) {
          basicPrompt = payload.basicPrompt?.trim();
          if (!basicPrompt) throw new Error("Prompt is required");
          inputImages = isStringArray(payload.image_urls)
            ? payload.image_urls.filter(Boolean).slice(0, 5)
            : [];

          const variantCount = Math.min(Math.max(payload.variantCount ?? 4, 2), 4);
          const variantAngles = [
            "Variant A: emphasize dramatic close-up of the main subject with strong eye contact",
            "Variant B: emphasize environment/context with the subject smaller in the frame",
            "Variant C: emphasize bold typographic overlay with minimal subject",
            "Variant D: emphasize symbolic objects and detail (money, weapons, logos, etc.)",
          ].slice(0, variantCount);

          send("progress", { step: "Generating variants", progress: 10 });

          const variantPromises = variantAngles.map((angle, idx) => {
            const variantPrompt = `${basicPrompt}\n\nComposition focus: ${angle}.`;
            return streamOneVariant(openai, {
              input: [
                {
                  role: "user",
                  content: [
                    { type: "input_text", text: variantPrompt },
                    ...inputImages.map((url) => ({
                      type: "input_image" as const,
                      image_url: url,
                      detail: "auto" as const,
                    })),
                  ],
                },
              ],
              imageGenTool: {
                type: "image_generation",
                partial_images: 1,
                size: options.size !== "auto" ? options.size : "1536x1024",
                quality: options.quality !== "auto" ? options.quality : "medium",
                format: options.format,
                background: options.background !== "auto" ? options.background : undefined,
                moderation: options.moderation && options.moderation !== "auto" ? options.moderation : undefined,
              } as Record<string, unknown>,
              toolChoice: { type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"],
              sendPartial: (i, b64) =>
                send("partial", { variantIndex: idx, index: i, base64: b64 }),
            }).then(async (r) => {
              if (!r.base64) throw new Error(`Variant ${idx + 1} failed`);
              const buffer = Buffer.from(r.base64, "base64");
              const ext =
                options.format === "jpeg"
                  ? "jpg"
                  : options.format === "webp"
                  ? "webp"
                  : "png";
              const contentType =
                ext === "jpg"
                  ? "image/jpeg"
                  : ext === "webp"
                  ? "image/webp"
                  : "image/png";
              const key = `thumbnails/variants/${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("thumbnails")
                .upload(key, buffer, { contentType });
              if (upErr) throw new Error(`Variant upload failed: ${upErr.message}`);
              const { data: pub } = supabase.storage
                .from("thumbnails")
                .getPublicUrl(key);
              return { base64: r.base64, revisedPrompt: r.revisedPrompt, publicUrl: pub.publicUrl, responseId: r.responseId, imageCallId: r.imageCallId, angle };
            });
          });

          const settled = await Promise.all(variantPromises);
          const firstInsertedIds: string[] = [];
          let firstRootId: string | null = null;

          for (let i = 0; i < settled.length; i++) {
            const v = settled[i];
            if (!v) continue;
            const { data: inserted }: { data: { id: string } | null } = await supabase
              .from("thumbnails")
              .insert({
                link: v.publicUrl,
                prompt: basicPrompt,
                revised_prompt: v.revisedPrompt ?? null,
                isPublic,
                openai_response_id: v.responseId ?? null,
                openai_image_call_id: v.imageCallId ?? null,
                parent_id: firstRootId,
                size: options.size,
                quality: options.quality,
                format: options.format,
                mode: "variants",
                template: payload.templateSlug ?? null,
                style: payload.styleSlug ?? null,
              })
              .select("id")
              .single();
            if (firstRootId === null) {
              firstRootId = inserted?.id ?? null;
            } else if (inserted?.id) {
              await supabase
                .from("thumbnails")
                .update({ parent_id: firstRootId })
                .eq("id", inserted.id);
            }
            if (inserted?.id) firstInsertedIds.push(inserted.id);
            send("progress", {
              step: `Variant ${i + 1} saved`,
              progress: 40 + Math.floor(((i + 1) / settled.length) * 50),
            });
          }

          let critic: Awaited<ReturnType<typeof criticThumbnail>> = null;
          try {
            const first = settled[0];
            if (first) {
              const c = await criticThumbnail({
                imageUrl: first.publicUrl,
                prompt: basicPrompt,
                revisedPrompt: first.revisedPrompt ?? null,
                apiKey,
              });
              critic = c;
              if (firstRootId && c) {
                await supabase
                  .from("thumbnails")
                  .update({
                    critic_score: c.score,
                    critic_notes: c.notes,
                    critic_suggestions: c.suggestions,
                    mood: c.mood,
                    palette: c.palette,
                    subject: c.subject,
                    tags: c.tags,
                  })
                  .eq("id", firstRootId);
              }
            }
          } catch {
            /* critic is best-effort */
          }

          send("complete", {
            step: "Variants ready",
            progress: 100,
            variants: settled.map((s, i) => ({
              thumbnailId: firstInsertedIds[i] ?? null,
              imageUrl: s?.publicUrl ?? "",
              angle: s?.angle ?? "",
              revisedPrompt: s?.revisedPrompt ?? null,
            })),
            rootId: firstRootId,
            critic,
          });
          controller.close();
          return;
        } else {
          basicPrompt = payload.basicPrompt?.trim();
          if (!basicPrompt) throw new Error("Prompt is required");
          inputImages = isStringArray(payload.image_urls)
            ? payload.image_urls.filter(Boolean).slice(0, 5)
            : [];

          const editSuffix =
            payload.mode === "edit" && inputImages.length > 0
              ? "\n\nEdit the provided reference image(s) according to the request. Keep the overall composition unless instructed otherwise."
              : "";

          input = [
            {
              role: "user",
              content: [
                { type: "input_text", text: basicPrompt + editSuffix },
                ...inputImages.map((url) => ({
                  type: "input_image" as const,
                  image_url: url,
                  detail: "auto" as const,
                })),
              ],
            },
          ];
        }

        send("progress", {
          step: isRefine(payload) ? "Refining thumbnail" : "Generating with AI",
          progress: 15,
        });

        const imageGenTool: Record<string, unknown> = {
          type: "image_generation",
          partial_images: 2,
        };
        if (options.size !== "auto") imageGenTool.size = options.size;
        if (options.quality !== "auto") imageGenTool.quality = options.quality;
        if (options.format) imageGenTool.format = options.format;
        if (options.background !== "auto") imageGenTool.background = options.background;
        if (typeof options.compression === "number") {
          imageGenTool.compression = options.compression;
        }
        if (options.moderation && options.moderation !== "auto") {
          imageGenTool.moderation = options.moderation;
        }

        const toolChoice: OpenAI.Responses.ResponseCreateParams["tool_choice"] =
          payload.mode === "edit" || isRefine(payload)
            ? ({ type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"])
            : "auto";

        const r = await streamOneVariant(openai, {
          input,
          previousResponseId,
          imageGenTool,
          toolChoice,
          sendPartial: (i, b64) => send("partial", { index: i, base64: b64 }),
        });

        if (!r.base64) throw new Error("AI generation returned no image data");

        send("progress", { step: "Saving to storage", progress: 88 });

        const buffer = Buffer.from(r.base64, "base64");
        const ext =
          options.format === "jpeg"
            ? "jpg"
            : options.format === "webp"
            ? "webp"
            : "png";
        const contentType =
          ext === "jpg"
            ? "image/jpeg"
            : ext === "webp"
            ? "image/webp"
            : "image/png";
        const key = `thumbnails/generations/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("thumbnails")
          .upload(key, buffer, { contentType, upsert: false });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabase.storage
          .from("thumbnails")
          .getPublicUrl(key);
        const finalImageUrl = publicUrlData.publicUrl;

        send("progress", { step: "Saving record", progress: 94 });

        const row = {
          link: finalImageUrl,
          prompt: r.revisedPrompt ?? basicPrompt,
          revised_prompt: r.revisedPrompt ?? null,
          isPublic,
          openai_response_id: r.responseId ?? null,
          openai_image_call_id: r.imageCallId ?? null,
          parent_id: parentThumbnailId ?? null,
          size: options.size,
          quality: options.quality,
          format: options.format,
          mode: isRefine(payload) ? "refine" : payload.mode ?? "generate",
          template: (payload as GeneratePayload).templateSlug ?? null,
          style: (payload as GeneratePayload).styleSlug ?? null,
        };

        const { data: inserted, error: dbError } = await supabase
          .from("thumbnails")
          .insert(row)
          .select("id")
          .single();

        if (dbError) console.error("DB insert error:", dbError);

        let critic = null;
        try {
          const c = await criticThumbnail({
            imageUrl: finalImageUrl,
            prompt: basicPrompt,
            revisedPrompt: r.revisedPrompt ?? null,
            apiKey,
          });
          critic = c;
          if (inserted?.id && c) {
            await supabase
              .from("thumbnails")
              .update({
                critic_score: c.score,
                critic_notes: c.notes,
                critic_suggestions: c.suggestions,
                mood: c.mood,
                palette: c.palette,
                subject: c.subject,
                tags: c.tags,
              })
              .eq("id", inserted.id);
          }
        } catch {
          /* best-effort */
        }

        send("complete", {
          step: "Complete",
          progress: 100,
          imageUrl: finalImageUrl,
          thumbnailId: inserted?.id ?? null,
          revisedPrompt: r.revisedPrompt ?? null,
          critic,
        });

        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("generate-thumbnail error:", err);
        send("error", { step: "Error", progress: 0, message });
        try {
          controller.close();
        } catch {
          /* closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
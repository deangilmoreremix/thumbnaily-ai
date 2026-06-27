import { NextRequest } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { systemPrompt } from "@/lib/prompts";
import { criticThumbnail } from "@/lib/thumbnailCritic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerationOptions = {
  size?: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "auto" | "low" | "medium" | "high";
  format?: "png" | "jpeg" | "webp";
  background?: "auto" | "transparent" | "opaque";
  compression?: number;
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

type RequestPayload =
  | GeneratePayload
  | RefinePayload
  | VariantsPayload
  | CaptionPayload
  | BackgroundPayload
  | ResizeChannelPayload;

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

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
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
    model: "gpt-4.1",
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

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      try {
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
        } = {
          size: (payload as GeneratePayload | VariantsPayload).options?.size ?? "1024x1024",
          quality: (payload as GeneratePayload | VariantsPayload).options?.quality ?? "medium",
          format: (payload as GeneratePayload | VariantsPayload).options?.format ?? "png",
          background: (payload as GeneratePayload | VariantsPayload).options?.background ?? "auto",
        };
        if (typeof (payload as GeneratePayload | VariantsPayload).options?.compression === "number") {
          options.compression = Math.max(0, Math.min(100, (payload as GeneratePayload | VariantsPayload).options!.compression!));
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

          // Build prompts that ask for multiple distinct variants in the response.
          // We don't actually request N separate image_generation tool calls
          // (the model only calls it once per response). Instead, we run N
          // parallel responses.create calls each focused on a different angle.
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

          // Best-effort critic on the first variant only (saves quota)
          let critic: Awaited<ReturnType<typeof criticThumbnail>> = null;
          try {
            const first = settled[0];
            if (first) {
              const c = await criticThumbnail({
                imageUrl: first.publicUrl,
                prompt: basicPrompt,
                revisedPrompt: first.revisedPrompt ?? null,
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

        // Best-effort critic
        let critic = null;
        try {
          const c = await criticThumbnail({
            imageUrl: finalImageUrl,
            prompt: basicPrompt,
            revisedPrompt: r.revisedPrompt ?? null,
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
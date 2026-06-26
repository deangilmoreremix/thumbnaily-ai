import { NextRequest } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { systemPrompt } from "@/lib/prompts";

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
};

type RequestPayload = GeneratePayload | RefinePayload;

function isRefine(payload: RequestPayload): payload is RefinePayload {
  return (payload as RefinePayload).mode === "refine";
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
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
          // controller closed
        }
      };

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      try {
        const options: Required<Pick<GenerationOptions, "size" | "quality" | "format" | "background">> & {
          compression?: number;
        } = {
          size: payload.options?.size ?? "1024x1024",
          quality: payload.options?.quality ?? "medium",
          format: payload.options?.format ?? "png",
          background: payload.options?.background ?? "auto",
        };
        if (typeof payload.options?.compression === "number") {
          options.compression = Math.max(0, Math.min(100, payload.options.compression));
        }

        const isPublic =
          typeof payload.isPublic === "boolean" ? payload.isPublic : true;

        let input: OpenAI.Responses.ResponseInputItem[];
        let previousResponseId: string | undefined;
        let referenceImageCallId: string | undefined;
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

          if (parentErr || !parent) {
            throw new Error("Parent thumbnail not found");
          }

          parentThumbnailId = parent.id as string;
          previousResponseId = (parent.openai_response_id as string) ?? undefined;
          referenceImageCallId = (parent.openai_image_call_id as string) ?? undefined;
          basicPrompt = payload.instruction?.trim();
          if (!basicPrompt) {
            throw new Error("Refinement instruction is required");
          }

          // Provide the parent's URL as an input image so the model sees what it's editing.
          if (parent.link && typeof parent.link === "string") {
            inputImages = [parent.link];
          }

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
        } else {
          basicPrompt = payload.basicPrompt?.trim();
          if (!basicPrompt) {
            throw new Error("Prompt is required");
          }
          inputImages = isStringArray(payload.image_urls)
            ? payload.image_urls.filter(Boolean).slice(0, 5)
            : [];

          // Build an edit-mode instruction that nudges the model to use uploaded images.
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
        // Only set parameters that aren't "auto" to let the model choose when sensible.
        if (options.size !== "auto") imageGenTool.size = options.size;
        if (options.quality !== "auto") imageGenTool.quality = options.quality;
        if (options.format) imageGenTool.format = options.format;
        if (options.background !== "auto") imageGenTool.background = options.background;
        if (typeof options.compression === "number") {
          imageGenTool.compression = options.compression;
        }

        // Force the image_generation tool call when editing so the model can't just reply with text.
        const toolChoice: OpenAI.Responses.ResponseCreateParams["tool_choice"] =
          payload.mode === "edit" || isRefine(payload)
            ? ({ type: "image_generation" } as unknown as OpenAI.Responses.ResponseCreateParams["tool_choice"])
            : "auto";

        const responsesCreateParams: OpenAI.Responses.ResponseCreateParams = {
          model: "gpt-4.1",
          instructions: systemPrompt,
          input,
          tools: [imageGenTool as unknown as OpenAI.Responses.Tool],
          tool_choice: toolChoice,
          stream: true,
        };

        if (previousResponseId) {
          responsesCreateParams.previous_response_id = previousResponseId;
        }

        const openaiStream = await openai.responses.create(responsesCreateParams);

        let finalImageBase64: string | undefined;
        let revisedPrompt: string | undefined;
        let responseId: string | undefined;
        let imageCallId: string | undefined;
        let lastImageCallForId: string | undefined;

        send("progress", {
          step: "Streaming from AI",
          progress: 30,
        });

        for await (const event of openaiStream) {
          // Stream partial images as they arrive.
          if (event.type === "response.image_generation_call.partial_image") {
            send("partial", {
              index: event.partial_image_index,
              base64: event.partial_image_b64,
            });
            send("progress", {
              step: "Composing preview",
              progress: Math.min(85, 40 + (event.partial_image_index + 1) * 15),
            });
          } else if (event.type === "response.output_item.done") {
            const item = event.item as unknown as {
              id?: string;
              type?: string;
              result?: string;
              revised_prompt?: string;
            };
            if (item && item.type === "image_generation_call") {
              if (item.id) lastImageCallForId = item.id;
              if (typeof item.result === "string" && item.result.length > 0) {
                finalImageBase64 = item.result;
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
                  finalImageBase64 = out.result;
                }
                if (typeof out.revised_prompt === "string") {
                  revisedPrompt = out.revised_prompt;
                }
                if (out.id) imageCallId = out.id;
              }
            }
          }
        }

        if (imageCallId) lastImageCallForId = imageCallId;
        if (!finalImageBase64) {
          throw new Error("AI generation returned no image data");
        }

        send("progress", { step: "Saving to storage", progress: 88 });

        const buffer = Buffer.from(finalImageBase64, "base64");
        const ext = options.format === "jpeg" ? "jpg" : options.format === "webp" ? "webp" : "png";
        const contentType =
          ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
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
          prompt: revisedPrompt ?? basicPrompt,
          revised_prompt: revisedPrompt ?? null,
          isPublic,
          openai_response_id: responseId ?? null,
          openai_image_call_id: lastImageCallForId ?? null,
          parent_id: parentThumbnailId ?? null,
          size: options.size,
          quality: options.quality,
          format: options.format,
          mode: isRefine(payload) ? "refine" : payload.mode ?? "generate",
        };

        const { data: inserted, error: dbError } = await supabase
          .from("thumbnails")
          .insert(row)
          .select("id")
          .single();

        if (dbError) {
          console.error("DB insert error:", dbError);
        }

        send("complete", {
          step: "Complete",
          progress: 100,
          imageUrl: finalImageUrl,
          thumbnailId: inserted?.id ?? null,
          revisedPrompt: revisedPrompt ?? null,
        });

        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("generate-thumbnail error:", err);
        send("error", { step: "Error", progress: 0, message });
        try {
          controller.close();
        } catch {
          // already closed
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

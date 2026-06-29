import { NextRequest } from "next/server";
import { streamCriticThumbnail } from "@/lib/thumbnailCritic";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      thumbnailId?: string;
      imageUrl?: string;
      prompt?: string | null;
      revisedPrompt?: string | null;
      persist?: boolean;
    };

    let imageUrl = body.imageUrl;
    let prompt = body.prompt ?? null;
    let revisedPrompt = body.revisedPrompt ?? null;

    if (body.thumbnailId) {
      const { data } = await supabase
        .from("thumbnails")
        .select("id, link, prompt, revised_prompt")
        .eq("id", body.thumbnailId)
        .single();
      if (!data) {
        return new Response(
          sseEvent("error", { message: "Not found" }),
          { status: 404, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      imageUrl = imageUrl ?? (data.link as string);
      prompt = prompt ?? (data.prompt as string | null);
      revisedPrompt = revisedPrompt ?? (data.revised_prompt as string | null);
    }

    if (!imageUrl) {
      return new Response(
        sseEvent("error", { message: "imageUrl or thumbnailId required" }),
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
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
        try {
          let finalResult:
            | { score: number; notes: string; suggestions: string[]; mood: string; palette: string; subject: string; tags: string[] }
            | null = null;
          for await (const ev of streamCriticThumbnail({
            imageUrl: imageUrl!,
            prompt,
            revisedPrompt,
          })) {
            send(ev.type, ev);
            if (ev.type === "complete") finalResult = ev.result;
          }

          if (body.persist && body.thumbnailId && finalResult) {
            await supabase
              .from("thumbnails")
              .update({
                critic_score: finalResult.score,
                critic_notes: finalResult.notes,
                critic_suggestions: finalResult.suggestions,
                mood: finalResult.mood,
                palette: finalResult.palette,
                subject: finalResult.subject,
                tags: finalResult.tags,
              })
              .eq("id", body.thumbnailId);
          }
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Unknown error";
          send("error", { type: "error", message });
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(sseEvent("error", { message }), {
      status: 500,
      headers: { "Content-Type": "text/event-stream" } },
    );
  }
}
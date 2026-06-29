import { NextRequest } from "next/server";
import { streamCoachPrompt } from "@/lib/promptCoach";
import { getOpenAIKey } from "@/lib/getOpenAIKey";

export const runtime = "nodejs";

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      videoTitle?: string;
    };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return new Response(
        sseEvent("error", { message: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const apiKey = getOpenAIKey(req);
    if (!apiKey) {
      return new Response(
        sseEvent("error", { message: "OpenAI API key missing. Add your key in Settings → API Keys." }),
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
          for await (const ev of streamCoachPrompt(prompt, body.videoTitle, apiKey)) {
            send(ev.type, ev);
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
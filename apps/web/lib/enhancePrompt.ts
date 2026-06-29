import OpenAI from "openai";
import { systemPrompt } from "./prompts";

export async function enhancePrompt(
  userPrompt: string,
  image_urls: string[] = []
) {
  let result = "";
  for await (const event of streamEnhancePrompt(userPrompt, image_urls)) {
    if (event.type === "complete") result = event.prompt;
  }
  return result;
}

export type EnhancePromptEvent =
  | { type: "start" }
  | { type: "text"; delta: string }
  | { type: "complete"; prompt: string }
  | { type: "error"; message: string };

export async function* streamEnhancePrompt(
  userPrompt: string,
  image_urls: string[] = []
): AsyncGenerator<EnhancePromptEvent> {
  try {
    const ai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const validImageUrls = image_urls.filter(Boolean);
    const content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "auto" | "high" | "low" }
    > = [
      { type: "input_text", text: userPrompt },
      ...validImageUrls.map((url) => ({
        type: "input_image" as const,
        image_url: url,
        detail: "auto" as const,
      })),
    ];

    yield { type: "start" };

    const openaiStream = await ai.responses.create({
      model: "gpt-4.1-mini",
      instructions: systemPrompt,
      input: [{ role: "user", content }],
      stream: true,
      text: {
        format: {
          type: "json_schema",
          name: "thumbnail_prompt",
          schema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description:
                  "A cinematic, vivid thumbnail prompt. Plain text, no markdown.",
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    let accumulated = "";
    for await (const event of openaiStream) {
      if (event.type === "response.output_text.delta") {
        const delta = (event as unknown as { delta?: string }).delta ?? "";
        if (delta) {
          accumulated += delta;
          yield { type: "text", delta };
        }
      }
    }

    let prompt = accumulated;
    if (accumulated) {
      try {
        const parsed = JSON.parse(accumulated) as { prompt?: string };
        if (parsed.prompt) prompt = parsed.prompt;
      } catch {
        // keep raw accumulated text
      }
    }

    yield { type: "complete", prompt };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    yield { type: "error", message };
  }
}
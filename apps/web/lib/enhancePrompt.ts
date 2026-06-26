import OpenAI from "openai";
import { systemPrompt } from "./prompts";

export async function enhancePrompt(
  userPrompt: string,
  image_urls: string[] = []
) {
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

  const response = await ai.responses.create({
    model: "gpt-4.1-mini",
    instructions: systemPrompt,
    input: [{ role: "user", content }],
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

  const text = response.output_text;
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { prompt?: string };
    return parsed.prompt ?? text;
  } catch {
    return text;
  }
}

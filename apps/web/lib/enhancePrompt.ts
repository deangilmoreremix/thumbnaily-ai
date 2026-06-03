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
  const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" }> = [
    { type: "input_text", text: userPrompt },
    ...validImageUrls.map((url) => ({
      type: "input_image" as const,
      image_url: url,
      detail: "high" as const,
    })),
  ];

  const response = await ai.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content,
      },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  if (!response.output_text) {
    return "";
  }
  return response.output_text;
}
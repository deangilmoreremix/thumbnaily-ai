import OpenAI from "openai";

export interface CriticResult {
  score: number;
  notes: string;
  suggestions: string[];
  mood: string;
  palette: string;
  subject: string;
  tags: string[];
}

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "CTR quality score 0-100. Heuristic based on YouTube thumbnail best practices.",
      minimum: 0,
      maximum: 100,
    },
    notes: {
      type: "string",
      description: "One-sentence human-readable critique of the thumbnail.",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "2-4 concrete, actionable suggestions to improve CTR.",
    },
    mood: {
      type: "string",
      description: "One-word mood (e.g. 'dramatic', 'cheerful', 'mysterious').",
    },
    palette: {
      type: "string",
      description: "Dominant color palette descriptor (e.g. 'warm orange/red', 'cool blue/teal', 'high-contrast yellow').",
    },
    subject: {
      type: "string",
      description: "Main subject in 1-3 words (e.g. 'angry man', 'rocket launch').",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "3-6 short searchable tags (mood, style, subject).",
    },
  },
  required: ["score", "notes", "suggestions", "mood", "palette", "subject", "tags"],
  additionalProperties: false,
} as const;

export async function criticThumbnail(params: {
  imageUrl: string;
  prompt?: string | null;
  revisedPrompt?: string | null;
}): Promise<CriticResult | null> {
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await ai.responses.create({
    model: "gpt-4.1-mini",
    instructions:
      "You are an expert YouTube thumbnail critic. Analyze the image for clarity, contrast, focal point, text legibility, emotional impact, and CTR potential. Also classify mood/palette/subject for filtering. Return strict JSON only.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Original prompt: ${params.prompt ?? "(none)"}\n\nRevised prompt: ${params.revisedPrompt ?? "(none)"}\n\nCritique this thumbnail image:`,
          },
          {
            type: "input_image",
            image_url: params.imageUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "thumbnail_critic",
        schema: CRITIC_SCHEMA,
        strict: true,
      },
    },
  });

  const text = response.output_text;
  if (!text) return null;
  try {
    return JSON.parse(text) as CriticResult;
  } catch {
    return null;
  }
}
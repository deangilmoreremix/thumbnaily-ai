import OpenAI from "openai";

export interface PromptCoachResult {
  score: number;
  issues: string[];
  suggestions: string[];
  enhanced: string;
}

const COACH_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Quality score 0-100. Higher = better prompt for thumbnail generation.",
      minimum: 0,
      maximum: 100,
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description: "Short bullet list of problems with the user's prompt (vague, missing subject, missing lighting, etc). Empty if score >= 85.",
    },
    suggestions: {
      type: "array",
      items: { type: "string" },
      description: "Actionable suggestions to improve the prompt.",
    },
    enhanced: {
      type: "string",
      description: "An improved, thumbnail-ready version of the prompt the user could paste back.",
    },
  },
  required: ["score", "issues", "suggestions", "enhanced"],
  additionalProperties: false,
} as const;

export async function coachPrompt(
  userPrompt: string,
  videoTitle?: string
): Promise<PromptCoachResult | null> {
  if (!userPrompt || userPrompt.trim().length < 3) return null;
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const inputParts: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" | "high" | "low" }
  > = [
    {
      type: "input_text",
      text: `Video title (if provided): ${videoTitle?.trim() || "(none)"}\n\nUser prompt:\n${userPrompt}`,
    },
  ];

  const response = await ai.responses.create({
    model: "gpt-4.1-mini",
    instructions:
      "You are a thumbnail prompt coach. Evaluate the user's prompt for clarity, visual specificity, and CTR potential. Return strict JSON only.",
    input: [{ role: "user", content: inputParts }],
    text: {
      format: {
        type: "json_schema",
        name: "prompt_coach",
        schema: COACH_SCHEMA,
        strict: true,
      },
    },
  });

  const text = response.output_text;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as PromptCoachResult;
    return parsed;
  } catch {
    return null;
  }
}
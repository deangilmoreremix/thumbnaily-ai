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
  let result: PromptCoachResult | null = null;
  for await (const event of streamCoachPrompt(userPrompt, videoTitle)) {
    if (event.type === "complete") result = event.result;
    else if (event.type === "error") return null;
  }
  return result;
}

export type PromptCoachEvent =
  | { type: "start" }
  | { type: "score"; value: number }
  | { type: "issue"; text: string }
  | { type: "suggestion"; text: string }
  | { type: "enhanced"; delta: string }
  | { type: "complete"; result: PromptCoachResult }
  | { type: "error"; message: string };

function tryExtractField(
  buffer: string,
  field: "score" | "issues" | "suggestions" | "enhanced"
): { value: unknown; remaining: string } | null {
  const key = `"${field}"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return null;

  const colonIdx = buffer.indexOf(":", idx + key.length);
  if (colonIdx === -1) return null;

  let i = colonIdx + 1;
  while (i < buffer.length && (buffer[i] ?? "").match(/\s/)) i++;
  if (i >= buffer.length) return null;

  const ch = buffer[i];
  if (ch === '"') {
    let j = i + 1;
    let str = "";
    while (j < buffer.length) {
      const c = buffer[j];
      if (c === "\\" && j + 1 < buffer.length) {
        str += (c ?? "") + (buffer[j + 1] ?? "");
        j += 2;
        continue;
      }
      if (c === '"') {
        try {
          const decoded = JSON.parse(`"${str}"`) as string;
          return { value: decoded, remaining: buffer.slice(j + 1) };
        } catch {
          return null;
        }
      }
      str += c ?? "";
      j++;
    }
    return null;
  }

  if (ch === "[") {
    const items: string[] = [];
    let j = i + 1;
    while (j < buffer.length) {
      while (j < buffer.length && (buffer[j] ?? "").match(/\s/)) j++;
      if (j >= buffer.length) return null;
      if (buffer[j] === "]") {
        return { value: items, remaining: buffer.slice(j + 1) };
      }
      if (buffer[j] !== '"') return null;
      let s = "";
      j++;
      while (j < buffer.length) {
        const c = buffer[j];
        if (c === "\\" && j + 1 < buffer.length) {
          s += (c ?? "") + (buffer[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (c === '"') break;
        s += c ?? "";
        j++;
      }
      if (j >= buffer.length) return null;
      try {
        items.push(JSON.parse(`"${s}"`) as string);
      } catch {
        return null;
      }
      j++;
      while (j < buffer.length && (buffer[j] ?? "").match(/[\s,]/)) j++;
    }
    return null;
  }

  if ((ch ?? "").match(/[-0-9]/)) {
    let j = i;
    while (j < buffer.length && (buffer[j] ?? "").match(/[-0-9.eE+]/)) j++;
    const num = Number(buffer.slice(i, j));
    if (Number.isFinite(num)) {
      return { value: num, remaining: buffer.slice(j) };
    }
  }
  return null;
}

export async function* streamCoachPrompt(
  userPrompt: string,
  videoTitle?: string
): AsyncGenerator<PromptCoachEvent> {
  if (!userPrompt || userPrompt.trim().length < 3) {
    yield { type: "error", message: "Prompt too short" };
    return;
  }
  try {
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

    yield { type: "start" };

    const openaiStream = await ai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "You are a thumbnail prompt coach. Evaluate the user's prompt for clarity, visual specificity, and CTR potential. Return strict JSON only.",
      input: [{ role: "user", content: inputParts }],
      stream: true,
      text: {
        format: {
          type: "json_schema",
          name: "prompt_coach",
          schema: COACH_SCHEMA,
          strict: true,
        },
      },
    });

    let buffer = "";
    let accumulated = "";
    const emittedScore = new Set<number>();
    const emittedIssues = new Set<number>();
    const emittedSuggestions = new Set<number>();
    let enhancedOffset = 0;

    for await (const event of openaiStream) {
      if (event.type === "response.output_text.delta") {
        const delta =
          (event as unknown as { delta?: string }).delta ?? "";
        if (!delta) continue;
        accumulated += delta;
        buffer += delta;

        const scoreHit = tryExtractField(buffer, "score");
        if (scoreHit && typeof scoreHit.value === "number") {
          const key = scoreHit.value;
          if (!emittedScore.has(key)) {
            emittedScore.add(key);
            yield { type: "score", value: key };
          }
          buffer = scoreHit.remaining;
        }

        const issuesHit = tryExtractField(buffer, "issues");
        if (issuesHit && Array.isArray(issuesHit.value)) {
          for (const text of issuesHit.value as string[]) {
            const k = issuesHit.value.indexOf(text);
            if (!emittedIssues.has(k)) {
              emittedIssues.add(k);
              yield { type: "issue", text };
            }
          }
          buffer = issuesHit.remaining;
        }

        const suggestionsHit = tryExtractField(buffer, "suggestions");
        if (suggestionsHit && Array.isArray(suggestionsHit.value)) {
          const arr = suggestionsHit.value as string[];
          for (let idx = 0; idx < arr.length; idx++) {
            const text = arr[idx];
            if (typeof text === "string" && !emittedSuggestions.has(idx)) {
              emittedSuggestions.add(idx);
              yield { type: "suggestion", text };
            }
          }
          buffer = suggestionsHit.remaining;
        }

        const enhancedHit = tryExtractField(buffer, "enhanced");
        if (enhancedHit && typeof enhancedHit.value === "string") {
          const fullEnhanced = enhancedHit.value;
          if (fullEnhanced.length > enhancedOffset) {
            const deltaEnhanced = fullEnhanced.slice(enhancedOffset);
            enhancedOffset = fullEnhanced.length;
            yield { type: "enhanced", delta: deltaEnhanced };
          }
          buffer = enhancedHit.remaining;
        }
      }
    }

    let result: PromptCoachResult | null = null;
    if (accumulated) {
      try {
        result = JSON.parse(accumulated) as PromptCoachResult;
      } catch {
        result = null;
      }
    }
    if (!result) {
      yield { type: "error", message: "Failed to parse coach result" };
      return;
    }
    yield { type: "complete", result };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    yield { type: "error", message };
  }
}
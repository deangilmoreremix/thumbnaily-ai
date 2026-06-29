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
  let result: CriticResult | null = null;
  for await (const event of streamCriticThumbnail(params)) {
    if (event.type === "complete") result = event.result;
    else if (event.type === "error") return null;
  }
  return result;
}

export type CriticEvent =
  | { type: "start" }
  | { type: "analyzing" }
  | { type: "score"; value: number }
  | { type: "note"; text: string }
  | { type: "mood"; value: string }
  | { type: "palette"; value: string }
  | { type: "subject"; value: string }
  | { type: "tag"; text: string }
  | { type: "complete"; result: CriticResult }
  | { type: "error"; message: string };

function extractStringField(
  buffer: string,
  field: string
): { value: string; remaining: string } | null {
  const key = `"${field}"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return null;
  const colonIdx = buffer.indexOf(":", idx + key.length);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < buffer.length && (buffer[i] ?? "").match(/\s/)) i++;
  if (i >= buffer.length || buffer[i] !== '"') return null;
  let s = "";
  let j = i + 1;
  while (j < buffer.length) {
    const c = buffer[j];
    if (c === "\\" && j + 1 < buffer.length) {
      s += (c ?? "") + (buffer[j + 1] ?? "");
      j += 2;
      continue;
    }
    if (c === '"') {
      try {
        const decoded = JSON.parse(`"${s}"`) as string;
        return { value: decoded, remaining: buffer.slice(j + 1) };
      } catch {
        return null;
      }
    }
    s += c ?? "";
    j++;
  }
  return null;
}

function extractNumberField(
  buffer: string,
  field: string
): { value: number; remaining: string } | null {
  const key = `"${field}"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return null;
  const colonIdx = buffer.indexOf(":", idx + key.length);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < buffer.length && (buffer[i] ?? "").match(/\s/)) i++;
  if (i >= buffer.length) return null;
  if (!(buffer[i] ?? "").match(/[-0-9]/)) return null;
  let j = i;
  while (j < buffer.length && (buffer[j] ?? "").match(/[-0-9.eE+]/)) j++;
  const num = Number(buffer.slice(i, j));
  if (!Number.isFinite(num)) return null;
  return { value: num, remaining: buffer.slice(j) };
}

function extractStringArrayField(
  buffer: string,
  field: string
): { value: string[]; remaining: string } | null {
  const key = `"${field}"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return null;
  const colonIdx = buffer.indexOf(":", idx + key.length);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < buffer.length && (buffer[i] ?? "").match(/\s/)) i++;
  if (i >= buffer.length || buffer[i] !== "[") return null;
  const items: string[] = [];
  let j = i + 1;
  while (j < buffer.length) {
    while (j < buffer.length && (buffer[j] ?? "").match(/\s/)) j++;
    if (j >= buffer.length) return null;
    if (buffer[j] === "]") return { value: items, remaining: buffer.slice(j + 1) };
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

export async function* streamCriticThumbnail(params: {
  imageUrl: string;
  prompt?: string | null;
  revisedPrompt?: string | null;
}): AsyncGenerator<CriticEvent> {
  try {
    const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    yield { type: "start" };
    yield { type: "analyzing" };

    const openaiStream = await ai.responses.create({
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
      stream: true,
      text: {
        format: {
          type: "json_schema",
          name: "thumbnail_critic",
          schema: CRITIC_SCHEMA,
          strict: true,
        },
      },
    });

    let buffer = "";
    let accumulated = "";
    let emittedScore: number | null = null;
    let emittedNote: string | null = null;
    let emittedMood: string | null = null;
    let emittedPalette: string | null = null;
    let emittedSubject: string | null = null;
    const emittedTags = new Set<number>();

    for await (const event of openaiStream) {
      if (event.type === "response.output_text.delta") {
        const delta = (event as unknown as { delta?: string }).delta ?? "";
        if (!delta) continue;
        accumulated += delta;
        buffer += delta;

        const scoreHit = extractNumberField(buffer, "score");
        if (scoreHit && emittedScore !== scoreHit.value) {
          emittedScore = scoreHit.value;
          yield { type: "score", value: scoreHit.value };
          buffer = scoreHit.remaining;
        }

        const notesHit = extractStringField(buffer, "notes");
        if (notesHit && emittedNote !== notesHit.value) {
          emittedNote = notesHit.value;
          yield { type: "note", text: notesHit.value };
          buffer = notesHit.remaining;
        }

        const moodHit = extractStringField(buffer, "mood");
        if (moodHit && emittedMood !== moodHit.value) {
          emittedMood = moodHit.value;
          yield { type: "mood", value: moodHit.value };
          buffer = moodHit.remaining;
        }

        const paletteHit = extractStringField(buffer, "palette");
        if (paletteHit && emittedPalette !== paletteHit.value) {
          emittedPalette = paletteHit.value;
          yield { type: "palette", value: paletteHit.value };
          buffer = paletteHit.remaining;
        }

        const subjectHit = extractStringField(buffer, "subject");
        if (subjectHit && emittedSubject !== subjectHit.value) {
          emittedSubject = subjectHit.value;
          yield { type: "subject", value: subjectHit.value };
          buffer = subjectHit.remaining;
        }

        const tagsHit = extractStringArrayField(buffer, "tags");
        if (tagsHit) {
          for (let idx = 0; idx < tagsHit.value.length; idx++) {
            const text = tagsHit.value[idx];
            if (typeof text === "string" && !emittedTags.has(idx)) {
              emittedTags.add(idx);
              yield { type: "tag", text };
            }
          }
          buffer = tagsHit.remaining;
        }
      }
    }

    let result: CriticResult | null = null;
    if (accumulated) {
      try {
        result = JSON.parse(accumulated) as CriticResult;
      } catch {
        result = null;
      }
    }
    if (!result) {
      yield { type: "error", message: "Failed to parse critic result" };
      return;
    }
    yield { type: "complete", result };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    yield { type: "error", message };
  }
}
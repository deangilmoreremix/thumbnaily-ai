import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const headerKey = req.headers.get("x-openai-key");
    let bodyKey: string | undefined;
    try {
      const body = (await req.json()) as { apiKey?: string };
      bodyKey = body.apiKey;
    } catch {
      /* no body */
    }
    const key = (headerKey ?? bodyKey ?? "").trim();

    if (!key) {
      return Response.json({ valid: false, error: "Missing API key" }, { status: 400 });
    }
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
      return Response.json({ valid: false, error: "Invalid API key format" }, { status: 400 });
    }

    const ai = new OpenAI({ apiKey: key });
    const res = await ai.models.list();
    return Response.json({ valid: true, count: res.data?.length ?? 0 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ valid: false, error: message }, { status: 401 });
  }
}
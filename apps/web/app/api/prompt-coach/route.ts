import { NextRequest, NextResponse } from "next/server";
import { coachPrompt } from "@/lib/promptCoach";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      videoTitle?: string;
    };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    const result = await coachPrompt(prompt, body.videoTitle);
    if (!result) {
      return NextResponse.json(
        { error: "Failed to evaluate prompt" },
        { status: 500 }
      );
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
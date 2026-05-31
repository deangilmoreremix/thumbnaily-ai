// API endpoint - video generation disabled (using OpenAI image only)
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: true, message: "Video generation is not available. Please use image generation only." },
    { status: 400 }
  );
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ error: "Video generation is not available" }, { status: 400 });
}
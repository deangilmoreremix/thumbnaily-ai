// API endpoint for MuAPI video generation
import { NextRequest, NextResponse } from "next/server";
import { muApiClient, MuApiVideoResponse } from "@/lib/muapi";
import { supabaseAdmin } from "@/lib/supabase";

interface ProgressData {
  step: string;
  progress: number;
  videoUrl?: string;
  error?: string;
}

const progressStore = new Map<string, ProgressData>();

const updateProgress = (
  progressId: string,
  step: string,
  progress: number,
  videoUrl?: string,
  error?: string,
) => {
  progressStore.set(progressId, { step, progress, videoUrl, error });
};

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { prompt, imageUrl, duration } = await req.json();

    if (!prompt) {
      updateProgress(progressId, "Error", 10, undefined, "Prompt is required");
      return NextResponse.json(
        { error: true, message: "Prompt is required", progressId },
        { status: 400 }
      );
    }

    (async () => {
      try {
        updateProgress(progressId, "Generating video", 30);

        const result = await muApiClient.generateVideo({
          prompt,
          duration: duration || 5,
          ...(imageUrl && { image_urls: [imageUrl] }),
        }) as MuApiVideoResponse;

        if (!result || !result.video_url) {
          throw new Error("Video generation failed");
        }

        updateProgress(progressId, "Downloading video", 60);
        const videoResponse = await fetch(result.video_url);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: ${videoResponse.statusText}`);
        }
        const videoBuffer = await videoResponse.arrayBuffer();

        updateProgress(progressId, "Uploading to storage", 80);

        const key = `thumbnails/videos/${Date.now().toString()}_${Math.floor(Math.random() * 1000)}.mp4`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from('thumbnails')
          .upload(key, Buffer.from(videoBuffer), {
            contentType: 'video/mp4',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from('thumbnails')
          .getPublicUrl(key);

        updateProgress(progressId, "Complete", 100, publicUrlData.publicUrl);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Video generation failed";
        updateProgress(progressId, "Error", 100, undefined, errorMessage);
      } finally {
        setTimeout(() => progressStore.delete(progressId), 120000);
      }
    })();

    return NextResponse.json({ progressId });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "Failed to process request";
    return NextResponse.json(
      { error: true, message: errorMessage, progressId },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const progressId = url.searchParams.get("progressId");

  if (!progressId) {
    return NextResponse.json({ error: "Progress ID required" }, { status: 400 });
  }

  const progress = progressStore.get(progressId);
  if (!progress) {
    return NextResponse.json({ error: "Invalid progress ID" }, { status: 404 });
  }

  return NextResponse.json(progress);
}
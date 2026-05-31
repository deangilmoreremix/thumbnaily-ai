// API endpoint for image enhancement features
import { NextRequest, NextResponse } from "next/server";
import { muApiClient, MuApiImageResponse } from "@/lib/muapi";
import { supabaseAdmin } from "@/lib/supabase";

interface ProgressData {
  step: string;
  progress: number;
  imageUrl?: string;
  error?: string;
}

const progressStore = new Map<string, ProgressData>();

const updateProgress = (
  progressId: string,
  step: string,
  progress: number,
  imageUrl?: string,
  error?: string,
) => {
  progressStore.set(progressId, { step, progress, imageUrl, error });
};

type EnhancementType = 'upscale' | 'background_removal' | 'face_enhance' | 'ghibli_style' | 'outpaint';

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { imageUrl, enhancementType, prompt } = await req.json();

    if (!imageUrl) {
      updateProgress(progressId, "Error", 10, undefined, "Image URL is required");
      return NextResponse.json(
        { error: true, message: "Image URL is required", progressId },
        { status: 400 }
      );
    }

    if (!enhancementType) {
      updateProgress(progressId, "Error", 10, undefined, "Enhancement type is required");
      return NextResponse.json(
        { error: true, message: "Enhancement type is required", progressId },
        { status: 400 }
      );
    }

    (async () => {
      try {
        updateProgress(progressId, `Applying ${enhancementType} enhancement`, 30);

        const result = await muApiClient.enhanceImage(imageUrl, enhancementType, prompt);

        if (!result || !('images' in result) || !result.images?.[0]?.url) {
          throw new Error("Enhancement failed");
        }

        updateProgress(progressId, "Downloading enhanced image", 60);
        const imageResponse = await fetch(result.images[0].url);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download enhanced image: ${imageResponse.statusText}`);
        }
        const imageBuffer = await imageResponse.arrayBuffer();

        updateProgress(progressId, "Uploading to storage", 80);

        const key = `thumbnails/enhanced/${Date.now().toString()}_${Math.floor(Math.random() * 1000)}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from('thumbnails')
          .upload(key, Buffer.from(imageBuffer), {
            contentType: 'image/png',
          });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from('thumbnails')
          .getPublicUrl(key);

        updateProgress(progressId, "Complete", 100, publicUrlData.publicUrl);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Enhancement failed";
        updateProgress(progressId, "Error", 100, undefined, errorMessage);
      } finally {
        setTimeout(() => progressStore.delete(progressId), 60000);
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
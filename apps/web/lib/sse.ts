export interface SSEHandlers {
  onProgress?: (data: { step?: string; progress?: number }) => void;
  onPartial?: (data: { index?: number; base64?: string }) => void;
  onComplete?: (data: {
    step?: string;
    progress?: number;
    imageUrl?: string;
    thumbnailId?: string | null;
    revisedPrompt?: string | null;
  }) => void;
  onError?: (data: { step?: string; progress?: number; message?: string }) => void;
}

export async function consumeSSE(
  response: Response,
  handlers: SSEHandlers
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported in this browser");
  }
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    // eslint-disable-next-line no-cond-assign
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      } catch {
        continue;
      }

      switch (eventName) {
        case "progress":
          handlers.onProgress?.(parsed as { step?: string; progress?: number });
          break;
        case "partial":
          handlers.onPartial?.(parsed as { index?: number; base64?: string });
          break;
        case "complete":
          handlers.onComplete?.(
            parsed as {
              step?: string;
              progress?: number;
              imageUrl?: string;
              thumbnailId?: string | null;
              revisedPrompt?: string | null;
            }
          );
          break;
        case "error":
          handlers.onError?.(
            parsed as {
              step?: string;
              progress?: number;
              message?: string;
            }
          );
          break;
      }
    }
  }
}

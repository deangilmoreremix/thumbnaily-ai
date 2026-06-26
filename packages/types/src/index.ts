import { z } from "zod"

export const inputType = z.object({
  prompt: z.string(),
  reference: z.string().optional(),
  creatorID: z.string(),
});


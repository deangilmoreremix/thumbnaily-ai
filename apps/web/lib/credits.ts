// Credits module - unused for anonymous mode
// Kept for reference if authentication is added later

export async function reduceCredit(_params: { email: string; cost: number }): Promise<void> {
  // No-op for anonymous mode
}

export async function addCredit(_params: { email: string; add: number }): Promise<void> {
  // No-op for anonymous mode
}
import { NextRequest, NextResponse } from "next/server";

const WEBHOOK_SECRET = process.env.DODO_PAYMENTS_WEBHOOK_SECRET;

// Webhook handler - disabled if secret not configured
export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.log("Webhook disabled - DODO_PAYMENTS_WEBHOOK_SECRET not configured");
    return NextResponse.json({ message: "Webhook not configured" }, { status: 200 });
  }

  try {
    // Webhook logic would go here if configured
    console.log("Webhook received but no payment integration configured");
    return NextResponse.json({ message: "Webhook received" }, { status: 200 });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json("hi");
}
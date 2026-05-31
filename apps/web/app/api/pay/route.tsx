import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // Test endpoint - no auth required
  return NextResponse.json({
    message: "Payment endpoint - configure DODO_PAYMENTS_API_KEY to use"
  });
}

export async function POST(req: NextRequest) {
  const { product_id, country } = await req.json();
  
  if (!product_id || !country) {
    return NextResponse.json({
      error: true,
      message: "Product ID and country are required"
    });
  }

  // Dodo Payments requires API key - return error if not configured
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    return NextResponse.json({
      error: true,
      message: "Payment gateway not configured"
    });
  }

  // Would integrate with DodoPayments here when API key is set up
  return NextResponse.json({
    link: null,
    message: "Payment processing not configured"
  });
}
import { NextResponse } from "next/server";

export async function GET() {
  // Without auth, credits are free
  return NextResponse.json({ credits: "unlimited" });
}
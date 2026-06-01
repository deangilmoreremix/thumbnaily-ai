import { NextRequest , NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const { email } = await req.json();

    if (!email) {
        return NextResponse.json({
            success: false,
            message: "Email is required"
        });
    }

    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
        .from('waitlist_users')
        .select('id')
        .eq('email', email)
        .single();

    if (existingUser) {
        return NextResponse.json({
            success: true,
            message: "Email already in waitlist"
        });
    }

    // Insert email into waitlist
    const { error } = await supabaseAdmin
        .from('waitlist_users')
        .insert({ email });

    if (error) {
        return NextResponse.json({
            success: false,
            message: error.message
        });
    }

    return NextResponse.json({
        success: true,
        message: "Successfully added to waitlist"
    });
}
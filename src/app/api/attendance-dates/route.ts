import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // Format: YYYY-MM

    if (!month) {
      return NextResponse.json(
        { error: "Month parameter is required (YYYY-MM)" },
        { status: 400 }
      );
    }

    // Get all dates that have attendance data for the specified month
    const { data: attendanceDates, error } = await supabaseAdmin
      .from("attendance")
      .select("created_at")
      .gte("created_at", `${month}-01T00:00:00`)
      .lt("created_at", `${month}-31T23:59:59`);

    if (error) {
      console.error("Error fetching attendance dates:", error);
      return NextResponse.json(
        { error: "Failed to fetch attendance dates" },
        { status: 500 }
      );
    }

    // // Extract unique dates (YYYY-MM-DD format)
    // const uniqueDates = new Set<string>();
    // attendanceDates?.forEach(record => {
    //   const date = record.created_at.split('T')[0]; // Extract YYYY-MM-DD
    //   uniqueDates.add(date);
    // });
    // Extract unique LOCAL dates (YYYY-MM-DD)
    const fmtLocalDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const uniqueDates = new Set<string>();
    attendanceDates?.forEach((record) => {
      const dt = new Date(record.created_at);
      uniqueDates.add(fmtLocalDate(dt));
    });

    return NextResponse.json({ dates: Array.from(uniqueDates) });
  } catch (err: any) {
    console.error("Attendance dates fetch error:", err);
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

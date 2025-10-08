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
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID parameter is required" },
        { status: 400 }
      );
    }

    // Get attendance records for the specific user, ordered by date
    const { data: attendanceRecords, error } = await supabaseAdmin
      .from("attendance")
      .select("created_at, present, note, lat, lng")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching employee attendance:", error);
      return NextResponse.json(
        { error: "Failed to fetch attendance records" },
        { status: 500 }
      );
    }

    // // Transform the data to include formatted dates
    // const formattedRecords = attendanceRecords?.map(record => ({
    //   ...record,
    //   date: record.created_at.split('T')[0], // Extract YYYY-MM-DD
    //   time: record.created_at.split('T')[1]?.split('.')[0] || '12:00:00', // Extract HH:MM:SS
    //   status: record.present ? 'Present' : 'Absent'
    // })) || [];
    // Helpers for LOCAL formatting (no UTC drift)
    const fmtLocalDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`; // YYYY-MM-DD local
    };
    const fmtLocalTime = (d: Date) =>
      d.toLocaleTimeString("en-US", { hour12: false }); // HH:MM:SS local

    const formattedRecords =
      attendanceRecords?.map((record) => {
        const dt = new Date(record.created_at); // parse ISO with TZ
        return {
          ...record,
          date: fmtLocalDate(dt), // LOCAL day (e.g., 2025-10-08)
          time: fmtLocalTime(dt), // LOCAL time (e.g., 17:00:00)
          status: record.present ? "Present" : "Absent",
        };
      }) || [];

    return NextResponse.json({
      attendance: formattedRecords,
      total: formattedRecords.length,
      present: formattedRecords.filter((r) => r.present).length,
      absent: formattedRecords.filter((r) => !r.present).length,
    });
  } catch (err: any) {
    console.error("Employee attendance fetch error:", err);
    return NextResponse.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

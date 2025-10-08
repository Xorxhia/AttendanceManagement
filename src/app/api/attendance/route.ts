import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    
    if (!date) {
      return NextResponse.json({ error: 'Date parameter is required' }, { status: 400 });
    }

    // Get attendance for specific date
    const { data: attendance, error } = await supabaseAdmin
      .from('attendance')
      .select('user_id, present, note')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);

    if (error) {
      console.error('Error fetching attendance:', error);
      return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 });
    }

    // Transform to user_id -> present mapping
    const attendanceMap: Record<string, boolean> = {};
    attendance?.forEach(record => {
      attendanceMap[record.user_id] = record.present;
    });

    return NextResponse.json({ attendance: attendanceMap });
  } catch (err: any) {
    console.error('Attendance fetch error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// /api/attendance/route.ts (POST)
export async function POST(request: NextRequest) {
  try {
    const { date, attendance } = await request.json();
    if (!date || !attendance) {
      return NextResponse.json({ error: 'Date and attendance data are required' }, { status: 400 });
    }

    // 1) Wipe existing for the day
    const { error: deleteError } = await supabaseAdmin
      .from('attendance')
      .delete()
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);
    if (deleteError) {
      console.error('Error deleting existing attendance:', deleteError);
      return NextResponse.json({ error: 'Failed to update attendance' }, { status: 500 });
    }

    // 2) Fetch ALL employees
    const { data: employees, error: empErr } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'employee');
    if (empErr) {
      console.error('Error loading employees:', empErr);
      return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 });
    }

    // 3) Build full records: default to ABSENT when not provided
    const records = (employees || []).map((e) => ({
      user_id: e.user_id,
      present: Boolean(attendance[e.user_id]), // missing/undefined -> false (Absent)
      created_at: `${date}T12:00:00`,         // keep your noon anchor
      note: null,
      lat: null,
      lng: null,
    }));

    // Safety: if no employees, just succeed (nothing to insert)
    if (records.length === 0) {
      return NextResponse.json({ success: true, message: 'No employees found; nothing to save' });
    }

    // 4) Insert all rows
    const { error: insertError } = await supabaseAdmin.from('attendance').insert(records);
    if (insertError) {
      console.error('Error saving attendance:', insertError);
      return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Attendance saved successfully',
      counts: {
        total: records.length,
        present: records.filter(r => r.present).length,
        absent: records.filter(r => !r.present).length,
      },
    });
  } catch (err: any) {
    console.error('Attendance save error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

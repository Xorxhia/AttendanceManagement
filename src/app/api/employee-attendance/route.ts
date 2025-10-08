import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
function ensureEnv() {
  if (!supabaseUrl || !supabaseServiceKey) throw new Error('Server misconfigured: Supabase env vars missing');
}
function getClient() {
  ensureEnv();
  return createClient(supabaseUrl!, supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const fmtLocalDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fmtLocalTime = (d: Date) => d.toLocaleTimeString('en-US', { hour12: false });

export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) return jsonError(400, 'bad_request', 'User ID parameter is required');

    const supabase = getClient();

    const { data: attendanceRecords, error } = await supabase
      .from('attendance')
      .select('created_at, present, note, lat, lng')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[attendance by-user GET]', { reqId, userId, error });
      return jsonError(500, 'db_error', 'Failed to fetch attendance records');
    }

    const formattedRecords =
      attendanceRecords?.map((record) => {
        const dt = new Date(record.created_at);
        return {
          ...record,
          date: fmtLocalDate(dt),
          time: fmtLocalTime(dt),
          status: record.present ? 'Present' : 'Absent',
        };
      }) || [];

    return NextResponse.json({
      attendance: formattedRecords,
      total: formattedRecords.length,
      present: formattedRecords.filter((r) => r.present).length,
      absent: formattedRecords.filter((r) => !r.present).length,
    });
  } catch (err: any) {
    console.error('[attendance by-user GET] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}

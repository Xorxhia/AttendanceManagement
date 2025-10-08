import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function ensureEnv() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Server misconfigured: Supabase env vars missing');
  }
}

function getClient() {
  ensureEnv();
  return createClient(supabaseUrl!, supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isValidDateStr(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) return jsonError(400, 'bad_request', 'Date parameter is required');
    if (!isValidDateStr(date)) return jsonError(400, 'bad_request', 'Date must be YYYY-MM-DD');

    const supabase = getClient();

    const { data: attendance, error } = await supabase
      .from('attendance')
      .select('user_id, present, note')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`);

    if (error) {
      console.error('[attendance GET]', { reqId, date, error });
      return jsonError(500, 'db_error', 'Failed to fetch attendance');
    }

    const attendanceMap: Record<string, boolean> = {};
    attendance?.forEach((record) => {
      attendanceMap[record.user_id] = !!record.present;
    });

    return NextResponse.json({ attendance: attendanceMap }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[attendance GET] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}

export async function POST(request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'bad_request', 'Invalid JSON body');
    }

    const { date, attendance } = body || {};
    if (!date || attendance == null) return jsonError(400, 'bad_request', 'Date and attendance data are required');
    if (!isValidDateStr(date)) return jsonError(400, 'bad_request', 'Date must be YYYY-MM-DD');
    if (typeof attendance !== 'object' || Array.isArray(attendance)) {
      return jsonError(400, 'bad_request', '`attendance` must be an object of { [user_id]: boolean }');
    }

    // Optional: basic size guard (keeps behavior but prevents massive bodies from hurting the server)
    const entryCount = Object.keys(attendance).length;
    if (entryCount > 10000) return jsonError(413, 'payload_too_large', 'Too many attendance entries');

    const supabase = getClient();

    // 1) Wipe existing for the day (kept)
    const { error: deleteError } = await supabase
      .from('attendance')
      .delete()
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59.999`);
    if (deleteError) {
      console.error('[attendance POST] delete error', { reqId, date, deleteError });
      return jsonError(500, 'db_error', 'Failed to update attendance');
    }

    // 2) Fetch ALL employees (kept)
    const { data: employees, error: empErr } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'employee');
    if (empErr) {
      console.error('[attendance POST] load employees', { reqId, empErr });
      return jsonError(500, 'db_error', 'Failed to load employees');
    }

    // 3) Build full records (kept semantics)
    const records = (employees || []).map((e) => ({
      user_id: e.user_id,
      present: Boolean(attendance[e.user_id]),
      created_at: `${date}T12:00:00`,
      note: null as string | null,
      lat: null as number | null,
      lng: null as number | null,
    }));

    if (records.length === 0) {
      return NextResponse.json({ success: true, message: 'No employees found; nothing to save' });
    }

    // 4) Insert all rows (kept)
    const { error: insertError } = await supabase.from('attendance').insert(records);
    if (insertError) {
      console.error('[attendance POST] insert error', { reqId, insertError });
      return jsonError(500, 'db_error', 'Failed to save attendance');
    }

    const presentCount = records.reduce((n, r) => n + (r.present ? 1 : 0), 0);

    return NextResponse.json({
      success: true,
      message: 'Attendance saved successfully',
      counts: {
        total: records.length,
        present: presentCount,
        absent: records.length - presentCount,
      },
    });
  } catch (err: any) {
    console.error('[attendance POST] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}

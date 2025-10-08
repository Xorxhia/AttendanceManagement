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
function isValidMonthStr(m: string): boolean {
  return /^\d{4}-\d{2}$/.test(m);
}
// Compute inclusive month start and a safe end (up to 31st; keeps your original behavior)
function monthBounds(month: string) {
  return {
    start: `${month}-01T00:00:00`,
    end: `${month}-31T23:59:59.999`,
  };
}
const fmtLocalDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM

    if (!month) return jsonError(400, 'bad_request', 'Month parameter is required (YYYY-MM)');
    if (!isValidMonthStr(month)) return jsonError(400, 'bad_request', 'Month must be YYYY-MM');

    const supabase = getClient();
    const { start, end } = monthBounds(month);

    const { data: attendanceDates, error } = await supabase
      .from('attendance')
      .select('created_at')
      .gte('created_at', start)
      .lt('created_at', end);

    if (error) {
      console.error('[attendance dates GET]', { reqId, month, error });
      return jsonError(500, 'db_error', 'Failed to fetch attendance dates');
    }

    const uniqueDates = new Set<string>();
    attendanceDates?.forEach((record) => {
      const dt = new Date(record.created_at);
      uniqueDates.add(fmtLocalDate(dt));
    });

    return NextResponse.json({ dates: Array.from(uniqueDates) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[attendance dates GET] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}

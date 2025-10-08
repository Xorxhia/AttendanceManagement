export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) console.error('[delete-user] Missing NEXT_PUBLIC_SUPABASE_URL');
if (!serviceKey) console.error('[delete-user] Missing SUPABASE_SERVICE_ROLE_KEY');

const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey) : null;

type Err = { error: string };
function jsonError(status: number, message: string) {
  return NextResponse.json<Err>({ error: message }, { status });
}

export async function POST(req: Request) {
  const reqId = crypto.randomUUID();
  try {
    if (!supabaseAdmin) return jsonError(500, 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const userId = body?.userId;
    if (!userId || typeof userId !== 'string') return jsonError(400, 'User ID is required');

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('[delete-user] delete error', { reqId, err: error.message });
      return jsonError(400, error.message || 'Delete failed');
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[delete-user] unhandled', { reqId, err: e?.message || e });
    return jsonError(400, e?.message || 'Delete failed');
  }
}

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL');
}
if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = url && serviceKey
  ? createClient(url, serviceKey)
  : null;

export async function POST(req: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing' },
        { status: 500 }
      );
    }

    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Delete the auth user
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('Delete user error:', error);
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('delete-user error:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 400 });
  }
}
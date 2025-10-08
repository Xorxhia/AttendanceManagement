export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type Ok = {
  ok: true;
  user: {
    id: string;
    email: string | null;
    username: string;
    avatar_url: string | null;
  };
};
type Err = { error: string };

function jsonError(status: number, message: string) {
  return NextResponse.json<Err>({ error: message }, { status });
}

export async function POST(req: Request) {
  const reqId = crypto.randomUUID();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      return jsonError(500, 'Server misconfigured: envs missing');
    }

    const supabaseAdmin = createClient(url, serviceKey);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError(400, 'Invalid multipart form data');
    }

    const email = String(form.get('email') || '').trim();
    const username = String(form.get('username') || '').trim().toLowerCase();
    const password = String(form.get('password') || '').trim();
    const phone = (String(form.get('phone') || '').trim()) || null;
    const address = (String(form.get('address') || '').trim()) || null;
    const cnic_no = (String(form.get('cnic_no') || '').trim()) || null;
    const photo = (form.get('photo') as File | null) || null;

    if (!username || !password) return jsonError(400, 'Missing required fields: username, password');
    if (photo && typeof photo.size === 'number' && photo.size > 10 * 1024 * 1024) {
      return jsonError(413, 'Photo too large (max 10MB)');
    }

    // 1) Create auth user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: email || `${username}@temp.local`,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (createErr) {
      console.error('[create-user] admin.createUser', { reqId, err: createErr.message });
      return jsonError(400, createErr.message);
    }
    const user = created.user;

    // 2) Best-effort photo upload
    let avatar_url: string | null = null;
    if (photo && photo.size > 0) {
      try {
        const mime = photo.type || 'image/jpeg';
        const ext = (mime.split('/')[1] || 'jpg').toLowerCase();
        const path = `${user.id}/avatar.${ext}`;
        const buf = new Uint8Array(await photo.arrayBuffer());

        const { error: uploadErr } = await supabaseAdmin.storage.from('profiles').upload(path, buf, {
          contentType: mime,
          upsert: true,
        });

        if (uploadErr) {
          console.warn('[create-user] upload failed (continuing)', { reqId, err: uploadErr.message });
        } else {
          const { data: pub } = supabaseAdmin.storage.from('profiles').getPublicUrl(path);
          avatar_url = pub?.publicUrl || null;
        }
      } catch (e: any) {
        console.warn('[create-user] upload threw (continuing)', { reqId, err: e?.message || e });
      }
    }

    // 3) Upsert extended profile fields (role=employee), kept behavior
    const { error: profErr } = await supabaseAdmin
      .from('user_profiles')
      .upsert(
        { user_id: user.id, email: email || null, username, role: 'employee', phone, address, cnic_no, avatar_url },
        { onConflict: 'user_id' }
      );

    if (profErr) {
      console.error('[create-user] profile upsert', { reqId, err: profErr.message });
      return jsonError(400, 'User created but profile update failed: ' + profErr.message);
    }

    const res: Ok = {
      ok: true,
      user: { id: user.id, email: email || null, username, avatar_url: avatar_url ?? null },
    };
    return NextResponse.json(res, { status: 200 });
  } catch (e: any) {
    console.error('[create-user] fatal', { reqId, err: e?.message || e });
    return jsonError(400, e?.message || 'Create failed');
  }
}

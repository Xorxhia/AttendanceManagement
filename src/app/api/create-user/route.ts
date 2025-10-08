// src/app/api/create-user/route.ts
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

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      return NextResponse.json<Err>({ error: 'Server misconfigured: envs missing' }, { status: 500 });
    }

    const supabaseAdmin = createClient(url, serviceKey);

    // Parse multipart form-data (supports photo upload)
    const form = await req.formData();
    const email = String(form.get('email') || '').trim();
    const username = String(form.get('username') || '').trim().toLowerCase();
    const password = String(form.get('password') || '').trim();
    const phone = (String(form.get('phone') || '').trim()) || null;
    const address = (String(form.get('address') || '').trim()) || null;
    const cnic_no = (String(form.get('cnic_no') || '').trim()) || null;
    const photo = form.get('photo') as File | null;

    if (!username || !password) {
      return NextResponse.json<Err>(
        { error: 'Missing required fields: username, password' },
        { status: 400 }
      );
    }

    // 1) Create auth user (confirmed)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: email || `${username}@temp.local`, // Use provided email or generate temp one
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (createErr) {
      console.error('admin.createUser:', createErr.message);
      return NextResponse.json<Err>({ error: createErr.message }, { status: 400 });
    }
    const user = created.user;

    // 2) Best-effort photo upload to 'profiles' bucket
    let avatar_url: string | null = null;
    if (photo && photo.size > 0) {
      try {
        const ext = (photo.type?.split('/')[1] || 'jpg').toLowerCase();
        const path = `${user.id}/avatar.${ext}`;
        const buf = new Uint8Array(await photo.arrayBuffer());

        const { error: uploadErr } = await supabaseAdmin
          .storage
          .from('profiles')
          .upload(path, buf, {
            contentType: photo.type || 'image/jpeg',
            upsert: true,
          });

        if (uploadErr) {
          console.warn('upload failed (continuing):', uploadErr.message);
        } else {
          const { data: pub } = supabaseAdmin.storage.from('profiles').getPublicUrl(path);
          avatar_url = pub?.publicUrl || null;
        }
      } catch (e: any) {
        console.warn('upload threw (continuing):', e?.message || e);
      }
    }

    // 3) Upsert extended profile fields; force role = employee
    const { error: profErr } = await supabaseAdmin
      .from('user_profiles')
      .upsert(
        {
          user_id: user.id,
          email: email || null, // Use provided email or null if not provided
          username,
          role: 'employee',
          phone,
          address,
          cnic_no,
          avatar_url: avatar_url ?? null,
        },
        { onConflict: 'user_id' }
      );

    if (profErr) {
      console.error('profile upsert:', profErr.message);
      return NextResponse.json<Err>(
        { error: 'User created but profile update failed: ' + profErr.message },
        { status: 400 }
      );
    }

    // 4) Return safe payload (email/ avatar_url coerced to nulls)
    const res: Ok = {
      ok: true,
      user: {
        id: user.id,
        email: email || null, // Return provided email or null
        username,
        avatar_url: avatar_url ?? null,
      },
    };
    return NextResponse.json(res, { status: 200 });
  } catch (e: any) {
    console.error('create-user fatal:', e?.message || e);
    return NextResponse.json<Err>({ error: e?.message || 'Create failed' }, { status: 400 });
  }
}

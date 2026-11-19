-- SOURCE-UPLOAD-FIX-01 자료 파일(source_assets) 직접 업로드. 배정: Claude(master) SOURCE-UPLOAD-FIX-01(P3C 보고 F1).
-- 문제: 지금은 서버 액션이 파일을 받는다. 운영 Vercel 함수 요청 본문은 4.5MB 까지라(초과 413 FUNCTION_PAYLOAD_TOO_LARGE)
--   안내한 10MB(D05)를 받을 수 없다. next.config 의 bodySizeLimit 11mb 는 Next 한도일 뿐 플랫폼 한도를 넘지 못한다.
-- 바꾸는 것(P3C 디자인 자산과 같은 방식):
--   1) source_asset_uploads(예약): 사용자는 읽기·쓰기 없음. 경로는 DB 가 정한다 — 기존과 같은 모양 <업무실>/<자료id>/original.<확장자>
--   2) 저장소 source-assets insert 정책: "내 업무실 경로 아무 곳" → "진행 중·만료 전·내 예약 경로만"(update·delete 정책은 원래 없음)
--   3) reserve_source_upload / confirm_source_upload / reject_source_upload: 서버 서명(source_asset_signing = 앱 SOURCE_ASSET_SIGNING_KEY)
--      확정은 저장소 객체 metadata 크기·형식을 예약과 대조하고, 앱 서버가 받은 바이트로 잰 sha256 으로 source_assets 행(stored)을 만든다.
-- 바뀌지 않는 것: source_assets 표·기존 행·기존 파일 경로·select 정책(내려받기·백업 그대로). 글·링크 자료는 기존 그대로.
--   기존 '올리는 중'(pending) 행의 '저장 다시 확인'도 그대로 쓴다.
-- 잠금: 예약은 advisory(32001, 업무실) 하나. 확정은 예약 행 FOR UPDATE 하나.

-- ─────────────────────────────────────────────
-- 0) 값 규칙
-- ─────────────────────────────────────────────
-- 형식 → 저장 확장자(기존 경로와 같음: jpeg 는 jpg)
create or replace function app.source_mime_ext(p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'text/plain' then 'txt' end
$$;
revoke execute on function app.source_mime_ext(text) from public, anon;

-- 화면 표시용 파일 이름(앱 displayFileName 로 정리한 값): 1~200자, 경로 구분자·제어 문자 없음, 확장자가 형식과 맞음
create or replace function app.source_file_name_ok(p_name text, p_mime text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
       char_length(p_name) between 1 and 200
       and p_name !~ '[\\/]'
       and p_name !~ '[[:cntrl:]]'
       and lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (case p_mime
             when 'image/jpeg' then array['jpg', 'jpeg']
             else array[app.source_mime_ext(p_mime)] end), false)
$$;
revoke execute on function app.source_file_name_ok(text, text) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 예약 표
-- ─────────────────────────────────────────────
create table public.source_asset_uploads (
  id            uuid primary key default gen_random_uuid(),   -- = 확정 뒤 source_assets.id
  workspace_id  uuid not null references public.workspaces (id),
  client_id     uuid,
  project_id    uuid,
  object_key    text not null unique,
  file_name     text not null,
  mime          text not null check (app.source_mime_ext(mime) is not null),
  bytes         bigint not null check (bytes between 1 and 10485760),
  status        text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  reject_reason text check (reject_reason in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'EMPTY', 'MISSING')),
  expires_at    timestamptz not null,
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  check (client_id is not null or project_id is not null),
  check (app.source_file_name_ok(file_name, mime)),
  check ((status = 'rejected') = (reject_reason is not null)),
  check ((status = 'pending') = (decided_at is null)),
  foreign key (workspace_id, client_id)  references public.clients (workspace_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id)
);
create index source_asset_uploads_pending on public.source_asset_uploads (workspace_id, expires_at) where status = 'pending';
alter table public.source_asset_uploads enable row level security;
revoke all on public.source_asset_uploads from anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) 저장소 insert 정책: 예약된 내 경로만
-- ─────────────────────────────────────────────
create or replace function app.source_upload_key_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.source_asset_uploads u join public.workspaces w on w.id = u.workspace_id
     where u.object_key = p_name and u.status = 'pending' and u.expires_at > now()
       and u.created_by = auth.uid() and w.owner_user_id = auth.uid())
$$;
revoke execute on function app.source_upload_key_ok(text) from public, anon;
grant execute on function app.source_upload_key_ok(text) to authenticated;

drop policy if exists source_assets_objects_insert on storage.objects;
create policy source_assets_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'source-assets' and app.source_upload_key_ok(name));

-- ─────────────────────────────────────────────
-- 3) 서버 서명(DEC-08 과 같은 HMAC, 비밀값만 따로)
-- ─────────────────────────────────────────────
insert into app.server_secrets (name, value)
values ('source_asset_signing', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
on conflict (name) do nothing;

-- 서명 = HMAC-SHA256(비밀값, 용도|메시지|서명시각ms). 서명 시각은 ±5분 안(clock_timestamp 를 쓰므로 VOLATILE)
create or replace function app.assert_source_signature(p_purpose text, p_message text, p_signed_at bigint, p_signature text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  secret text;
begin
  select s.value into secret from app.server_secrets s where s.name = 'source_asset_signing';
  if secret is null then
    raise exception 'NOT_CONFIGURED: 자료 파일 올리기 서명 키가 DB 에 없습니다' using errcode = 'P0001';
  end if;
  if p_signed_at is null or abs(floor(extract(epoch from clock_timestamp()) * 1000) - p_signed_at) > 300000
     or p_signature is null
     or lower(p_signature) <> app.hmac_sha256(convert_to(secret, 'UTF8'), convert_to(p_purpose || '|' || p_message || '|' || p_signed_at::text, 'UTF8')) then
    raise exception 'BAD_SIGNATURE: 서버 서명이 맞지 않습니다' using errcode = '42501';
  end if;
end $$;
revoke execute on function app.assert_source_signature(text, text, bigint, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC
-- ─────────────────────────────────────────────
-- 4-1) 예약(서버 서명). 메시지: 고객id(없으면 빈칸)|프로젝트id(없으면 빈칸)|크기|형식|파일이름
--   붙는 곳 규칙은 앱 resolveOwner 와 같다: 프로젝트를 주면 그 프로젝트의 고객으로, 고객을 함께 주면 같아야 한다
create or replace function public.reserve_source_upload(
  p_client_id  uuid,
  p_project_id uuid,
  p_file_name  text,
  p_size       bigint,
  p_mime       text,
  p_signed_at  bigint,
  p_signature  text
) returns table (upload_id uuid, object_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
  cid uuid := p_client_id;
  pc  uuid;
  u   uuid := gen_random_uuid();
  k   text;
  ex  timestamptz := now() + interval '1 hour';
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_source_signature('source_reserve',
    concat_ws('|', coalesce(p_client_id::text, ''), coalesce(p_project_id::text, ''), p_size::text, p_mime, p_file_name), p_signed_at, p_signature);
  select w.id into ws from public.workspaces w where w.owner_user_id = uid;
  if ws is null then
    raise exception 'NOT_FOUND: 업무실을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_project_id is not null then
    select p.client_id into pc from public.projects p where p.id = p_project_id and p.workspace_id = ws;
    if not found then
      raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
    end if;
    if p_client_id is not null and p_client_id is distinct from pc then
      raise exception 'VALIDATION: 다른 고객의 프로젝트에는 자료를 붙일 수 없습니다' using errcode = '22023';
    end if;
    cid := pc;
  elsif p_client_id is not null then
    if not exists (select 1 from public.clients c where c.id = p_client_id and c.workspace_id = ws) then
      raise exception 'NOT_FOUND: 고객을 찾을 수 없습니다' using errcode = 'P0002';
    end if;
  else
    raise exception 'VALIDATION: 자료를 붙일 고객이나 프로젝트를 정해 주세요' using errcode = '22023';
  end if;
  if app.source_mime_ext(p_mime) is null then
    raise exception 'UNSUPPORTED_TYPE: PDF, PNG, JPEG, TXT 파일만 올릴 수 있습니다' using errcode = '22023';
  end if;
  if p_size is null or p_size < 1 then
    raise exception 'EMPTY: 빈 파일은 올릴 수 없습니다' using errcode = '22023';
  end if;
  if p_size > 10485760 then
    raise exception 'TOO_LARGE: 파일은 10MB까지 올릴 수 있습니다' using errcode = '22023';
  end if;
  if not app.source_file_name_ok(p_file_name, p_mime) then
    raise exception 'TYPE_MISMATCH: 파일 이름(확장자)이 형식과 맞지 않습니다' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(32001, hashtext(ws::text)); -- 이름공간 32001(자료 업로드 예약) + 업무실
  if (select count(*) from public.source_asset_uploads x where x.workspace_id = ws and x.status = 'pending' and x.expires_at > now()) >= 20 then
    raise exception 'LIMIT_REACHED: 진행 중인 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  k := ws::text || '/' || u::text || '/original.' || app.source_mime_ext(p_mime);
  insert into public.source_asset_uploads (id, workspace_id, client_id, project_id, object_key, file_name, mime, bytes, expires_at, created_by)
  values (u, ws, cid, p_project_id, k, p_file_name, p_mime, p_size, ex, uid);
  return query select u, k, ex;
end $$;
revoke execute on function public.reserve_source_upload(uuid, uuid, text, bigint, text, bigint, text) from public, anon;
grant execute on function public.reserve_source_upload(uuid, uuid, text, bigint, text, bigint, text) to authenticated;

-- 4-2) 예약 닫기(서버 검사에서 떨어짐, 서버 서명). 메시지: 예약id|이유
create or replace function public.reject_source_upload(p_upload_id uuid, p_reason text, p_signed_at bigint, p_signature text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.source_asset_uploads%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_source_signature('source_reject', concat_ws('|', p_upload_id::text, p_reason), p_signed_at, p_signature);
  select x.* into u from public.source_asset_uploads x where x.id = p_upload_id and x.created_by = auth.uid() and x.status = 'pending' for update of x;
  if not found then
    raise exception 'NOT_FOUND: 업로드 예약을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'EMPTY', 'MISSING') then
    raise exception 'VALIDATION: 알 수 없는 거절 이유입니다' using errcode = '22023';
  end if;
  update public.source_asset_uploads set status = 'rejected', reject_reason = p_reason, decided_at = now() where id = u.id;
end $$;
revoke execute on function public.reject_source_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.reject_source_upload(uuid, text, bigint, text) to authenticated;

-- 4-3) 확정(서버 서명). 메시지: 예약id|sha256 — sha256 은 앱 서버가 저장소에서 받은 바이트로 잰 값.
--   저장소 객체가 있고 metadata 크기·형식(매개변수 앞부분)이 예약과 같아야 source_assets(stored) 를 만든다. 자료 id = 예약 id
create or replace function public.confirm_source_upload(p_upload_id uuid, p_sha256 text, p_signed_at bigint, p_signature text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  u  public.source_asset_uploads%rowtype;
  md jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_source_signature('source_confirm', concat_ws('|', p_upload_id::text, p_sha256), p_signed_at, p_signature);
  select x.* into u
    from public.source_asset_uploads x
   where x.id = p_upload_id and x.created_by = auth.uid()
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 업로드 예약을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if u.status <> 'pending' then
    raise exception 'INVALID_TRANSITION: 이미 끝난 업로드입니다' using errcode = 'P0001';
  end if;
  if u.expires_at <= now() then
    raise exception 'UPLOAD_EXPIRED: 올리기 유효 시간이 지났습니다' using errcode = 'P0001';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 파일 확인값이 올바르지 않습니다' using errcode = '22023';
  end if;
  select o.metadata into md from storage.objects o where o.bucket_id = 'source-assets' and o.name = u.object_key;
  if not found then
    raise exception 'UPLOAD_MISSING: 저장소에 올린 파일이 없습니다' using errcode = 'P0001';
  end if;
  -- 칸이 없으면(NULL) is distinct from 이 참이 되어 거절된다. 형식은 "text/plain;charset=…" 같은 매개변수를 떼고 본다
  if (md ->> 'size') is distinct from u.bytes::text
     or btrim(split_part(md ->> 'mimetype', ';', 1)) is distinct from u.mime then
    raise exception 'TYPE_MISMATCH: 올린 파일의 크기·형식이 예약과 다릅니다' using errcode = 'P0001';
  end if;
  insert into public.source_assets (id, workspace_id, client_id, project_id, kind, file_name, object_key, mime, bytes, checksum_sha256, upload_status)
  values (u.id, u.workspace_id, u.client_id, u.project_id, 'file', u.file_name, u.object_key, u.mime, u.bytes, p_sha256, 'stored');
  update public.source_asset_uploads set status = 'confirmed', decided_at = now() where id = u.id;
  return u.id;
end $$;
revoke execute on function public.confirm_source_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.confirm_source_upload(uuid, text, bigint, text) to authenticated;

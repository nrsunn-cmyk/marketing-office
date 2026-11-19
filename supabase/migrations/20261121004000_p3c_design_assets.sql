-- P3C-BACKEND-IMPL-01 디자인 자산(P3-c) 서버. 설계: Plan/Claude-Backend-20261120/P3C-BACKEND-01-DESIGN.md (Master 수락, 8절 결정)
-- 범위: 확정(ready)·보관 안 된 제작 브리프(포함 산출물에 design_assets)를 바탕으로 로고·이미지·색상·글꼴 파일을 판(version) 단위로 남긴다.
--   AI 호출 없음. 앱 내 생성(app_generated)은 칸만 두고 RPC 가 거절한다(Q16).
--
-- 업로드 경로(Master 결정 ①, 사실 확인): Vercel 함수 요청 본문은 4.5MB 까지라(초과 413 FUNCTION_PAYLOAD_TOO_LARGE) 앱 서버를 거쳐 10MB 를 받을 수 없다.
--   그래서 브라우저가 저장소에 직접 올리고, 앞뒤를 서버 서명 RPC 로 묶는다.
--     1) reserve_design_asset_upload(서버 서명): 경로를 DB 가 만든다 <업무실>/design-assets/<upload_id>.<확장자>. 예약 1시간.
--     2) 브라우저 → 저장소: 저장소 insert 정책은 "진행 중·만료 전·내 예약 경로"만 허용. update·delete 정책 없음(덮어쓰기·지우기 불가).
--     3) 앱 서버가 객체를 내려받아 앞 바이트 형식·SVG 위험 요소를 검사하고 sha256 을 잰다(브라우저 주장은 믿지 않는다).
--     4) create_design_asset / replace_design_asset_file(서버 서명): 저장소 객체가 있고 metadata size·mimetype 이 예약과 같아야 판을 만든다.
--        검사에서 떨어지면 reject_design_asset_upload(서버 서명)로 예약을 닫는다.
--   서명 비밀값은 app.server_secrets 'design_asset_signing'(이 migration 이 무작위로 만듦) = 앱 서버 환경 변수 DESIGN_ASSET_SIGNING_KEY.
--
-- 바뀌는 것
--   1) 버킷 design-assets(비공개, 10MB, 형식 9종)와 저장소 정책 2개(select 본인 업무실, insert 예약 경로만)
--   2) design_assets(메타), design_asset_versions(판, 추가 전용), design_asset_uploads(예약, 사용자 읽기 없음), design_asset_usages(사용처)
--   3) 정의자 RPC 10개, 감사 1행(entity_type 'design_asset', 파일 이름·메모 본문 없음)
-- 바뀌지 않는 것: 기존 표·RPC·버킷(source-assets).
-- 잠금: 예약은 브리프 FOR SHARE → advisory(31002, 업무실). 만들기는 예약 FOR UPDATE → 브리프 FOR SHARE → advisory(31001, 프로젝트).
--       그 밖에는 자산 한 행 FOR UPDATE(교체는 그다음 예약 행). 업무실 용량 상한은 app.design_asset_quota_bytes() 한 곳(주인님 결정 대기).

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 업무실 용량 상한(모든 판의 서로 다른 파일 + 진행 중 예약 합). 추천값 500MB, 운영 반영 때 주인님 확인(설계 7절 ②)
create or replace function app.design_asset_quota_bytes() returns bigint
language sql immutable set search_path = '' as $$ select 524288000::bigint $$;
revoke execute on function app.design_asset_quota_bytes() from public, anon;

-- 분류별 허용 형식(Q3): 로고 SVG·PNG / 이미지 PNG·JPEG·WEBP / 글꼴 WOFF2·TTF·OTF / 색상 JSON·CSS
create or replace function app.design_kind_mime_ok(p_kind text, p_mime text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(case p_kind
    when 'logo'  then p_mime in ('image/svg+xml', 'image/png')
    when 'image' then p_mime in ('image/png', 'image/jpeg', 'image/webp')
    when 'font'  then p_mime in ('font/woff2', 'font/ttf', 'font/otf')
    when 'color' then p_mime in ('application/json', 'text/css')
    else false end, false)
$$;
revoke execute on function app.design_kind_mime_ok(text, text) from public, anon;

-- 분류별 파일 크기 상한(색상 1MB, 나머지 10MB)
create or replace function app.design_kind_max_bytes(p_kind text) returns bigint
language sql immutable set search_path = '' as $$
  select case when p_kind = 'color' then 1048576::bigint else 10485760::bigint end
$$;
revoke execute on function app.design_kind_max_bytes(text) from public, anon;

-- 형식 → 저장 확장자(경로용)
create or replace function app.design_mime_ext(p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case p_mime
    when 'image/svg+xml' then 'svg' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp'
    when 'font/woff2' then 'woff2' when 'font/ttf' then 'ttf' when 'font/otf' then 'otf'
    when 'application/json' then 'json' when 'text/css' then 'css' end
$$;
revoke execute on function app.design_mime_ext(text) from public, anon;

-- 파일 이름: 1~200자, 앞뒤 공백 없음, 경로 구분자·'..'·제어 문자·글자 방향 바꾸기 문자(RTL 덮어쓰기 등, Tester CS9) 없음,
--   확장자가 형식과 맞음(jpg/jpeg 둘 다). 다중 확장자 logo.svg.html 은 마지막 확장자로 판정되어 거절
create or replace function app.design_file_name_ok(p_name text, p_mime text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
       char_length(p_name) between 1 and 200
       and p_name = btrim(p_name)
       and p_name !~ '[\\/]'
       and p_name !~ '[[:cntrl:]]'
       and strpos(p_name, '..') = 0
       and p_name !~ '[\u200e\u200f\u202a-\u202e\u2066-\u2069]'
       and lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = any (case p_mime
             when 'image/jpeg' then array['jpg', 'jpeg']
             else array[app.design_mime_ext(p_mime)] end), false)
$$;
revoke execute on function app.design_file_name_ok(text, text) from public, anon;

-- 글 칸(앞뒤 공백 없음, 길이). null 허용 여부는 부른 쪽이 정한다
create or replace function app.design_text_ok(p text, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(char_length(p) between 1 and p_max and p = btrim(p), false)
$$;
revoke execute on function app.design_text_ok(text, integer) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 저장소 버킷
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-assets', 'design-assets', false, 10485760,
        array['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'font/woff2', 'font/ttf', 'font/otf', 'application/json', 'text/css'])
on conflict (id) do nothing;

-- ─────────────────────────────────────────────
-- 2) 표
-- ─────────────────────────────────────────────
create table public.design_assets (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null,
  project_id            uuid not null,
  production_brief_id   uuid not null,
  source_brief_revision integer not null check (source_brief_revision > 0),
  title                 text not null check (app.design_text_ok(title, 100)),
  asset_kind            text not null check (asset_kind in ('logo', 'image', 'color', 'font')),
  origin_type           text not null check (origin_type in ('external_upload', 'app_generated')),
  license_note          text check (license_note is null or app.design_text_ok(license_note, 500)),
  status                text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  current_version_no    integer not null check (current_version_no between 1 and 30),
  archived_at           timestamptz,
  revision              integer not null default 1,
  created_by            uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  unique (workspace_id, id),
  -- 뒤 단계(P3-d·e asset_ids, P3-f 검수)가 같은 프로젝트의 자산만 가리킬 자리
  unique (project_id, id)
);
create index design_assets_project on public.design_assets (project_id, created_at);
create index design_assets_brief on public.design_assets (production_brief_id);

create table public.design_asset_versions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  asset_id                 uuid not null,
  version_no               integer not null check (version_no between 1 and 30),
  kind                     text not null check (kind in ('create', 'replace', 'restore', 'rebase')),
  storage_key              text not null,
  file_name                text not null,
  file_size_bytes          bigint not null check (file_size_bytes between 1 and 10485760),
  mime_type                text not null check (app.design_mime_ext(mime_type) is not null),
  sha256                   text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  change_note              text check (change_note is null or app.design_text_ok(change_note, 300)),
  source_brief_revision    integer not null check (source_brief_revision > 0),
  restored_from_version_no integer check (restored_from_version_no is null or restored_from_version_no > 0),
  created_by               uuid not null references auth.users (id),
  created_at               timestamptz not null default now(),
  check (app.design_file_name_ok(file_name, mime_type)),
  check ((kind = 'restore') = (restored_from_version_no is not null)),
  foreign key (workspace_id, asset_id) references public.design_assets (workspace_id, id),
  unique (asset_id, version_no),
  unique (asset_id, id)
);
create index design_asset_versions_ws on public.design_asset_versions (workspace_id, storage_key);

alter table public.design_assets
  add constraint design_assets_current_version_fkey foreign key (id, current_version_no)
  references public.design_asset_versions (asset_id, version_no) deferrable initially deferred;

-- 업로드 예약. 사용자는 읽을 수 없다(경로를 미리 알 수 없게). 정의자 RPC·저장소 정책 함수만 본다
create table public.design_asset_uploads (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  project_id          uuid not null,
  production_brief_id uuid not null,
  asset_id            uuid,
  asset_kind          text not null check (asset_kind in ('logo', 'image', 'color', 'font')),
  storage_key         text not null unique,
  file_name           text not null,
  file_size_bytes     bigint not null check (file_size_bytes >= 1 and file_size_bytes <= app.design_kind_max_bytes(asset_kind)),
  mime_type           text not null check (app.design_kind_mime_ok(asset_kind, mime_type)),
  status              text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  reject_reason       text check (reject_reason in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'UNSAFE_SVG', 'MISSING')),
  expires_at          timestamptz not null,
  created_by          uuid not null references auth.users (id),
  created_at          timestamptz not null default now(),
  decided_at          timestamptz,
  check (app.design_file_name_ok(file_name, mime_type)),
  check ((status = 'rejected') = (reject_reason is not null)),
  check ((status = 'pending') = (decided_at is null)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  foreign key (project_id, asset_id) references public.design_assets (project_id, id)
);
create index design_asset_uploads_pending on public.design_asset_uploads (workspace_id, expires_at) where status = 'pending';

-- 사용처: 같은 프로젝트의 홈페이지 문서 섹션(섹션 id 는 판 JSON 안이라 FK 대신 저장 때 확인, 읽을 때 '사라진 섹션' 계산)
create table public.design_asset_usages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  project_id      uuid not null,
  asset_id        uuid not null,
  web_copy_doc_id uuid not null,
  section_id      text not null check (section_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, asset_id) references public.design_assets (project_id, id),
  foreign key (project_id, web_copy_doc_id) references public.web_copy_docs (project_id, id),
  unique (asset_id, web_copy_doc_id, section_id)
);
create index design_asset_usages_doc on public.design_asset_usages (web_copy_doc_id);

create trigger design_assets_guard before update on public.design_assets
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'production_brief_id', 'asset_kind', 'origin_type', 'created_by', 'created_at');

-- 보관한 자산은 어떤 칸도 바꿀 수 없다(보관 되돌리기 포함)
create or replace function app.design_asset_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 디자인 자산은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.design_asset_frozen() from public, anon, authenticated;
create trigger design_assets_frozen before update on public.design_assets
  for each row execute function app.design_asset_frozen();

create trigger design_asset_versions_append_only before update or delete on public.design_asset_versions
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 3) RLS·권한: 메타·판·사용처는 select 만 본인 업무실, 예약은 읽기도 없음. 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.design_assets         enable row level security;
alter table public.design_asset_versions enable row level security;
alter table public.design_asset_uploads  enable row level security;
alter table public.design_asset_usages   enable row level security;
create policy design_assets_select         on public.design_assets         for select to authenticated using (app.owns_workspace(workspace_id));
create policy design_asset_versions_select on public.design_asset_versions for select to authenticated using (app.owns_workspace(workspace_id));
create policy design_asset_usages_select   on public.design_asset_usages   for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.design_assets, public.design_asset_versions, public.design_asset_usages, public.design_asset_uploads from anon;
revoke all on public.design_asset_uploads from authenticated;
revoke insert, update, delete, truncate on public.design_assets, public.design_asset_versions, public.design_asset_usages from authenticated;

-- 저장소 insert 정책: 진행 중·만료 전·내가 만든·내 업무실 예약의 경로만(정의자: 예약 표는 사용자가 못 읽으므로)
create or replace function app.design_upload_key_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.design_asset_uploads u join public.workspaces w on w.id = u.workspace_id
     where u.storage_key = p_name and u.status = 'pending' and u.expires_at > now()
       and u.created_by = auth.uid() and w.owner_user_id = auth.uid())
$$;
revoke execute on function app.design_upload_key_ok(text) from public, anon;
grant execute on function app.design_upload_key_ok(text) to authenticated;

create policy design_assets_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'design-assets' and app.owns_storage_path(name));
create policy design_assets_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'design-assets' and app.design_upload_key_ok(name));

-- ─────────────────────────────────────────────
-- 4) 서버 서명(DEC-08 과 같은 HMAC, 비밀값만 따로)
-- ─────────────────────────────────────────────
insert into app.server_secrets (name, value)
values ('design_asset_signing', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'))
on conflict (name) do nothing;

-- 서명 = HMAC-SHA256(비밀값, 용도|메시지|서명시각ms). 서명 시각은 ±5분 안(clock_timestamp 를 쓰므로 VOLATILE)
create or replace function app.assert_design_signature(p_purpose text, p_message text, p_signed_at bigint, p_signature text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  secret text;
begin
  select s.value into secret from app.server_secrets s where s.name = 'design_asset_signing';
  if secret is null then
    raise exception 'NOT_CONFIGURED: 디자인 자산 업로드 서명 키가 DB 에 없습니다' using errcode = 'P0001';
  end if;
  if p_signed_at is null or abs(floor(extract(epoch from clock_timestamp()) * 1000) - p_signed_at) > 300000
     or p_signature is null
     or lower(p_signature) <> app.hmac_sha256(convert_to(secret, 'UTF8'), convert_to(p_purpose || '|' || p_message || '|' || p_signed_at::text, 'UTF8')) then
    raise exception 'BAD_SIGNATURE: 서버 서명이 맞지 않습니다' using errcode = '42501';
  end if;
end $$;
revoke execute on function app.assert_design_signature(text, text, bigint, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 5) 도우미 (정의자 RPC 안에서만)
-- ─────────────────────────────────────────────
create or replace function app.design_asset_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'design_asset', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.design_asset_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 업무실이 쓰는 용량: 판이 가리키는 서로 다른 파일 + 진행 중·만료 전 예약
create or replace function app.design_asset_used_bytes(p_ws uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce((select sum(s) from (select distinct on (v.storage_key) v.file_size_bytes as s
                                         from public.design_asset_versions v where v.workspace_id = p_ws order by v.storage_key) t), 0)
       + coalesce((select sum(u.file_size_bytes) from public.design_asset_uploads u
                    where u.workspace_id = p_ws and u.status = 'pending' and u.expires_at > now()), 0)
$$;
revoke execute on function app.design_asset_used_bytes(uuid) from public, anon, authenticated;

create or replace function app.lock_own_design_asset(p_asset_id uuid) returns public.design_assets
language plpgsql set search_path = '' as $$
declare
  a public.design_assets%rowtype;
begin
  select x.* into a
    from public.design_assets x
   where x.id = p_asset_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 디자인 자산을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return a;
end $$;
revoke execute on function app.lock_own_design_asset(uuid) from public, anon, authenticated;

-- 쓸 수 있는지: 자산 보관 아님 + 프로젝트 보관 아님 + 바탕 전략 작업 취소 아님
create or replace function app.assert_design_asset_open(p_asset public.design_assets) returns void
language plpgsql stable set search_path = '' as $$
declare
  sa uuid;
begin
  if p_asset.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 디자인 자산은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  select b.strategy_artifact_id into sa from public.production_briefs b where b.id = p_asset.production_brief_id;
  perform app.assert_production_open(p_asset.project_id, sa);
end $$;
revoke execute on function app.assert_design_asset_open(public.design_assets) from public, anon, authenticated;

-- 예약 하나를 본인 것만 잠근다. 진행 중이 아니면 INVALID_TRANSITION, 만료면 UPLOAD_EXPIRED
create or replace function app.lock_own_design_upload(p_upload_id uuid) returns public.design_asset_uploads
language plpgsql set search_path = '' as $$
declare
  u public.design_asset_uploads%rowtype;
begin
  select x.* into u
    from public.design_asset_uploads x
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
    raise exception 'UPLOAD_EXPIRED: 올리기 링크 유효 시간이 지났습니다' using errcode = 'P0001';
  end if;
  return u;
end $$;
revoke execute on function app.lock_own_design_upload(uuid) from public, anon, authenticated;

-- 저장소에 예약 경로의 객체가 있고 크기·형식이 예약과 같은지. 다르면 거절(판을 만들지 않는다)
create or replace function app.assert_design_object_matches(p_upload public.design_asset_uploads) returns void
language plpgsql stable set search_path = '' as $$
declare
  md jsonb;
begin
  select o.metadata into md from storage.objects o where o.bucket_id = 'design-assets' and o.name = p_upload.storage_key;
  if not found then
    raise exception 'UPLOAD_MISSING: 저장소에 올린 파일이 없습니다' using errcode = 'P0001';
  end if;
  -- 칸이 없으면(NULL) is distinct from 이 참이 되어 거절된다
  if (md ->> 'size') is distinct from p_upload.file_size_bytes::text
     or (md ->> 'mimetype') is distinct from p_upload.mime_type then
    raise exception 'TYPE_MISMATCH: 올린 파일의 크기·형식이 예약과 다릅니다' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function app.assert_design_object_matches(public.design_asset_uploads) from public, anon, authenticated;

-- 새 판 넣기 + 자산 현재 판 바꾸기(판 30 한도). 감사는 부른 쪽이 남긴다
create or replace function app.design_asset_add_version(p_asset public.design_assets, p_kind text, p_key text, p_file_name text, p_size bigint,
                                                         p_mime text, p_sha text, p_note text, p_brief_revision integer, p_restored_from integer) returns integer
language plpgsql set search_path = '' as $$
declare
  n integer := p_asset.current_version_no + 1;
  r integer;
begin
  if n > 30 then
    raise exception 'LIMIT_REACHED: 한 자산의 판은 30개까지입니다. 자산을 보관하고 새로 올려 주세요' using errcode = 'P0001';
  end if;
  insert into public.design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256,
                                            change_note, source_brief_revision, restored_from_version_no, created_by)
  values (p_asset.workspace_id, p_asset.id, n, p_kind, p_key, p_file_name, p_size, p_mime, p_sha, p_note, p_brief_revision, p_restored_from, auth.uid());
  update public.design_assets set current_version_no = n, source_brief_revision = p_brief_revision
   where id = p_asset.id returning revision into r;
  return r;
end $$;
revoke execute on function app.design_asset_add_version(public.design_assets, text, text, text, bigint, text, text, text, integer, integer) from public, anon, authenticated;

-- 바탕 브리프를 본인 것만 FOR SHARE 로 읽고 "자산을 올릴 수 있는 브리프"인지 확인
create or replace function app.share_design_brief(p_brief_id uuid) returns public.production_briefs
language plpgsql set search_path = '' as $$
declare
  b public.production_briefs%rowtype;
begin
  select x.* into b
    from public.production_briefs x
   where x.id = p_brief_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for share of x;
  if not found then
    raise exception 'NOT_FOUND: 제작 브리프를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프로는 디자인 자산을 올릴 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 확정한 제작 브리프로만 디자인 자산을 올릴 수 있습니다' using errcode = 'P0001';
  end if;
  if not ('design_assets' = any(b.deliverable_types)) then
    raise exception 'INVALID_TRANSITION: 이 제작 브리프의 포함 산출물에 디자인 자산이 없습니다' using errcode = 'P0001';
  end if;
  return b;
end $$;
revoke execute on function app.share_design_brief(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 6) RPC
-- ─────────────────────────────────────────────
-- 6-1) 업로드 예약(서버 서명). 서명 메시지: 브리프id|자산id(없으면 빈칸)|분류|크기|형식|파일이름 (+ |서명시각)
create or replace function public.reserve_design_asset_upload(
  p_production_brief_id uuid,
  p_asset_id            uuid,
  p_kind                text,
  p_file_name           text,
  p_size                bigint,
  p_mime                text,
  p_signed_at           bigint,
  p_signature           text
) returns table (upload_id uuid, storage_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  b   public.production_briefs%rowtype;
  a   public.design_assets%rowtype;
  u   uuid := gen_random_uuid();
  k   text;
  ex  timestamptz := now() + interval '1 hour';
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('design_reserve',
    concat_ws('|', p_production_brief_id::text, coalesce(p_asset_id::text, ''), p_kind, p_size::text, p_mime, p_file_name), p_signed_at, p_signature);
  -- 교체(자산 있음)는 자산이 열려 있으면 된다(브리프가 작성 중·보관이어도 지난 기준 그대로 고칠 수 있음, P3-b 와 같음).
  -- 새 자산은 바탕 브리프가 확정·보관 안 됨·design_assets 포함이어야 한다
  if p_asset_id is not null then
    select x.* into a from public.design_assets x
     where x.id = p_asset_id and x.production_brief_id = p_production_brief_id
       and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
    if not found then
      raise exception 'NOT_FOUND: 디자인 자산을 찾을 수 없습니다' using errcode = 'P0002';
    end if;
    perform app.assert_design_asset_open(a);
    select x.* into b from public.production_briefs x where x.id = a.production_brief_id;
  else
    b := app.share_design_brief(p_production_brief_id);
  end if;
  if p_kind is null or p_kind not in ('logo', 'image', 'color', 'font') then
    raise exception 'VALIDATION: 알 수 없는 자산 분류입니다' using errcode = '22023';
  end if;
  if not app.design_kind_mime_ok(p_kind, p_mime) then
    raise exception 'UNSUPPORTED_TYPE: 이 분류에 허용되지 않는 파일 형식입니다' using errcode = '22023';
  end if;
  if p_size is null or p_size < 1 or p_size > app.design_kind_max_bytes(p_kind) then
    raise exception 'TOO_LARGE: 파일 크기가 한도를 넘었습니다' using errcode = '22023';
  end if;
  if not app.design_file_name_ok(p_file_name, p_mime) then
    raise exception 'TYPE_MISMATCH: 파일 이름(확장자)이 형식과 맞지 않거나 쓸 수 없는 글자가 있습니다' using errcode = '22023';
  end if;
  if p_asset_id is not null then
    if a.asset_kind <> p_kind then
      raise exception 'VALIDATION: 같은 분류의 파일로만 교체할 수 있습니다' using errcode = '22023';
    end if;
    if a.current_version_no >= 30 then
      raise exception 'LIMIT_REACHED: 한 자산의 판은 30개까지입니다. 자산을 보관하고 새로 올려 주세요' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.design_assets x where x.project_id = b.project_id) >= 50 then
    raise exception 'LIMIT_REACHED: 디자인 자산은 프로젝트당 50개까지입니다(보관 포함)' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(31002, hashtext(b.workspace_id::text)); -- 이름공간 31002(업무실 예약·용량) + 업무실
  if (select count(*) from public.design_asset_uploads x where x.workspace_id = b.workspace_id and x.status = 'pending' and x.expires_at > now()) >= 20 then
    raise exception 'LIMIT_REACHED: 진행 중인 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  if app.design_asset_used_bytes(b.workspace_id) + p_size > app.design_asset_quota_bytes() then
    raise exception 'QUOTA_EXCEEDED: 업무실 디자인 자산 저장 용량을 넘습니다. 쓰지 않는 자산을 정리한 뒤 다시 올려 주세요' using errcode = 'P0001';
  end if;
  k := b.workspace_id::text || '/design-assets/' || u::text || '.' || app.design_mime_ext(p_mime);
  insert into public.design_asset_uploads (id, workspace_id, project_id, production_brief_id, asset_id, asset_kind, storage_key, file_name,
                                           file_size_bytes, mime_type, expires_at, created_by)
  values (u, b.workspace_id, b.project_id, b.id, p_asset_id, p_kind, k, p_file_name, p_size, p_mime, ex, uid);
  return query select u, k, ex;
end $$;
revoke execute on function public.reserve_design_asset_upload(uuid, uuid, text, text, bigint, text, bigint, text) from public, anon;
grant execute on function public.reserve_design_asset_upload(uuid, uuid, text, text, bigint, text, bigint, text) to authenticated;

-- 6-2) 예약 닫기(서버 검사에서 떨어짐, 서버 서명). 메시지: 예약id|이유
create or replace function public.reject_design_asset_upload(p_upload_id uuid, p_reason text, p_signed_at bigint, p_signature text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.design_asset_uploads%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('design_reject', concat_ws('|', p_upload_id::text, p_reason), p_signed_at, p_signature);
  select x.* into u from public.design_asset_uploads x
   where x.id = p_upload_id and x.created_by = auth.uid() and x.status = 'pending' for update of x;
  if not found then
    raise exception 'NOT_FOUND: 업로드 예약을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'UNSAFE_SVG', 'MISSING') then
    raise exception 'VALIDATION: 알 수 없는 거절 이유입니다' using errcode = '22023';
  end if;
  update public.design_asset_uploads set status = 'rejected', reject_reason = p_reason, decided_at = now() where id = u.id;
end $$;
revoke execute on function public.reject_design_asset_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.reject_design_asset_upload(uuid, text, bigint, text) to authenticated;

-- 6-3) 만들기(확정, 서버 서명). 메시지: 예약id|sha256 — sha256 은 앱 서버가 저장소에서 받은 바이트로 잰 값
create or replace function public.create_design_asset(
  p_upload_id    uuid,
  p_title        text,
  p_license_note text,
  p_origin_type  text,
  p_sha256       text,
  p_signed_at    bigint,
  p_signature    text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  u    public.design_asset_uploads%rowtype;
  b    public.production_briefs%rowtype;
  a_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('design_confirm', concat_ws('|', p_upload_id::text, p_sha256), p_signed_at, p_signature);
  u := app.lock_own_design_upload(p_upload_id);
  if u.asset_id is not null then
    raise exception 'VALIDATION: 교체용 업로드입니다' using errcode = '22023';
  end if;
  if p_origin_type is distinct from 'external_upload' then
    raise exception 'VALIDATION: 앱 내 생성은 아직 지원하지 않습니다' using errcode = '22023';
  end if;
  if not app.design_text_ok(p_title, 100) then
    raise exception 'VALIDATION: 자산 이름은 1~100자로 입력해 주세요' using errcode = '22023';
  end if;
  if p_license_note is not null and not app.design_text_ok(p_license_note, 500) then
    raise exception 'VALIDATION: 라이선스·주의 메모는 500자까지입니다' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 파일 확인값이 올바르지 않습니다' using errcode = '22023';
  end if;
  b := app.share_design_brief(u.production_brief_id);
  perform pg_advisory_xact_lock(31001, hashtext(b.project_id::text)); -- 이름공간 31001(프로젝트 자산 50) + 프로젝트
  if (select count(*) from public.design_assets x where x.project_id = b.project_id) >= 50 then
    raise exception 'LIMIT_REACHED: 디자인 자산은 프로젝트당 50개까지입니다(보관 포함)' using errcode = 'P0001';
  end if;
  perform app.assert_design_object_matches(u);

  insert into public.design_assets (workspace_id, project_id, production_brief_id, source_brief_revision, title, asset_kind, origin_type,
                                    license_note, status, current_version_no, created_by)
  values (b.workspace_id, b.project_id, b.id, b.revision, p_title, u.asset_kind, 'external_upload', p_license_note, 'drafting', 1, uid)
  returning id into a_id;
  insert into public.design_asset_versions (workspace_id, asset_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, sha256,
                                            source_brief_revision, created_by)
  values (b.workspace_id, a_id, 1, 'create', u.storage_key, u.file_name, u.file_size_bytes, u.mime_type, p_sha256, b.revision, uid);
  update public.design_asset_uploads set status = 'confirmed', decided_at = now() where id = u.id;
  perform app.design_asset_audit(b.workspace_id, a_id, 'design_asset_create', 1,
                                 jsonb_build_object('production_brief_id', b.id, 'brief_revision', b.revision, 'version_no', 1,
                                                    'asset_kind', u.asset_kind, 'mime_type', u.mime_type, 'file_size_bytes', u.file_size_bytes));
  return a_id;
end $$;
revoke execute on function public.create_design_asset(uuid, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.create_design_asset(uuid, text, text, text, text, bigint, text) to authenticated;

-- 6-4) 파일 교체(확정, 서버 서명). 메시지: 예약id|sha256. 같은 분류만, 새 판(kind replace)
create or replace function public.replace_design_asset_file(
  p_asset_id          uuid,
  p_expected_revision integer,
  p_upload_id         uuid,
  p_change_note       text,
  p_sha256            text,
  p_signed_at         bigint,
  p_signature         text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.design_assets%rowtype;
  u public.design_asset_uploads%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('design_confirm', concat_ws('|', p_upload_id::text, p_sha256), p_signed_at, p_signature);
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  u := app.lock_own_design_upload(p_upload_id);
  if u.asset_id is distinct from a.id then
    raise exception 'VALIDATION: 이 자산의 교체용 업로드가 아닙니다' using errcode = '22023';
  end if;
  if p_change_note is not null and not app.design_text_ok(p_change_note, 300) then
    raise exception 'VALIDATION: 바꾼 내용 메모는 300자까지입니다' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION: 파일 확인값이 올바르지 않습니다' using errcode = '22023';
  end if;
  perform app.assert_design_object_matches(u);
  r := app.design_asset_add_version(a, 'replace', u.storage_key, u.file_name, u.file_size_bytes, u.mime_type, p_sha256, p_change_note,
                                    a.source_brief_revision, null);
  update public.design_asset_uploads set status = 'confirmed', decided_at = now() where id = u.id;
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_replace', r,
                                 jsonb_build_object('version_no', a.current_version_no + 1, 'mime_type', u.mime_type, 'file_size_bytes', u.file_size_bytes));
  return r;
end $$;
revoke execute on function public.replace_design_asset_file(uuid, integer, uuid, text, text, bigint, text) from public, anon;
grant execute on function public.replace_design_asset_file(uuid, integer, uuid, text, text, bigint, text) to authenticated;

-- 6-5) 정보 저장(이름·라이선스 메모·상태). 판은 늘지 않는다. 바뀐 게 없으면 거절
create or replace function public.update_design_asset(p_asset_id uuid, p_expected_revision integer, p_title text, p_license_note text, p_status text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.design_assets%rowtype;
  r integer;
  changed text[] := '{}'::text[];
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  if not app.design_text_ok(p_title, 100) then
    raise exception 'VALIDATION: 자산 이름은 1~100자로 입력해 주세요' using errcode = '22023';
  end if;
  if p_license_note is not null and not app.design_text_ok(p_license_note, 500) then
    raise exception 'VALIDATION: 라이선스·주의 메모는 500자까지입니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
  if p_title is distinct from a.title then changed := array_append(changed, 'title'); end if;
  if p_license_note is distinct from a.license_note then changed := array_append(changed, 'license_note'); end if;
  if p_status is distinct from a.status then changed := array_append(changed, 'status'); end if;
  if cardinality(changed) = 0 then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  update public.design_assets set title = p_title, license_note = p_license_note, status = p_status where id = a.id returning revision into r;
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_update', r,
                                 jsonb_build_object('changed', to_jsonb(changed), 'status', p_status));
  return r;
end $$;
revoke execute on function public.update_design_asset(uuid, integer, text, text, text) from public, anon;
grant execute on function public.update_design_asset(uuid, integer, text, text, text) to authenticated;

-- 6-6) 되돌리기: 고른 판의 파일로 새 판(같은 storage_key 를 다시 가리킨다, 파일 복사 없음). 지금 파일과 같으면 거절
create or replace function public.restore_design_asset_version(p_asset_id uuid, p_expected_revision integer, p_version_no integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a   public.design_assets%rowtype;
  v   public.design_asset_versions%rowtype;
  cur text;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  select x.* into v from public.design_asset_versions x where x.asset_id = a.id and x.version_no = p_version_no;
  if not found then
    raise exception 'NOT_FOUND: 그 판을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select x.storage_key into cur from public.design_asset_versions x where x.asset_id = a.id and x.version_no = a.current_version_no;
  if v.storage_key = cur then
    raise exception 'VALIDATION: 지금 파일과 같은 판입니다' using errcode = '22023';
  end if;
  r := app.design_asset_add_version(a, 'restore', v.storage_key, v.file_name, v.file_size_bytes, v.mime_type, v.sha256, null,
                                    a.source_brief_revision, v.version_no);
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_restore', r,
                                 jsonb_build_object('version_no', a.current_version_no + 1, 'restored_from_version_no', v.version_no));
  return r;
end $$;
revoke execute on function public.restore_design_asset_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_design_asset_version(uuid, integer, integer) to authenticated;

-- 6-7) 맞추기: 바탕 브리프의 지금 revision 으로(브리프가 확정·보관 안 됨일 때만). 파일은 그대로, 판 하나 더
create or replace function public.rebase_design_asset(p_asset_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.design_assets%rowtype;
  b public.production_briefs%rowtype;
  v public.design_asset_versions%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  select x.* into b from public.production_briefs x where x.id = a.production_brief_id;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프라 맞출 수 없습니다. 이 자산은 지난 브리프 기준 그대로 고칠 수 있습니다' using errcode = 'P0001';
  end if;
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 제작 브리프가 작성 중이라 맞출 수 없습니다. 브리프를 확정한 뒤 맞춰 주세요' using errcode = 'P0001';
  end if;
  if b.revision = a.source_brief_revision then
    raise exception 'VALIDATION: 이미 지금 제작 브리프 기준입니다' using errcode = '22023';
  end if;
  select x.* into v from public.design_asset_versions x where x.asset_id = a.id and x.version_no = a.current_version_no;
  r := app.design_asset_add_version(a, 'rebase', v.storage_key, v.file_name, v.file_size_bytes, v.mime_type, v.sha256, null, b.revision, null);
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_rebase', r,
                                 jsonb_build_object('from_brief_revision', a.source_brief_revision, 'to_brief_revision', b.revision,
                                                    'version_no', a.current_version_no + 1));
  return r;
end $$;
revoke execute on function public.rebase_design_asset(uuid, integer) from public, anon;
grant execute on function public.rebase_design_asset(uuid, integer) to authenticated;

-- 6-8) 보관(삭제 대신, 되돌리기 없음). 파일은 지우지 않는다(보관 자산도 내려받기 가능)
create or replace function public.archive_design_asset(p_asset_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.design_assets%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if a.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 디자인 자산입니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  update public.design_assets set archived_at = now() where id = a.id returning revision into r;
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_archive', r, jsonb_build_object('version_no', a.current_version_no, 'status', a.status));
  return r;
end $$;
revoke execute on function public.archive_design_asset(uuid, integer) from public, anon;
grant execute on function public.archive_design_asset(uuid, integer) to authenticated;

-- 6-9) 사용처 목록 교체(0~20). [{doc_id, section_id}] — 문서는 같은 프로젝트·보관 안 됨, 섹션은 그 문서 현재 판에 있어야 한다
create or replace function public.set_design_asset_usages(p_asset_id uuid, p_expected_revision integer, p_usages jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a     public.design_assets%rowtype;
  e     jsonb;
  d_id  uuid;
  s_id  text;
  pairs text[] := '{}'::text[];
  prev  text[];
  r     integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  a := app.lock_own_design_asset(p_asset_id);
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_design_asset_open(a);
  if p_usages is null or jsonb_typeof(p_usages) <> 'array' then
    raise exception 'VALIDATION: 사용처 목록 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_usages) > 20 then
    raise exception 'VALIDATION: 사용처는 자산당 20곳까지입니다' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p_usages) x loop
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2
       or app.jt(e -> 'doc_id') <> 'string' or app.jt(e -> 'section_id') <> 'string'
       or app.try_uuid(e ->> 'doc_id') is null or app.try_uuid(e ->> 'section_id') is null then
      raise exception 'VALIDATION: 사용처 항목 형식이 올바르지 않습니다' using errcode = '22023';
    end if;
    d_id := app.try_uuid(e ->> 'doc_id');
    s_id := app.try_uuid(e ->> 'section_id')::text;
    if (d_id::text || '/' || s_id) = any(pairs) then
      raise exception 'VALIDATION: 같은 사용처가 두 번 들어 있습니다' using errcode = '22023';
    end if;
    if not exists (select 1 from public.web_copy_docs d
                     join public.web_copy_versions v on v.doc_id = d.id and v.version_no = d.current_version_no
                    where d.id = d_id and d.project_id = a.project_id and d.archived_at is null
                      and s_id = any(app.web_copy_ids(v.content, 'section'))) then
      raise exception 'VALIDATION: 같은 프로젝트의 작업 중인 홈페이지 문서 섹션만 사용처로 연결할 수 있습니다' using errcode = '22023';
    end if;
    pairs := array_append(pairs, d_id::text || '/' || s_id);
  end loop;
  select coalesce(array_agg(x.web_copy_doc_id::text || '/' || x.section_id), '{}'::text[]) into prev
    from public.design_asset_usages x where x.asset_id = a.id;
  if (select coalesce(array_agg(p order by p), '{}'::text[]) from unnest(pairs) p) = (select coalesce(array_agg(p order by p), '{}'::text[]) from unnest(prev) p) then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  delete from public.design_asset_usages x where x.asset_id = a.id;
  insert into public.design_asset_usages (workspace_id, project_id, asset_id, web_copy_doc_id, section_id, created_by)
  select a.workspace_id, a.project_id, a.id, split_part(p, '/', 1)::uuid, split_part(p, '/', 2), auth.uid() from unnest(pairs) p;
  update public.design_assets set updated_at = now() where id = a.id returning revision into r;
  perform app.design_asset_audit(a.workspace_id, a.id, 'design_asset_usages', r, jsonb_build_object('usages', cardinality(pairs)));
  return r;
end $$;
revoke execute on function public.set_design_asset_usages(uuid, integer, jsonb) from public, anon;
grant execute on function public.set_design_asset_usages(uuid, integer, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 7) 기존 표 정리(Master O3 결정, Tester QA-P3B-BACKEND-01): research_sources 는 RPC 로만 추가·검토하고 지우는 경로가 없다.
--    DELETE 권한이 남아 RLS 가 0행으로만 막고 있었으므로 회수한다(TRUNCATE 는 RLS 가 적용되지 않으니 함께).
--    출처 삭제 기능을 나중에 만들면 그때 P3-b 되돌리기의 출처 재검사를 넣는다.
-- ─────────────────────────────────────────────
revoke delete, truncate on public.research_sources from authenticated;

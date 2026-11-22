-- P3D-BACKEND-IMPL-01 영상 구성·파일 관리(P3-d) 서버. 설계: Plan/Claude-Backend-20261120/P3D-BACKEND-01-DESIGN.md (Master 수락, 8절 결정)
-- 범위: 확정(ready)·보관 안 된 제작 브리프(포함 산출물에 video_plan)를 바탕으로 영상 구성안(장면 목록)을 판 단위로 남기고,
--   밖에서 만든 영상 파일을 파일 판(0~20)으로 첨부한다. 영상 생성·편집·자막 합성·AI 호출 없음(X11).
--
-- 구성안: 저장할 때마다 새 판(제목·비율·상태·장면 전체 스냅샷, 판 100). 장면 빼기 = 목록에서 제거, 되살리기는 옛 판 되돌리기(장면 id 유지).
-- 장면 자산: {asset_id, version_no}. 판 번호는 서버가 찍는다(새로 넣은 자산만 그 순간 current_version_no, 이미 연결된 자산은 그대로) →
--   자산 새 판이면 이전 기준(stale). 푸는 길은 맞추기(rebase)뿐.
-- 파일 업로드: Vercel 함수 본문 4.5MB 한도라 브라우저가 저장소에 직접 올린다(자료 업로드 U·P3-c 와 같은 예약 → 서명 업로드 → 확정, 서버 서명).
--   서명 비밀값은 P3-c 와 공유(app.server_secrets 'design_asset_signing' = DESIGN_ASSET_SIGNING_KEY, Master 결정 ④).
--   서명 용도에 video_file_* 를 넣어 디자인 자산 서명과 바꿔치기할 수 없다.
-- 한도는 상수 한 곳(Master 결정 ①③, 주인님 DEC-22 대기): 파일 하나 50MB, 업무실 영상 총량 1GB.
--
-- 바뀌는 것
--   1) 버킷 video-files(비공개, 50MB, mp4·mov·webm)와 저장소 정책 2개(select 본인 업무실, insert 예약 경로만)
--   2) video_plans, video_plan_versions(추가 전용), video_file_versions(추가 전용), video_file_uploads(예약, 사용자 읽기 없음)
--   3) 정의자 RPC 9개, 감사 1행(entity_type 'video_plan', 제목·대사·자막·파일 이름·메모 글자 없음)
-- 바뀌지 않는 것: 기존 표·RPC·버킷·서명 비밀값.
-- 잠금: 만들기는 브리프 FOR SHARE → advisory(33001, 브리프). 예약은 advisory(33002, 업무실) → 구성안 FOR SHARE.
--       그 밖에는 구성안 한 행 FOR UPDATE(확정·닫기는 구성안 → 예약 순서).

-- ─────────────────────────────────────────────
-- 0) 값 규칙 도우미
-- ─────────────────────────────────────────────
-- 영상 파일 하나 상한 50MB(Supabase Free 전역 한도와 같음). 올리면 이 함수·버킷·앱 상수만 바꾼다
create or replace function app.video_file_max_bytes() returns bigint
language sql immutable set search_path = '' as $$ select 52428800::bigint $$;
revoke execute on function app.video_file_max_bytes() from public, anon;

-- 업무실 영상 총량 상한 1GB(파일 판이 가리키는 서로 다른 파일 + 진행 중 예약). 디자인 자산 용량과 따로 센다
create or replace function app.video_file_quota_bytes() returns bigint
language sql immutable set search_path = '' as $$ select 1073741824::bigint $$;
revoke execute on function app.video_file_quota_bytes() from public, anon;

create or replace function app.video_mime_ext(p_mime text) returns text
language sql immutable set search_path = '' as $$
  select case p_mime when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm' end
$$;
revoke execute on function app.video_mime_ext(text) from public, anon;

-- 파일 이름: P3-c 규칙과 같다(1~200자, 공백 정리됨, 경로 구분자·'..'·제어·방향 바꾸기 문자 없음, 확장자 = 형식)
create or replace function app.video_file_name_ok(p_name text, p_mime text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
       char_length(p_name) between 1 and 200
       and p_name = btrim(p_name)
       and p_name !~ '[\\/]'
       and p_name !~ '[[:cntrl:]]'
       and strpos(p_name, '..') = 0
       and p_name !~ '[‎‏‪-‮⁦-⁩]'
       and p_name !~ '^\.[A-Za-z0-9]+$'
       and lower(substring(p_name from '\.([A-Za-z0-9]+)$')) = app.video_mime_ext(p_mime), false)
$$;
revoke execute on function app.video_file_name_ok(text, text) from public, anon;

-- 저장된 장면 목록 모양(판 표 CHECK). 1~30개, 키 정확히 6개, id 는 소문자 uuid·서로 다름, 길이 정수 1~600,
--   대사 null·1~1000, 자막 null·1~300, 자산 0~10개 {asset_id(소문자 uuid, 서로 다름), version_no(정수 ≥1)}
create or replace function app.video_scenes_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  s   jsonb;
  a   jsonb;
  ids text[] := '{}'::text[];
  aids text[];
  d   numeric;
begin
  if app.jt(p) <> 'array' or jsonb_array_length(p) not between 1 and 30 then
    return false;
  end if;
  for s in select e from jsonb_array_elements(p) e loop
    if app.jt(s) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['assets', 'duration_sec', 'id', 'narration', 'subtitle', 'title'] then
      return false;
    end if;
    if app.jt(s -> 'id') <> 'string' or (s ->> 'id') !~ uuid_re or (s ->> 'id') = any(ids) then
      return false;
    end if;
    ids := array_append(ids, s ->> 'id');
    if app.jt(s -> 'title') <> 'string' or not app.design_text_ok(s ->> 'title', 80) then
      return false;
    end if;
    if app.jt(s -> 'duration_sec') <> 'number' then
      return false;
    end if;
    d := (s -> 'duration_sec')::numeric;
    if d <> trunc(d) or d < 1 or d > 600 then
      return false;
    end if;
    if not (app.jt(s -> 'narration') = 'null' or (app.jt(s -> 'narration') = 'string' and app.design_text_ok(s ->> 'narration', 1000))) then
      return false;
    end if;
    if not (app.jt(s -> 'subtitle') = 'null' or (app.jt(s -> 'subtitle') = 'string' and app.design_text_ok(s ->> 'subtitle', 300))) then
      return false;
    end if;
    if app.jt(s -> 'assets') <> 'array' or jsonb_array_length(s -> 'assets') > 10 then
      return false;
    end if;
    aids := '{}'::text[];
    for a in select e from jsonb_array_elements(s -> 'assets') e loop
      if app.jt(a) <> 'object' or (select array_agg(k order by k) from jsonb_object_keys(a) k) <> array['asset_id', 'version_no']
         or app.jt(a -> 'asset_id') <> 'string' or (a ->> 'asset_id') !~ uuid_re or (a ->> 'asset_id') = any(aids)
         or app.jt(a -> 'version_no') <> 'number' or (a -> 'version_no')::numeric <> trunc((a -> 'version_no')::numeric)
         or (a -> 'version_no')::numeric < 1 or (a -> 'version_no')::numeric > 1000 then
        return false;
      end if;
      aids := array_append(aids, a ->> 'asset_id');
    end loop;
  end loop;
  return true;
end $$;
revoke execute on function app.video_scenes_ok(jsonb) from public, anon;

-- 장면 길이 합(초). 판 표가 저장값과 같은지 CHECK 한다
create or replace function app.video_scenes_total(p jsonb) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(sum((e ->> 'duration_sec')::integer), 0)::integer from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
$$;
revoke execute on function app.video_scenes_total(jsonb) from public, anon;

-- ─────────────────────────────────────────────
-- 1) 저장소 버킷
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-files', 'video-files', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- ─────────────────────────────────────────────
-- 2) 표
-- ─────────────────────────────────────────────
create table public.video_plans (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null,
  project_id              uuid not null,
  production_brief_id     uuid not null,
  source_brief_revision   integer not null check (source_brief_revision > 0),
  title                   text not null check (app.design_text_ok(title, 120)),
  aspect_ratio            text not null check (aspect_ratio in ('16:9', '9:16', '1:1')),
  status                  text not null default 'drafting' check (status in ('drafting', 'reviewed')),
  current_version_no      integer not null check (current_version_no between 1 and 100),
  current_file_version_no integer check (current_file_version_no is null or current_file_version_no between 1 and 20),
  archived_at             timestamptz,
  revision                integer not null default 1,
  created_by              uuid not null references auth.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, production_brief_id) references public.production_briefs (project_id, id),
  unique (workspace_id, id),
  unique (project_id, id)
);
create index video_plans_brief on public.video_plans (production_brief_id, updated_at desc);

create table public.video_plan_versions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  plan_id                  uuid not null,
  version_no               integer not null check (version_no between 1 and 100),
  kind                     text not null check (kind in ('create', 'save', 'restore', 'rebase')),
  status                   text not null check (status in ('drafting', 'reviewed')),
  title                    text not null check (app.design_text_ok(title, 120)),
  aspect_ratio             text not null check (aspect_ratio in ('16:9', '9:16', '1:1')),
  scenes                   jsonb not null check (app.video_scenes_ok(scenes)),
  total_duration_sec       integer not null check (total_duration_sec between 1 and 18000),
  source_brief_revision    integer not null check (source_brief_revision > 0),
  restored_from_version_no integer check (restored_from_version_no is null or restored_from_version_no > 0),
  created_by               uuid not null references auth.users (id),
  created_at               timestamptz not null default now(),
  check (total_duration_sec = app.video_scenes_total(scenes)),
  check ((kind = 'restore') = (restored_from_version_no is not null)),
  foreign key (workspace_id, plan_id) references public.video_plans (workspace_id, id),
  unique (plan_id, version_no),
  -- 뒤 단계(P3-f 검수)가 "이 구성안의 판"을 복합 FK 로 가리킬 자리
  unique (plan_id, id)
);

alter table public.video_plans
  add constraint video_plans_current_version_fkey foreign key (id, current_version_no)
  references public.video_plan_versions (plan_id, version_no) deferrable initially deferred;

create table public.video_file_versions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  plan_id                  uuid not null,
  version_no               integer not null check (version_no between 1 and 20),
  kind                     text not null check (kind in ('upload', 'restore')),
  storage_key              text not null,
  file_name                text not null,
  file_size_bytes          bigint not null check (file_size_bytes between 1 and 52428800),
  mime_type                text not null check (app.video_mime_ext(mime_type) is not null),
  change_note              text check (change_note is null or app.design_text_ok(change_note, 300)),
  restored_from_version_no integer check (restored_from_version_no is null or restored_from_version_no > 0),
  created_by               uuid not null references auth.users (id),
  created_at               timestamptz not null default now(),
  check (app.video_file_name_ok(file_name, mime_type)),
  check ((kind = 'restore') = (restored_from_version_no is not null)),
  foreign key (workspace_id, plan_id) references public.video_plans (workspace_id, id),
  unique (plan_id, version_no),
  unique (plan_id, id)
);
create index video_file_versions_ws on public.video_file_versions (workspace_id, storage_key);

alter table public.video_plans
  add constraint video_plans_current_file_fkey foreign key (id, current_file_version_no)
  references public.video_file_versions (plan_id, version_no) deferrable initially deferred;

-- 업로드 예약. 사용자는 읽을 수 없다(경로를 미리 알 수 없게). 정의자 RPC·저장소 정책 함수만 본다
create table public.video_file_uploads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  plan_id         uuid not null,
  storage_key     text not null unique,
  file_name       text not null,
  file_size_bytes bigint not null check (file_size_bytes between 1 and 52428800),
  mime_type       text not null check (app.video_mime_ext(mime_type) is not null),
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'closed')),
  close_reason    text check (close_reason in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'MISSING', 'CANCELLED')),
  expires_at      timestamptz not null,
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  check (app.video_file_name_ok(file_name, mime_type)),
  check ((status = 'closed') = (close_reason is not null)),
  check ((status = 'pending') = (decided_at is null)),
  foreign key (workspace_id, plan_id) references public.video_plans (workspace_id, id)
);
create index video_file_uploads_pending on public.video_file_uploads (workspace_id, expires_at) where status = 'pending';
create index video_file_uploads_plan on public.video_file_uploads (plan_id) where status = 'pending';

create trigger video_plans_guard before update on public.video_plans
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'production_brief_id', 'created_by', 'created_at');

-- 보관한 구성안은 어떤 칸도 바꿀 수 없다(보관 되돌리기 포함, 슈퍼유저 직접 수정도)
create or replace function app.video_plan_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 영상 구성안은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.video_plan_frozen() from public, anon, authenticated;
create trigger video_plans_frozen before update on public.video_plans
  for each row execute function app.video_plan_frozen();

create trigger video_plan_versions_append_only before update or delete on public.video_plan_versions
  for each row execute function app.reject_mutation();
create trigger video_file_versions_append_only before update or delete on public.video_file_versions
  for each row execute function app.reject_mutation();

-- ─────────────────────────────────────────────
-- 3) RLS·권한: 구성안·판·파일 판은 select 만 본인 업무실, 예약은 읽기도 없음. 쓰기는 정의자 RPC 만
-- ─────────────────────────────────────────────
alter table public.video_plans         enable row level security;
alter table public.video_plan_versions enable row level security;
alter table public.video_file_versions enable row level security;
alter table public.video_file_uploads  enable row level security;
create policy video_plans_select         on public.video_plans         for select to authenticated using (app.owns_workspace(workspace_id));
create policy video_plan_versions_select on public.video_plan_versions for select to authenticated using (app.owns_workspace(workspace_id));
create policy video_file_versions_select on public.video_file_versions for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.video_plans, public.video_plan_versions, public.video_file_versions, public.video_file_uploads from anon;
revoke all on public.video_file_uploads from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.video_plans, public.video_plan_versions, public.video_file_versions from authenticated;

-- 저장소 insert 정책: 진행 중·만료 전·내가 만든·내 업무실 예약의 경로만
create or replace function app.video_upload_key_ok(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.video_file_uploads u join public.workspaces w on w.id = u.workspace_id
     where u.storage_key = p_name and u.status = 'pending' and u.expires_at > now()
       and u.created_by = auth.uid() and w.owner_user_id = auth.uid())
$$;
revoke execute on function app.video_upload_key_ok(text) from public, anon;
grant execute on function app.video_upload_key_ok(text) to authenticated;

create policy video_files_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'video-files' and app.owns_storage_path(name));
create policy video_files_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'video-files' and app.video_upload_key_ok(name));

-- ─────────────────────────────────────────────
-- 4) 도우미 (정의자 RPC 안에서만)
-- ─────────────────────────────────────────────
create or replace function app.video_plan_audit(p_ws uuid, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, 'video_plan', p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.video_plan_audit(uuid, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 업무실 영상 사용량: 파일 판이 가리키는 서로 다른 파일 + 진행 중·만료 전 예약
create or replace function app.video_file_used_bytes(p_ws uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce((select sum(s) from (select distinct on (v.storage_key) v.file_size_bytes as s
                                         from public.video_file_versions v where v.workspace_id = p_ws order by v.storage_key) t), 0)
       + coalesce((select sum(u.file_size_bytes) from public.video_file_uploads u
                    where u.workspace_id = p_ws and u.status = 'pending' and u.expires_at > now()), 0)
$$;
revoke execute on function app.video_file_used_bytes(uuid) from public, anon, authenticated;

create or replace function app.lock_own_video_plan(p_plan_id uuid) returns public.video_plans
language plpgsql set search_path = '' as $$
declare
  p public.video_plans%rowtype;
begin
  select x.* into p
    from public.video_plans x
   where x.id = p_plan_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 영상 구성안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return p;
end $$;
revoke execute on function app.lock_own_video_plan(uuid) from public, anon, authenticated;

-- 쓸 수 있는지: 구성안 보관 아님 + 프로젝트 보관 아님 + 바탕 전략 작업 취소 아님
create or replace function app.assert_video_plan_open(p_plan public.video_plans) returns void
language plpgsql stable set search_path = '' as $$
declare
  sa uuid;
begin
  if p_plan.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 영상 구성안은 고칠 수 없습니다' using errcode = 'P0001';
  end if;
  select b.strategy_artifact_id into sa from public.production_briefs b where b.id = p_plan.production_brief_id;
  perform app.assert_production_open(p_plan.project_id, sa);
end $$;
revoke execute on function app.assert_video_plan_open(public.video_plans) from public, anon, authenticated;

-- 바탕 브리프를 본인 것만 FOR SHARE 로 읽고 "영상 구성안을 만들 수 있는 브리프"인지 확인
create or replace function app.share_video_brief(p_brief_id uuid) returns public.production_briefs
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
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프로는 영상 구성안을 만들 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_production_open(b.project_id, b.strategy_artifact_id);
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 확정한 제작 브리프로만 영상 구성안을 만들 수 있습니다' using errcode = 'P0001';
  end if;
  if not ('video_plan' = any(b.deliverable_types)) then
    raise exception 'INVALID_TRANSITION: 이 제작 브리프의 포함 산출물에 영상 구성이 없습니다' using errcode = 'P0001';
  end if;
  return b;
end $$;
revoke execute on function app.share_video_brief(uuid) from public, anon, authenticated;

-- 화면이 보낸 장면 목록 → 저장할 장면 목록. 형식이 틀리면 VALIDATION.
--   입력 장면: {id: 지금 판의 장면 id | null(새 장면), title, duration_sec, narration, subtitle, asset_ids: [uuid]}
--   id 는 지금 판(p_prev)에 있는 것만(DS1: 남의 장면·옛 판에만 있는 id·지어낸 id 거절), null 은 새 uuid.
--   자산은 같은 업무실·같은 프로젝트·보관 안 된 것만 새로 연결할 수 있다(Q10). 같은 장면에 이미 연결돼 있던 자산은
--   판 번호를 그대로 두고(보관됐어도 유지), 새로 넣은 자산만 지금 current_version_no 로 찍는다(Q11).
create or replace function app.video_build_scenes(p_ws uuid, p_project uuid, p_prev jsonb, p_input jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  prev_ids text[] := '{}'::text[];
  seen     text[] := '{}'::text[];
  out_     jsonb := '[]'::jsonb;
  s        jsonb;
  ps       jsonb;
  sid      text;
  d        numeric;
  t        text;
  n        text;
  st       text;
  a        jsonb;
  aid      uuid;
  aids     text[];
  assets   jsonb;
  vno      integer;
begin
  if app.jt(p_input) <> 'array' or jsonb_array_length(p_input) < 1 then
    raise exception 'VALIDATION: 장면은 1개 이상이어야 합니다' using errcode = '22023';
  end if;
  if jsonb_array_length(p_input) > 30 then
    raise exception 'VALIDATION: 장면은 30개까지 둘 수 있습니다' using errcode = '22023';
  end if;
  if p_prev is not null then
    select coalesce(array_agg(e ->> 'id'), '{}'::text[]) into prev_ids from jsonb_array_elements(p_prev) e;
  end if;
  for s in select e from jsonb_array_elements(p_input) e loop
    if app.jt(s) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(s) k) <> array['asset_ids', 'duration_sec', 'id', 'narration', 'subtitle', 'title'] then
      raise exception 'VALIDATION: 장면 형식이 올바르지 않습니다' using errcode = '22023';
    end if;
    -- 장면 id
    if app.jt(s -> 'id') = 'null' then
      sid := gen_random_uuid()::text;
      ps := null;
    elsif app.jt(s -> 'id') = 'string' and app.try_uuid(s ->> 'id') is not null and app.try_uuid(s ->> 'id')::text = any(prev_ids) then
      sid := app.try_uuid(s ->> 'id')::text;
      select e into ps from jsonb_array_elements(p_prev) e where e ->> 'id' = sid;
    else
      raise exception 'VALIDATION: 이 구성안에 없는 장면입니다' using errcode = '22023';
    end if;
    if sid = any(seen) then
      raise exception 'VALIDATION: 같은 장면이 두 번 들어 있습니다' using errcode = '22023';
    end if;
    seen := array_append(seen, sid);
    -- 글 칸(앞뒤 공백 정리는 앱이 한다. 여기서는 정리된 값만 받는다)
    if app.jt(s -> 'title') <> 'string' or not app.design_text_ok(s ->> 'title', 80) then
      raise exception 'VALIDATION: 장면 이름은 1~80자로 입력해 주세요' using errcode = '22023';
    end if;
    t := s ->> 'title';
    if app.jt(s -> 'duration_sec') <> 'number' then
      raise exception 'VALIDATION: 장면 길이는 1~600초 사이의 정수로 입력해 주세요' using errcode = '22023';
    end if;
    d := (s -> 'duration_sec')::numeric;
    if d <> trunc(d) or d < 1 or d > 600 then
      raise exception 'VALIDATION: 장면 길이는 1~600초 사이의 정수로 입력해 주세요' using errcode = '22023';
    end if;
    if not (app.jt(s -> 'narration') = 'null' or (app.jt(s -> 'narration') = 'string' and app.design_text_ok(s ->> 'narration', 1000))) then
      raise exception 'VALIDATION: 대사 / 내레이션은 1,000자까지입니다' using errcode = '22023';
    end if;
    n := s ->> 'narration';
    if not (app.jt(s -> 'subtitle') = 'null' or (app.jt(s -> 'subtitle') = 'string' and app.design_text_ok(s ->> 'subtitle', 300))) then
      raise exception 'VALIDATION: 화면 자막은 300자까지입니다' using errcode = '22023';
    end if;
    st := s ->> 'subtitle';
    -- 자산
    if app.jt(s -> 'asset_ids') <> 'array' then
      raise exception 'VALIDATION: 사용 디자인 자산 형식이 올바르지 않습니다' using errcode = '22023';
    end if;
    if jsonb_array_length(s -> 'asset_ids') > 10 then
      raise exception 'VALIDATION: 장면 하나에 디자인 자산은 10개까지 연결할 수 있습니다' using errcode = '22023';
    end if;
    aids := '{}'::text[];
    assets := '[]'::jsonb;
    for a in select e from jsonb_array_elements(s -> 'asset_ids') e loop
      aid := case when app.jt(a) = 'string' then app.try_uuid(a #>> '{}') end;
      if aid is null then
        raise exception 'VALIDATION: 사용 디자인 자산 형식이 올바르지 않습니다' using errcode = '22023';
      end if;
      if aid::text = any(aids) then
        raise exception 'VALIDATION: 같은 디자인 자산이 두 번 들어 있습니다' using errcode = '22023';
      end if;
      aids := array_append(aids, aid::text);
      vno := null;
      if ps is not null then
        select (x ->> 'version_no')::integer into vno from jsonb_array_elements(ps -> 'assets') x where x ->> 'asset_id' = aid::text;
      end if;
      -- 다른 장면에서 옮겨 온 자산(또는 빼고 새 장면에 넣은 자산)도 직전 판 전체에서 같은 자산의 판 번호를 유지한다(여럿이면 가장 낮은 판).
      --   저장만으로 이전 기준이 풀리지 않게 — 푸는 길은 맞추기뿐(P3DE-BACKEND-FIX-01, Tester QA-P3E-PREP-01 D1).
      --   보관된 자산은 여기서 이어받지 않는다: 같은 장면에 그대로 있으면 위에서 유지되고, 다른 장면로 옮기거나 더 넣는 것은 새 연결이라 아래에서 거절(기존 규칙)
      if vno is null and p_prev is not null
         and exists (select 1 from public.design_assets x where x.id = aid and x.workspace_id = p_ws and x.project_id = p_project and x.archived_at is null) then
        select min((x ->> 'version_no')::integer) into vno from jsonb_array_elements(p_prev) e, jsonb_array_elements(e -> 'assets') x
         where x ->> 'asset_id' = aid::text;
      end if;
      if vno is null then
        select x.current_version_no into vno from public.design_assets x
         where x.id = aid and x.workspace_id = p_ws and x.project_id = p_project and x.archived_at is null;
        if vno is null then
          raise exception 'VALIDATION: 같은 프로젝트의 보관하지 않은 디자인 자산만 연결할 수 있습니다' using errcode = '22023';
        end if;
      end if;
      assets := assets || jsonb_build_array(jsonb_build_object('asset_id', aid::text, 'version_no', vno));
    end loop;
    out_ := out_ || jsonb_build_array(jsonb_build_object('id', sid, 'title', t, 'duration_sec', d::integer,
                                                         'narration', to_jsonb(n), 'subtitle', to_jsonb(st), 'assets', assets));
  end loop;
  return out_;
end $$;
revoke execute on function app.video_build_scenes(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- 새 구성안 판 넣기 + 머리 행 바꾸기(판 100 한도). 감사는 부른 쪽이 남긴다
create or replace function app.video_plan_add_version(p_plan public.video_plans, p_kind text, p_status text, p_title text, p_aspect text,
                                                       p_scenes jsonb, p_brief_revision integer, p_restored_from integer) returns integer
language plpgsql set search_path = '' as $$
declare
  n integer := p_plan.current_version_no + 1;
  r integer;
begin
  if n > 100 then
    raise exception 'LIMIT_REACHED: 한 영상 구성안의 판은 100개까지입니다. 구성안을 보관하고 새로 만들어 주세요' using errcode = 'P0001';
  end if;
  insert into public.video_plan_versions (workspace_id, plan_id, version_no, kind, status, title, aspect_ratio, scenes, total_duration_sec,
                                          source_brief_revision, restored_from_version_no, created_by)
  values (p_plan.workspace_id, p_plan.id, n, p_kind, p_status, p_title, p_aspect, p_scenes, app.video_scenes_total(p_scenes),
          p_brief_revision, p_restored_from, auth.uid());
  update public.video_plans set current_version_no = n, status = p_status, title = p_title, aspect_ratio = p_aspect,
                                source_brief_revision = p_brief_revision
   where id = p_plan.id returning revision into r;
  return r;
end $$;
revoke execute on function app.video_plan_add_version(public.video_plans, text, text, text, text, jsonb, integer, integer) from public, anon, authenticated;

create or replace function app.video_plan_current(p_plan public.video_plans) returns public.video_plan_versions
language sql stable set search_path = '' as $$
  select v.* from public.video_plan_versions v where v.plan_id = p_plan.id and v.version_no = p_plan.current_version_no
$$;
revoke execute on function app.video_plan_current(public.video_plans) from public, anon, authenticated;

-- 구성안 머리 값 검사(제목·비율·상태)
create or replace function app.assert_video_plan_fields(p_title text, p_aspect text, p_status text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not app.design_text_ok(p_title, 120) then
    raise exception 'VALIDATION: 영상 제목은 1~120자로 입력해 주세요' using errcode = '22023';
  end if;
  if p_aspect is null or p_aspect not in ('16:9', '9:16', '1:1') then
    raise exception 'VALIDATION: 알 수 없는 화면 비율입니다' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('drafting', 'reviewed') then
    raise exception 'VALIDATION: 알 수 없는 진행 상태입니다' using errcode = '22023';
  end if;
end $$;
revoke execute on function app.assert_video_plan_fields(text, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 5) 구성안 RPC
-- ─────────────────────────────────────────────
-- 5-1) 만들기(장면 함께, Master 결정 ⑧). 브리프당 보관 안 된 것 5·전체 10
create or replace function public.create_video_plan(p_production_brief_id uuid, p_title text, p_aspect_ratio text, p_scenes jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  b      public.production_briefs%rowtype;
  sc     jsonb;
  p_id   uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  b := app.share_video_brief(p_production_brief_id);
  perform app.assert_video_plan_fields(p_title, p_aspect_ratio, 'drafting');
  sc := app.video_build_scenes(b.workspace_id, b.project_id, null, p_scenes);
  perform pg_advisory_xact_lock(33001, hashtext(b.id::text)); -- 이름공간 33001(브리프 영상 구성안 수) + 브리프
  if (select count(*) from public.video_plans x where x.production_brief_id = b.id) >= 10 then
    raise exception 'LIMIT_REACHED: 영상 구성안은 제작 브리프당 10개까지입니다(보관 포함)' using errcode = 'P0001';
  end if;
  if (select count(*) from public.video_plans x where x.production_brief_id = b.id and x.archived_at is null) >= 5 then
    raise exception 'LIMIT_REACHED: 작업 중인 영상 구성안은 5개까지입니다. 쓰지 않는 구성안을 보관한 뒤 만들어 주세요' using errcode = 'P0001';
  end if;
  insert into public.video_plans (workspace_id, project_id, production_brief_id, source_brief_revision, title, aspect_ratio, status,
                                  current_version_no, created_by)
  values (b.workspace_id, b.project_id, b.id, b.revision, p_title, p_aspect_ratio, 'drafting', 1, uid)
  returning id into p_id;
  insert into public.video_plan_versions (workspace_id, plan_id, version_no, kind, status, title, aspect_ratio, scenes, total_duration_sec,
                                          source_brief_revision, created_by)
  values (b.workspace_id, p_id, 1, 'create', 'drafting', p_title, p_aspect_ratio, sc, app.video_scenes_total(sc), b.revision, uid);
  perform app.video_plan_audit(b.workspace_id, p_id, 'video_plan_create', 1,
                               jsonb_build_object('production_brief_id', b.id, 'brief_revision', b.revision, 'version_no', 1,
                                                  'scene_count', jsonb_array_length(sc), 'total_duration_sec', app.video_scenes_total(sc)));
  return p_id;
end $$;
revoke execute on function public.create_video_plan(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_video_plan(uuid, text, text, jsonb) to authenticated;

-- 5-2) 저장 = 새 판(kind save). 바뀐 게 없으면 거절
create or replace function public.save_video_plan(p_plan_id uuid, p_expected_revision integer, p_title text, p_aspect_ratio text,
                                                  p_status text, p_scenes jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p   public.video_plans%rowtype;
  cur public.video_plan_versions%rowtype;
  sc  jsonb;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  p := app.lock_own_video_plan(p_plan_id);
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  perform app.assert_video_plan_fields(p_title, p_aspect_ratio, p_status);
  cur := app.video_plan_current(p);
  sc := app.video_build_scenes(p.workspace_id, p.project_id, cur.scenes, p_scenes);
  if p_title = cur.title and p_aspect_ratio = cur.aspect_ratio and p_status = cur.status and sc = cur.scenes then
    raise exception 'VALIDATION: 바뀐 내용이 없습니다' using errcode = '22023';
  end if;
  r := app.video_plan_add_version(p, 'save', p_status, p_title, p_aspect_ratio, sc, p.source_brief_revision, null);
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_plan_save', r,
                               jsonb_build_object('version_no', p.current_version_no + 1, 'status', p_status,
                                                  'scene_count', jsonb_array_length(sc), 'total_duration_sec', app.video_scenes_total(sc)));
  return r;
end $$;
revoke execute on function public.save_video_plan(uuid, integer, text, text, text, jsonb) from public, anon;
grant execute on function public.save_video_plan(uuid, integer, text, text, text, jsonb) to authenticated;

-- 5-3) 되돌리기: 고른 판의 제목·비율·장면(장면 id·연결 자산 판 번호 그대로)으로 새 판. 진행 상태는 지금 값을 둔다. 지금과 같으면 거절
create or replace function public.restore_video_plan_version(p_plan_id uuid, p_expected_revision integer, p_version_no integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p   public.video_plans%rowtype;
  cur public.video_plan_versions%rowtype;
  v   public.video_plan_versions%rowtype;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  p := app.lock_own_video_plan(p_plan_id);
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  select x.* into v from public.video_plan_versions x where x.plan_id = p.id and x.version_no = p_version_no;
  if not found then
    raise exception 'NOT_FOUND: 그 판을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  cur := app.video_plan_current(p);
  if v.title = cur.title and v.aspect_ratio = cur.aspect_ratio and v.scenes = cur.scenes then
    raise exception 'VALIDATION: 지금 구성안과 같은 판입니다' using errcode = '22023';
  end if;
  r := app.video_plan_add_version(p, 'restore', p.status, v.title, v.aspect_ratio, v.scenes, p.source_brief_revision, v.version_no);
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_plan_restore', r,
                               jsonb_build_object('version_no', p.current_version_no + 1, 'restored_from_version_no', v.version_no,
                                                  'scene_count', jsonb_array_length(v.scenes)));
  return r;
end $$;
revoke execute on function public.restore_video_plan_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_video_plan_version(uuid, integer, integer) to authenticated;

-- 5-4) 맞추기: 브리프 revision 과 장면 자산 판 번호를 지금 값으로(브리프가 확정·보관 안 됨일 때만). 바뀔 게 없으면 거절
create or replace function public.rebase_video_plan(p_plan_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p   public.video_plans%rowtype;
  b   public.production_briefs%rowtype;
  cur public.video_plan_versions%rowtype;
  sc  jsonb;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  p := app.lock_own_video_plan(p_plan_id);
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  select x.* into b from public.production_briefs x where x.id = p.production_brief_id;
  if b.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 제작 브리프라 맞출 수 없습니다. 이 구성안은 지난 브리프 기준 그대로 고칠 수 있습니다' using errcode = 'P0001';
  end if;
  if b.status <> 'ready' then
    raise exception 'INVALID_TRANSITION: 제작 브리프가 작성 중이라 맞출 수 없습니다. 브리프를 확정한 뒤 맞춰 주세요' using errcode = 'P0001';
  end if;
  cur := app.video_plan_current(p);
  -- 장면마다 연결 자산 판 번호를 지금 판으로(자산은 지우지 않으므로 늘 찾는다)
  select jsonb_agg(jsonb_set(s, '{assets}', coalesce((
           select jsonb_agg(jsonb_build_object('asset_id', a ->> 'asset_id', 'version_no', da.current_version_no) order by o2)
             from jsonb_array_elements(s -> 'assets') with ordinality as t2(a, o2)
             join public.design_assets da on da.id = (a ->> 'asset_id')::uuid), '[]'::jsonb)) order by o)
    into sc
    from jsonb_array_elements(cur.scenes) with ordinality as t(s, o);
  if b.revision = p.source_brief_revision and sc = cur.scenes then
    raise exception 'VALIDATION: 이미 지금 제작 브리프·디자인 자산 기준입니다' using errcode = '22023';
  end if;
  r := app.video_plan_add_version(p, 'rebase', p.status, cur.title, cur.aspect_ratio, sc, b.revision, null);
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_plan_rebase', r,
                               jsonb_build_object('from_brief_revision', p.source_brief_revision, 'to_brief_revision', b.revision,
                                                  'version_no', p.current_version_no + 1));
  return r;
end $$;
revoke execute on function public.rebase_video_plan(uuid, integer) from public, anon;
grant execute on function public.rebase_video_plan(uuid, integer) to authenticated;

-- 5-5) 보관(삭제 대신, 되돌리기 없음). 진행 중 업로드 예약은 닫는다. 파일은 지우지 않는다(보관해도 내려받기 가능)
create or replace function public.archive_video_plan(p_plan_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p public.video_plans%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  p := app.lock_own_video_plan(p_plan_id);
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if p.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 영상 구성안입니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  update public.video_file_uploads set status = 'closed', close_reason = 'CANCELLED', decided_at = now()
   where plan_id = p.id and status = 'pending';
  update public.video_plans set archived_at = now() where id = p.id returning revision into r;
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_plan_archive', r,
                               jsonb_build_object('version_no', p.current_version_no, 'file_version_no', p.current_file_version_no, 'status', p.status));
  return r;
end $$;
revoke execute on function public.archive_video_plan(uuid, integer) from public, anon;
grant execute on function public.archive_video_plan(uuid, integer) to authenticated;

-- ─────────────────────────────────────────────
-- 6) 영상 파일 RPC(서버 서명, 비밀값은 P3-c 와 공유하고 용도 video_file_* 로 구분)
-- ─────────────────────────────────────────────
-- 6-1) 업로드 예약. 서명 메시지: video_file_reserve|구성안id|크기|형식|파일이름|서명시각
create or replace function public.reserve_video_file_upload(p_plan_id uuid, p_file_name text, p_size bigint, p_mime text,
                                                            p_signed_at bigint, p_signature text)
returns table (upload_id uuid, storage_key text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p   public.video_plans%rowtype;
  u   uuid := gen_random_uuid();
  k   text;
  ex  timestamptz := now() + interval '1 hour';
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('video_file_reserve', concat_ws('|', p_plan_id::text, p_size::text, p_mime, p_file_name), p_signed_at, p_signature);
  select x.* into p from public.video_plans x
   where x.id = p_plan_id and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
  if not found then
    raise exception 'NOT_FOUND: 영상 구성안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(33002, hashtext(p.workspace_id::text)); -- 이름공간 33002(업무실 영상 예약·용량) + 업무실
  select x.* into p from public.video_plans x where x.id = p_plan_id for share of x;
  perform app.assert_video_plan_open(p);
  if app.video_mime_ext(p_mime) is null then
    raise exception 'UNSUPPORTED_TYPE: MP4·MOV·WEBM 영상만 첨부할 수 있습니다' using errcode = '22023';
  end if;
  if p_size is null or p_size < 1 or p_size > app.video_file_max_bytes() then
    raise exception 'TOO_LARGE: 영상 파일 크기가 한도를 넘었습니다' using errcode = '22023';
  end if;
  if not app.video_file_name_ok(p_file_name, p_mime) then
    raise exception 'TYPE_MISMATCH: 파일 이름(확장자)이 형식과 맞지 않거나 쓸 수 없는 글자가 있습니다' using errcode = '22023';
  end if;
  if coalesce(p.current_file_version_no, 0) >= 20
     or coalesce((select max(v.version_no) from public.video_file_versions v where v.plan_id = p.id), 0) >= 20 then
    raise exception 'LIMIT_REACHED: 첨부 파일 버전은 20개까지 둘 수 있습니다' using errcode = 'P0001';
  end if;
  if (select count(*) from public.video_file_uploads x where x.workspace_id = p.workspace_id and x.status = 'pending' and x.expires_at > now()) >= 5 then
    raise exception 'LIMIT_REACHED: 진행 중인 영상 업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요' using errcode = 'P0001';
  end if;
  if app.video_file_used_bytes(p.workspace_id) + p_size > app.video_file_quota_bytes() then
    raise exception 'QUOTA_EXCEEDED: 업무실 영상 저장 용량을 넘습니다. 쓰지 않는 영상을 정리한 뒤 다시 올려 주세요' using errcode = 'P0001';
  end if;
  k := p.workspace_id::text || '/video-files/' || u::text || '.' || app.video_mime_ext(p_mime);
  insert into public.video_file_uploads (id, workspace_id, plan_id, storage_key, file_name, file_size_bytes, mime_type, expires_at, created_by)
  values (u, p.workspace_id, p.id, k, p_file_name, p_size, p_mime, ex, uid);
  return query select u, k, ex;
end $$;
revoke execute on function public.reserve_video_file_upload(uuid, text, bigint, text, bigint, text) from public, anon;
grant execute on function public.reserve_video_file_upload(uuid, text, bigint, text, bigint, text) to authenticated;

-- 예약 하나를 본인 것만 잠근다(구성안을 먼저 잠근 뒤 부른다). 진행 중이 아니면 INVALID_TRANSITION, 만료면 UPLOAD_EXPIRED
create or replace function app.lock_own_video_upload(p_upload_id uuid, p_plan_id uuid) returns public.video_file_uploads
language plpgsql set search_path = '' as $$
declare
  u public.video_file_uploads%rowtype;
begin
  select x.* into u from public.video_file_uploads x
   where x.id = p_upload_id and x.plan_id = p_plan_id and x.created_by = auth.uid()
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
revoke execute on function app.lock_own_video_upload(uuid, uuid) from public, anon, authenticated;

-- 예약에서 구성안 id 찾기(본인 예약만). 잠금 순서(구성안 → 예약)를 지키려고 먼저 읽기만 한다
create or replace function app.video_upload_plan(p_upload_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select x.plan_id from public.video_file_uploads x
   where x.id = p_upload_id and x.created_by = auth.uid()
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
$$;
revoke execute on function app.video_upload_plan(uuid) from public, anon, authenticated;

-- 6-2) 확정 = 새 파일 판(kind upload). 서명 메시지: video_file_confirm|예약id
--   앱 서버는 이 전에 서명 URL 로 앞 4KB 를 받아 형식 표식(mp4·mov ftyp, webm EBML)을 확인한다(DS5). DB 는 크기·형식 기록을 대조한다
create or replace function public.confirm_video_file_upload(p_upload_id uuid, p_expected_revision integer, p_change_note text,
                                                            p_signed_at bigint, p_signature text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p   public.video_plans%rowtype;
  u   public.video_file_uploads%rowtype;
  md  jsonb;
  n   integer;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('video_file_confirm', p_upload_id::text, p_signed_at, p_signature);
  p := app.lock_own_video_plan(app.video_upload_plan(p_upload_id));
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  u := app.lock_own_video_upload(p_upload_id, p.id);
  if p_change_note is not null and not app.design_text_ok(p_change_note, 300) then
    raise exception 'VALIDATION: 버전 메모는 300자까지입니다' using errcode = '22023';
  end if;
  select o.metadata into md from storage.objects o where o.bucket_id = 'video-files' and o.name = u.storage_key;
  if not found then
    raise exception 'UPLOAD_MISSING: 저장소에 올린 파일이 없습니다' using errcode = 'P0001';
  end if;
  if (md ->> 'size') is distinct from u.file_size_bytes::text
     or btrim(split_part(md ->> 'mimetype', ';', 1)) is distinct from u.mime_type then
    raise exception 'TYPE_MISMATCH: 올린 파일의 크기·형식이 예약과 다릅니다' using errcode = 'P0001';
  end if;
  n := coalesce((select max(v.version_no) from public.video_file_versions v where v.plan_id = p.id), 0) + 1;
  if n > 20 then
    raise exception 'LIMIT_REACHED: 첨부 파일 버전은 20개까지 둘 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.video_file_versions (workspace_id, plan_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type, change_note, created_by)
  values (p.workspace_id, p.id, n, 'upload', u.storage_key, u.file_name, u.file_size_bytes, u.mime_type, p_change_note, auth.uid());
  update public.video_file_uploads set status = 'confirmed', decided_at = now() where id = u.id;
  update public.video_plans set current_file_version_no = n where id = p.id returning revision into r;
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_file_upload', r,
                               jsonb_build_object('file_version_no', n, 'mime_type', u.mime_type, 'file_size_bytes', u.file_size_bytes));
  return r;
end $$;
revoke execute on function public.confirm_video_file_upload(uuid, integer, text, bigint, text) from public, anon;
grant execute on function public.confirm_video_file_upload(uuid, integer, text, bigint, text) to authenticated;

-- 6-3) 예약 닫기(실패·취소·형식 표식 불일치). 서명 메시지: video_file_close|예약id|이유. 객체는 지우지 않는다
create or replace function public.close_video_file_upload(p_upload_id uuid, p_reason text, p_signed_at bigint, p_signature text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.video_plans%rowtype;
  u public.video_file_uploads%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  perform app.assert_design_signature('video_file_close', concat_ws('|', p_upload_id::text, p_reason), p_signed_at, p_signature);
  if p_reason is null or p_reason not in ('TOO_LARGE', 'UNSUPPORTED_TYPE', 'TYPE_MISMATCH', 'MISSING', 'CANCELLED') then
    raise exception 'VALIDATION: 알 수 없는 닫기 이유입니다' using errcode = '22023';
  end if;
  p := app.lock_own_video_plan(app.video_upload_plan(p_upload_id));
  select x.* into u from public.video_file_uploads x
   where x.id = p_upload_id and x.plan_id = p.id and x.created_by = auth.uid() and x.status = 'pending' for update of x;
  if not found then
    raise exception 'NOT_FOUND: 업로드 예약을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  update public.video_file_uploads set status = 'closed', close_reason = p_reason, decided_at = now() where id = u.id;
end $$;
revoke execute on function public.close_video_file_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.close_video_file_upload(uuid, text, bigint, text) to authenticated;

-- 6-4) 파일 되돌리기: 고른 판의 같은 객체로 새 파일 판(kind restore, 복사 없음). 지금 판과 같은 파일이면 거절
create or replace function public.restore_video_file_version(p_plan_id uuid, p_expected_revision integer, p_file_version_no integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p   public.video_plans%rowtype;
  v   public.video_file_versions%rowtype;
  cur text;
  n   integer;
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  p := app.lock_own_video_plan(p_plan_id);
  if p.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_video_plan_open(p);
  select x.* into v from public.video_file_versions x where x.plan_id = p.id and x.version_no = p_file_version_no;
  if not found then
    raise exception 'NOT_FOUND: 그 파일 버전을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select x.storage_key into cur from public.video_file_versions x where x.plan_id = p.id and x.version_no = p.current_file_version_no;
  if v.storage_key = cur then
    raise exception 'VALIDATION: 지금 파일과 같은 버전입니다' using errcode = '22023';
  end if;
  n := coalesce((select max(x.version_no) from public.video_file_versions x where x.plan_id = p.id), 0) + 1;
  if n > 20 then
    raise exception 'LIMIT_REACHED: 첨부 파일 버전은 20개까지 둘 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.video_file_versions (workspace_id, plan_id, version_no, kind, storage_key, file_name, file_size_bytes, mime_type,
                                          restored_from_version_no, created_by)
  values (p.workspace_id, p.id, n, 'restore', v.storage_key, v.file_name, v.file_size_bytes, v.mime_type, v.version_no, auth.uid());
  update public.video_plans set current_file_version_no = n where id = p.id returning revision into r;
  perform app.video_plan_audit(p.workspace_id, p.id, 'video_file_restore', r,
                               jsonb_build_object('file_version_no', n, 'restored_from_version_no', v.version_no));
  return r;
end $$;
revoke execute on function public.restore_video_file_version(uuid, integer, integer) from public, anon;
grant execute on function public.restore_video_file_version(uuid, integer, integer) to authenticated;

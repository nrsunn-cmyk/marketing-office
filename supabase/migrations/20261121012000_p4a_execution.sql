-- P4A-BACKEND-IMPL-01 P4 첫 단계: 실행 승인 대기열·티스토리 수동 게시 실행 기록·성과 수동 입력. 설계: Plan/Claude-Backend-20261120/P4A-BACKEND-01-DESIGN.md
--   (Master 수락: A안 — 실행 입력을 (원본 종류, id, revision, 지문)으로 일반화, 1차는 P2-g 티스토리 채널 초안만. 9절 확인 요청은 추천대로)
-- 외부 API 호출 없음(X11). 외부 채널(crm·search_ad·social_api)과 읽기 전용 수집(readonly_sync)은 칸만 두고 RPC 가 거절한다.
--
-- 바뀌는 것
--   1) execution_jobs: 실행 건(대기열 + 실행 기록). 대기열에 올릴 때 승인본 내용 사본(payload)과 지문(sha256)을 고정하고,
--      승인·기록·재시도·재개 때마다 서버가 지금 원본과 다시 대조한다. 다르면 blocked_mismatch(원인 3종). 멱등 키는 서버가 만든다.
--   2) execution_results: 성과 수동 입력(출처·기간 필수). 고치기 대신 취소(voided) + 새 행.
--   3) 정의자 RPC 12개. 티스토리 게시 기록은 기존 channel_publications(P2-g)를 그대로 쓴다(record_channel_publication 재사용).
--   4) select 만 본인 업무실. 로그인 역할 쓰기·REFERENCES·TRIGGER 없음(PERM-CLEANUP-01 규칙), anon 없음. 감사 본문 0(사본·주소·출처 글 없음).
-- 바뀌지 않는 것: 기존 표·RPC(채널 초안·게시 기록 포함).
-- 잠금: 대기열 올리기는 advisory(33001, 프로젝트) → 초안 FOR SHARE. 그 밖에는 실행 건 한 행 FOR UPDATE → (기록 때) 초안 FOR UPDATE.
--   초안 RPC 는 초안만 잡고 실행 건을 잡지 않으므로 반대 방향이 없다. 성과는 advisory(33002, 프로젝트) 또는 성과 행 하나.

-- ─────────────────────────────────────────────
-- 0) 원본 사본·지문
-- ─────────────────────────────────────────────
-- 실행에 쓰는 내용 사본. 채널 초안이면 편집 칸 5개(상태·revision·시각은 넣지 않는다 — 상태만 바뀐 것은 불일치가 아니다)
create or replace function app.exec_source_payload(p_kind text, p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_kind
    when 'channel_draft' then (
      select jsonb_build_object('title', d.title, 'body', d.body, 'tags', d.tags, 'image_note', d.image_note, 'meta_description', d.meta_description)
        from public.channel_drafts d where d.id = p_id)
  end
$$;
revoke execute on function app.exec_source_payload(text, uuid) from public, anon, authenticated;

-- 지문 = sha256(jsonb 글자). jsonb 글자는 키 순서가 정해져 있어 같은 내용이면 같은 지문
create or replace function app.exec_hash(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;
revoke execute on function app.exec_hash(jsonb) from public, anon, authenticated;

-- 원본이 지금 실행할 수 있는 상태인지와 불일치 원인(null 이면 일치). 원본 열림(퍼널·작업·프로젝트)은 부른 쪽이 따로 본다
create or replace function app.exec_block_reason(p_kind text, p_id uuid, p_hash text) returns text
language plpgsql stable set search_path = '' as $$
declare
  d public.channel_drafts%rowtype;
begin
  if p_kind <> 'channel_draft' then
    return 'source_archived';
  end if;
  select x.* into d from public.channel_drafts x where x.id = p_id;
  if not found or d.archived_at is not null then
    return 'source_archived';
  end if;
  if d.status <> 'reviewed' then
    return 'not_reviewed';
  end if;
  if app.exec_hash(app.exec_source_payload(p_kind, p_id)) is distinct from p_hash then
    return 'content_changed';
  end if;
  return null;
end $$;
revoke execute on function app.exec_block_reason(text, uuid, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 1) 표
-- ─────────────────────────────────────────────
create table public.execution_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  project_id      uuid not null,
  source_kind     text not null check (source_kind in ('channel_draft', 'delivery_bundle_item')),
  source_id       uuid not null,
  source_revision integer not null check (source_revision > 0),
  source_hash     text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object'),
  channel         text not null check (channel in ('tistory_manual', 'crm', 'search_ad', 'social_api')),
  -- 멱등 키 = 'exec-' + 실행 건 id 전체(서버가 만든다, Tester QA-P4A-PREP-01 Q3)
  idempotency_key text not null check (idempotency_key ~ '^exec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  status          text not null default 'pending_approval'
                  check (status in ('pending_approval', 'blocked_mismatch', 'queued', 'running', 'succeeded', 'failed', 'held')),
  held_from       text check (held_from in ('pending_approval', 'queued', 'failed')),
  block_reason    text check (block_reason in ('content_changed', 'source_archived', 'not_reviewed')),
  attempt_count   integer not null default 0 check (attempt_count between 0 and 3),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  publication_id  uuid,
  executed_at     timestamptz,
  external_url    text check (external_url is null or app.publication_url_ok(external_url)),
  archived_at     timestamptz,
  revision        integer not null default 1,
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'held') = (held_from is not null)),
  check ((status = 'blocked_mismatch') = (block_reason is not null)),
  check ((status = 'succeeded') = (executed_at is not null)),
  check (approved_at is null or approved_by is not null),
  -- 티스토리 수동 실행의 결과는 같은 초안의 게시 기록 행이다
  check (publication_id is null or (channel = 'tistory_manual' and source_kind = 'channel_draft')),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (source_id, publication_id) references public.channel_publications (draft_id, id),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  unique (project_id, id)
);
-- 같은 원본·같은 채널에 끝나지 않은 건은 하나(보관·완료 제외)
create unique index execution_jobs_one_open on public.execution_jobs (source_kind, source_id, channel)
  where archived_at is null and status <> 'succeeded';
create index execution_jobs_project on public.execution_jobs (project_id, created_at);

create trigger execution_jobs_guard before update on public.execution_jobs
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'source_kind', 'source_id', 'channel',
                                                 'idempotency_key', 'created_by', 'created_at');

create or replace function app.execution_job_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 실행 건은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  if old.status = 'succeeded' and (new.status <> 'succeeded' or new.publication_id is distinct from old.publication_id
       or new.executed_at is distinct from old.executed_at or new.external_url is distinct from old.external_url
       or new.payload is distinct from old.payload or new.source_hash is distinct from old.source_hash) then
    raise exception 'FROZEN_COLUMN: 끝난 실행 건의 결과는 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  -- 승인본 사본·지문·원본 revision 은 맞추기(막힘 → 승인 대기)에서만 바뀐다(관리자 직접 수정도 거절, Tester QA-P4A-PREP-01)
  if (new.payload is distinct from old.payload or new.source_hash is distinct from old.source_hash or new.source_revision is distinct from old.source_revision)
     and not (old.status = 'blocked_mismatch' and new.status = 'pending_approval') then
    raise exception 'FROZEN_COLUMN: 실행 건의 승인본 사본·지문은 맞추기에서만 바꿀 수 있습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.execution_job_frozen() from public, anon, authenticated;
create trigger execution_jobs_frozen before update on public.execution_jobs
  for each row execute function app.execution_job_frozen();

create table public.execution_results (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  project_id       uuid not null,
  execution_job_id uuid,
  metric_name      text not null check (char_length(metric_name) between 1 and 60 and metric_name = app.funnel_trim(metric_name)),
  value            numeric(16, 2) not null check (value >= 0),
  unit             text not null check (unit in ('count', 'percent', 'won', 'seconds')),
  numerator        bigint check (numerator is null or numerator >= 0),
  denominator      bigint check (denominator is null or denominator > 0),
  source_note      text not null check (char_length(source_note) between 1 and 200 and source_note = app.funnel_trim(source_note)),
  period_start     date not null,
  period_end       date not null,
  collection_mode  text not null check (collection_mode in ('manual_entry', 'readonly_sync')),
  status           text not null default 'active' check (status in ('active', 'voided')),
  void_reason      text check (void_reason is null or (char_length(void_reason) between 1 and 300 and void_reason = app.funnel_trim(void_reason))),
  voided_at        timestamptz,
  archived_at      timestamptz,
  revision         integer not null default 1,
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((numerator is null) = (denominator is null)),
  check (period_start <= period_end and period_end - period_start <= 365 and period_start >= date '2000-01-01'),
  check (unit <> 'percent' or value <= 100),
  check ((status = 'voided') = (void_reason is not null and voided_at is not null)),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id),
  foreign key (project_id, execution_job_id) references public.execution_jobs (project_id, id),
  unique (workspace_id, id)
);
create index execution_results_project on public.execution_results (project_id, period_end desc, created_at);

-- 성과 행은 내용을 고치지 않는다(취소·보관만)
create trigger execution_results_guard before update on public.execution_results
  for each row execute function app.guard_update('id', 'workspace_id', 'project_id', 'execution_job_id', 'metric_name', 'value', 'unit',
                                                 'numerator', 'denominator', 'source_note', 'period_start', 'period_end',
                                                 'collection_mode', 'created_by', 'created_at');
create or replace function app.execution_result_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.archived_at is not null then
    raise exception 'FROZEN_COLUMN: 보관한 성과 기록은 바꿀 수 없습니다' using errcode = 'P0001';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'FROZEN_COLUMN: 취소한 성과 기록은 되살릴 수 없습니다' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function app.execution_result_frozen() from public, anon, authenticated;
create trigger execution_results_frozen before update on public.execution_results
  for each row execute function app.execution_result_frozen();

-- ─────────────────────────────────────────────
-- 2) RLS·권한: select 만 본인 업무실. 로그인 역할 쓰기·REFERENCES·TRIGGER 없음, anon 없음
-- ─────────────────────────────────────────────
alter table public.execution_jobs    enable row level security;
alter table public.execution_results enable row level security;
create policy execution_jobs_select    on public.execution_jobs    for select to authenticated using (app.owns_workspace(workspace_id));
create policy execution_results_select on public.execution_results for select to authenticated using (app.owns_workspace(workspace_id));
revoke all on public.execution_jobs, public.execution_results from anon;
revoke insert, update, delete, truncate, references, trigger on public.execution_jobs, public.execution_results from authenticated;

-- ─────────────────────────────────────────────
-- 3) 도우미
-- ─────────────────────────────────────────────
create or replace function app.execution_audit(p_ws uuid, p_type text, p_id uuid, p_action text, p_revision integer, p_details jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (p_ws, p_type, p_id, auth.uid(), p_action, p_revision, p_details)
$$;
revoke execute on function app.execution_audit(uuid, text, uuid, text, integer, jsonb) from public, anon, authenticated;

-- 실행 건 하나를 본인 것만 잠근다(없거나 남의 것이면 NOT_FOUND)
create or replace function app.lock_own_execution_job(p_id uuid) returns public.execution_jobs
language plpgsql set search_path = '' as $$
declare
  j public.execution_jobs%rowtype;
begin
  select x.* into j
    from public.execution_jobs x
   where x.id = p_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = auth.uid())
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 실행 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return j;
end $$;
revoke execute on function app.lock_own_execution_job(uuid) from public, anon, authenticated;

-- 실행 건을 다룰 수 있는지: 보관 아님 + 원본의 퍼널(작업·프로젝트)이 열림
create or replace function app.assert_execution_open(p_job public.execution_jobs) returns void
language plpgsql stable set search_path = '' as $$
declare
  fid uuid;
begin
  if p_job.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 실행 건은 다룰 수 없습니다' using errcode = 'P0001';
  end if;
  if p_job.source_kind = 'channel_draft' then
    select b.funnel_id into fid from public.channel_drafts d join public.content_briefs b on b.id = d.brief_id where d.id = p_job.source_id;
    perform app.assert_funnel_open(fid);
  end if;
end $$;
revoke execute on function app.assert_execution_open(public.execution_jobs) from public, anon, authenticated;

-- 지금 원본과 대조: 불일치면 blocked_mismatch 로 바꾸고 원인을, 일치면 null 을 돌려준다(예외를 던지지 않아 상태 변경이 남는다)
create or replace function app.execution_recheck(p_job public.execution_jobs) returns text
language plpgsql set search_path = '' as $$
declare
  why text := app.exec_block_reason(p_job.source_kind, p_job.source_id, p_job.source_hash);
begin
  if why is not null then
    update public.execution_jobs set status = 'blocked_mismatch', block_reason = why, held_from = null where id = p_job.id;
    perform app.execution_audit(p_job.workspace_id, 'execution_job', p_job.id, 'execution_blocked', p_job.revision + 1,
                                jsonb_build_object('block_reason', why, 'from_status', p_job.status));
  end if;
  return why;
end $$;
revoke execute on function app.execution_recheck(public.execution_jobs) from public, anon, authenticated;

-- 실행 건을 돌려줄 때 모양(화면용, 사본·주소 포함 — 감사에는 넣지 않는다)
create or replace function app.execution_row(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('job_id', j.id, 'status', j.status, 'block_reason', j.block_reason, 'revision', j.revision,
                            'attempt_count', j.attempt_count, 'publication_id', j.publication_id, 'idempotency_key', j.idempotency_key)
    from public.execution_jobs j where j.id = p_id
$$;
revoke execute on function app.execution_row(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) RPC — 실행 건
-- ─────────────────────────────────────────────
-- 4-1) 대기열에 올리기. 원본 = 같은 프로젝트의 검토 완료(reviewed)·보관 안 된 채널 초안. 채널은 tistory_manual 만(나머지는 자리만)
create or replace function public.enqueue_execution(p_project_id uuid, p_source_kind text, p_source_id uuid, p_channel text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  ws   uuid;
  d    public.channel_drafts%rowtype;
  pid  uuid;
  fid  uuid;
  body jsonb;
  j_id uuid := gen_random_uuid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('tistory_manual', 'crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 알 수 없는 채널입니다' using errcode = '22023';
  end if;
  if p_channel <> 'tistory_manual' then
    raise exception 'VALIDATION: 아직 연결하지 않은 채널입니다(티스토리 수동 게시만 쓸 수 있습니다)' using errcode = '22023';
  end if;
  if p_source_kind is distinct from 'channel_draft' then
    raise exception 'VALIDATION: 지금은 채널 초안만 실행 대기열에 올릴 수 있습니다' using errcode = '22023';
  end if;
  select p.workspace_id into ws from public.projects p
   where p.id = p_project_id and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.owner_user_id = uid);
  if ws is null then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(33001, hashtext(p_project_id::text)); -- 이름공간 33001(실행 대기열) + 프로젝트
  select x.* into d from public.channel_drafts x where x.id = p_source_id and x.workspace_id = ws for share of x;
  if not found then
    raise exception 'NOT_FOUND: 채널 초안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  select b.project_id, b.funnel_id into pid, fid from public.content_briefs b where b.id = d.brief_id;
  if pid is distinct from p_project_id then
    raise exception 'NOT_FOUND: 채널 초안을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  perform app.assert_funnel_open(fid);
  if d.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 초안은 실행 대기열에 올릴 수 없습니다' using errcode = 'P0001';
  end if;
  if d.status <> 'reviewed' then
    raise exception 'INVALID_TRANSITION: 검토 완료한 초안만 실행 대기열에 올릴 수 있습니다' using errcode = 'P0001';
  end if;
  if (select count(*) from public.execution_jobs x where x.project_id = p_project_id) >= 200 then
    raise exception 'LIMIT_REACHED: 실행 건은 프로젝트당 200개까지입니다(보관 포함)' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.execution_jobs x where x.source_kind = 'channel_draft' and x.source_id = d.id and x.channel = p_channel
                and x.archived_at is null and x.status <> 'succeeded') then
    raise exception 'INVALID_TRANSITION: 이 초안은 이미 끝나지 않은 실행 건이 있습니다. 그 건을 끝내거나 보관한 뒤 다시 올려 주세요' using errcode = 'P0001';
  end if;
  body := app.exec_source_payload('channel_draft', d.id);
  insert into public.execution_jobs (id, workspace_id, project_id, source_kind, source_id, source_revision, source_hash, payload, channel,
                                     idempotency_key, created_by)
  values (j_id, ws, p_project_id, 'channel_draft', d.id, d.revision, app.exec_hash(body), body, p_channel,
          'exec-' || j_id::text, uid);
  perform app.execution_audit(ws, 'execution_job', j_id, 'execution_enqueue', 1,
                              jsonb_build_object('source_kind', 'channel_draft', 'source_id', d.id, 'source_revision', d.revision, 'channel', p_channel));
  return j_id;
end $$;
revoke execute on function public.enqueue_execution(uuid, text, uuid, text) from public, anon;
grant execute on function public.enqueue_execution(uuid, text, uuid, text) to authenticated;

-- 4-2) 승인: 지금 원본과 대조해 일치면 queued, 다르면 blocked_mismatch(원인). 결과 모양을 돌려준다(차단도 오류가 아니라 결과)
create or replace function public.approve_execution(p_job_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j   public.execution_jobs%rowtype;
  why text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.status <> 'pending_approval' then
    raise exception 'INVALID_TRANSITION: 승인 대기 중인 실행 건만 승인할 수 있습니다' using errcode = 'P0001';
  end if;
  why := app.execution_recheck(j);
  if why is null then
    update public.execution_jobs set status = 'queued', approved_by = auth.uid(), approved_at = now() where id = j.id;
    perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_approve', j.revision + 1, jsonb_build_object('status', 'queued'));
  end if;
  return app.execution_row(j.id);
end $$;
revoke execute on function public.approve_execution(uuid, integer) from public, anon;
grant execute on function public.approve_execution(uuid, integer) to authenticated;

-- 4-3) 티스토리 수동 게시 기록 + 실행 완료(한 트랜잭션). 이미 끝난 건이면 기존 결과를 그대로 돌려준다(멱등, already_done)
--   게시 기록은 기존 record_channel_publication(P2-g)을 그대로 부른다(주소·시각 규칙·초안당 50·감사가 같다)
create or replace function public.record_tistory_execution(p_job_id uuid, p_expected_revision integer, p_url text, p_published_at timestamptz,
                                                           p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j     public.execution_jobs%rowtype;
  why   text;
  pub   uuid;
  u     text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.status = 'succeeded' then
    return app.execution_row(j.id) || jsonb_build_object('already_done', true);
  end if;
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.channel <> 'tistory_manual' then
    raise exception 'INVALID_TRANSITION: 티스토리 수동 게시 실행 건이 아닙니다' using errcode = 'P0001';
  end if;
  if j.status <> 'queued' then
    raise exception 'INVALID_TRANSITION: 승인해 실행 대기 중인 건만 기록할 수 있습니다' using errcode = 'P0001';
  end if;
  why := app.execution_recheck(j);
  if why is not null then
    return app.execution_row(j.id) || jsonb_build_object('already_done', false);
  end if;
  pub := public.record_channel_publication(j.source_id, p_url, p_published_at, p_note);
  select c.url into u from public.channel_publications c where c.id = pub;
  update public.execution_jobs set status = 'succeeded', publication_id = pub, executed_at = p_published_at, external_url = u where id = j.id;
  perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_succeeded', j.revision + 1,
                              jsonb_build_object('publication_id', pub, 'channel', j.channel, 'attempt_count', j.attempt_count));
  return app.execution_row(j.id) || jsonb_build_object('already_done', false);
end $$;
revoke execute on function public.record_tistory_execution(uuid, integer, text, timestamptz, text) from public, anon;
grant execute on function public.record_tistory_execution(uuid, integer, text, timestamptz, text) to authenticated;

-- 4-4) 다시 하기(실패 → 실행 대기, 같은 키, 3회까지). 지금 원본과 다시 대조한다. 외부 채널용 자리(티스토리 수동은 실패가 생기지 않음)
create or replace function public.retry_execution(p_job_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j   public.execution_jobs%rowtype;
  why text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  -- 끝난 건의 다시 하기는 실행 요청이 아니라 잘못된 전이다(Tester Q7: INVALID_TRANSITION. 기록 RPC 의 멱등 응답과 구분)
  if j.status = 'succeeded' then
    raise exception 'INVALID_TRANSITION: 이미 끝난 실행 건은 다시 할 수 없습니다' using errcode = 'P0001';
  end if;
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.status <> 'failed' then
    raise exception 'INVALID_TRANSITION: 실패한 실행 건만 다시 할 수 있습니다' using errcode = 'P0001';
  end if;
  if j.attempt_count >= 3 then
    raise exception 'LIMIT_REACHED: 같은 실행 건은 3번까지 다시 할 수 있습니다' using errcode = 'P0001';
  end if;
  why := app.execution_recheck(j);
  if why is null then
    update public.execution_jobs set status = 'queued', attempt_count = j.attempt_count + 1 where id = j.id;
    perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_retry', j.revision + 1, jsonb_build_object('attempt_count', j.attempt_count + 1));
  end if;
  return app.execution_row(j.id);
end $$;
revoke execute on function public.retry_execution(uuid, integer) from public, anon;
grant execute on function public.retry_execution(uuid, integer) to authenticated;

-- 4-5) 보류·재개. 재개는 보류 전 상태로 돌아가되 지금 원본과 다시 대조한다
create or replace function public.hold_execution(p_job_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.execution_jobs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.status not in ('pending_approval', 'queued', 'failed') then
    raise exception 'INVALID_TRANSITION: 승인 대기·실행 대기·실패 상태만 보류할 수 있습니다' using errcode = 'P0001';
  end if;
  update public.execution_jobs set status = 'held', held_from = j.status where id = j.id;
  perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_hold', j.revision + 1, jsonb_build_object('held_from', j.status));
  return app.execution_row(j.id);
end $$;
revoke execute on function public.hold_execution(uuid, integer) from public, anon;
grant execute on function public.hold_execution(uuid, integer) to authenticated;

create or replace function public.resume_execution(p_job_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j   public.execution_jobs%rowtype;
  why text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.status <> 'held' then
    raise exception 'INVALID_TRANSITION: 보류한 실행 건만 다시 시작할 수 있습니다' using errcode = 'P0001';
  end if;
  why := app.execution_recheck(j);
  if why is null then
    update public.execution_jobs set status = j.held_from, held_from = null where id = j.id;
    perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_resume', j.revision + 1, jsonb_build_object('status', j.held_from));
  end if;
  return app.execution_row(j.id);
end $$;
revoke execute on function public.resume_execution(uuid, integer) from public, anon;
grant execute on function public.resume_execution(uuid, integer) to authenticated;

-- 4-6) 맞추기(불일치 풀기): 원본이 다시 검토 완료·보관 안 됨일 때 지금 내용으로 사본·지문을 다시 고정하고 승인 대기로(사람이 다시 승인)
create or replace function public.rebase_execution(p_job_id uuid, p_expected_revision integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j    public.execution_jobs%rowtype;
  d    public.channel_drafts%rowtype;
  body jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.status <> 'blocked_mismatch' then
    raise exception 'INVALID_TRANSITION: 불일치로 막힌 실행 건만 맞출 수 있습니다' using errcode = 'P0001';
  end if;
  select x.* into d from public.channel_drafts x where x.id = j.source_id for share of x;
  if d.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 원본 초안이 보관되어 맞출 수 없습니다. 이 실행 건을 보관해 주세요' using errcode = 'P0001';
  end if;
  if d.status <> 'reviewed' then
    raise exception 'INVALID_TRANSITION: 원본 초안이 검토 완료가 아니라 맞출 수 없습니다. 초안을 검토 완료로 바꾼 뒤 맞춰 주세요' using errcode = 'P0001';
  end if;
  body := app.exec_source_payload(j.source_kind, j.source_id);
  update public.execution_jobs set status = 'pending_approval', block_reason = null, source_revision = d.revision, source_hash = app.exec_hash(body),
                                  payload = body, approved_by = null, approved_at = null
   where id = j.id;
  perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_rebase', j.revision + 1,
                              jsonb_build_object('source_revision', d.revision, 'from_block_reason', j.block_reason));
  return app.execution_row(j.id);
end $$;
revoke execute on function public.rebase_execution(uuid, integer) from public, anon;
grant execute on function public.rebase_execution(uuid, integer) to authenticated;

-- 4-7) 보관(되돌리기 없음). 실행 중(running)은 보관할 수 없다
create or replace function public.archive_execution(p_job_id uuid, p_expected_revision integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j public.execution_jobs%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if j.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 실행 건입니다' using errcode = 'P0001';
  end if;
  if j.status = 'running' then
    raise exception 'INVALID_TRANSITION: 실행 중인 건은 보관할 수 없습니다' using errcode = 'P0001';
  end if;
  update public.execution_jobs set archived_at = now() where id = j.id returning revision into r;
  perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'execution_archive', r, jsonb_build_object('status', j.status));
  return r;
end $$;
revoke execute on function public.archive_execution(uuid, integer) from public, anon;
grant execute on function public.archive_execution(uuid, integer) to authenticated;

-- ─────────────────────────────────────────────
-- 5) RPC — 성과(수동 입력만)
-- ─────────────────────────────────────────────
create or replace function public.add_execution_result(
  p_project_id       uuid,
  p_execution_job_id uuid,
  p_metric_name   text,
  p_value         numeric,
  p_unit          text,
  p_numerator     numeric,
  p_denominator   numeric,
  p_source_note   text,
  p_period_start  date,
  p_period_end    date,
  p_collection_mode text default 'manual_entry'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  ws    uuid;
  st    text;
  name  text := nullif(app.funnel_trim(p_metric_name), '');
  note  text := nullif(app.funnel_trim(p_source_note), '');
  today date := (now() at time zone 'Asia/Seoul')::date;
  r_id  uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select p.workspace_id, p.status into ws, st from public.projects p
   where p.id = p_project_id and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.owner_user_id = uid);
  if ws is null then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if st = 'archived' then
    raise exception 'INVALID_TRANSITION: 보관한 프로젝트에는 성과를 기록할 수 없습니다' using errcode = 'P0001';
  end if;
  if p_collection_mode is distinct from 'manual_entry' then
    raise exception 'VALIDATION: 지금은 수동 입력만 받습니다(읽기 전용 수집은 아직 연결하지 않았습니다)' using errcode = '22023';
  end if;
  if p_execution_job_id is not null and not exists (select 1 from public.execution_jobs j where j.id = p_execution_job_id and j.project_id = p_project_id) then
    raise exception 'NOT_FOUND: 실행 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if name is null or char_length(name) > 60 then
    raise exception 'VALIDATION: 성과 지표 이름은 1~60자로 입력해 주세요' using errcode = '22023';
  end if;
  if note is null or char_length(note) > 200 then
    raise exception 'VALIDATION: 출처는 1~200자로 입력해 주세요' using errcode = '22023';
  end if;
  if p_unit is null or p_unit not in ('count', 'percent', 'won', 'seconds') then
    raise exception 'VALIDATION: 알 수 없는 단위입니다' using errcode = '22023';
  end if;
  if p_value is null or p_value < 0 or p_value <> round(p_value, 2) or p_value >= 100000000000000 or (p_unit = 'percent' and p_value > 100) then
    raise exception 'VALIDATION: 수치가 올바르지 않습니다(0 이상, 소수 둘째 자리까지, 퍼센트는 100 이하)' using errcode = '22023';
  end if;
  if (p_numerator is null) <> (p_denominator is null) or p_numerator < 0 or p_denominator <= 0
     or p_numerator <> trunc(p_numerator) or p_denominator <> trunc(p_denominator)
     or p_numerator > 9000000000000000000 or p_denominator > 9000000000000000000 then
    raise exception 'VALIDATION: 분자·분모는 둘 다 넣거나 둘 다 비워 주세요(0 이상 정수, 분모는 1 이상)' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'VALIDATION: 집계 시작일과 종료일을 입력해 주세요' using errcode = '22023';
  end if;
  if p_period_start > p_period_end then
    raise exception 'VALIDATION: 집계 시작일이 종료일보다 늦습니다' using errcode = '22023';
  end if;
  if p_period_end > today then
    raise exception 'VALIDATION: 집계 종료일이 미래입니다(한국 시간 기준)' using errcode = '22023';
  end if;
  if p_period_end - p_period_start > 365 or p_period_start < date '2000-01-01' then
    raise exception 'VALIDATION: 집계 기간은 366일 이하로 입력해 주세요' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(33002, hashtext(p_project_id::text)); -- 이름공간 33002(성과) + 프로젝트
  if (select count(*) from public.execution_results x where x.project_id = p_project_id) >= 500 then
    raise exception 'LIMIT_REACHED: 성과 기록은 프로젝트당 500개까지입니다(보관·취소 포함)' using errcode = 'P0001';
  end if;
  insert into public.execution_results (workspace_id, project_id, execution_job_id, metric_name, value, unit, numerator, denominator,
                                        source_note, period_start, period_end, collection_mode, created_by)
  values (ws, p_project_id, p_execution_job_id, name, p_value, p_unit, p_numerator::bigint, p_denominator::bigint, note, p_period_start, p_period_end, 'manual_entry', uid)
  returning id into r_id;
  perform app.execution_audit(ws, 'execution_result', r_id, 'result_add', 1,
                              jsonb_build_object('unit', p_unit, 'period_days', p_period_end - p_period_start + 1, 'collection_mode', 'manual_entry',
                                                 'execution_job_id', p_execution_job_id));
  return r_id;
end $$;
revoke execute on function public.add_execution_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date, text) from public, anon;
grant execute on function public.add_execution_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date, text) to authenticated;

-- 성과 행 하나를 본인 것만 잠근다
create or replace function app.lock_own_execution_result(p_id uuid) returns public.execution_results
language plpgsql set search_path = '' as $$
declare
  x public.execution_results%rowtype;
begin
  select r.* into x from public.execution_results r
   where r.id = p_id and exists (select 1 from public.workspaces w where w.id = r.workspace_id and w.owner_user_id = auth.uid())
     for update of r;
  if not found then
    raise exception 'NOT_FOUND: 성과 기록을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return x;
end $$;
revoke execute on function app.lock_own_execution_result(uuid) from public, anon, authenticated;

-- 성과 행은 고치지 않고 취소·보관이 각각 한 번뿐이라 revision 인자 없이 상태로만 막는다(설계 3-3)
create or replace function public.void_execution_result(p_result_id uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  x   public.execution_results%rowtype;
  why text := nullif(app.funnel_trim(p_reason), '');
  r   integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  x := app.lock_own_execution_result(p_result_id);
  if x.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 성과 기록은 취소할 수 없습니다' using errcode = 'P0001';
  end if;
  if x.status = 'voided' then
    raise exception 'INVALID_TRANSITION: 이미 취소한 성과 기록입니다' using errcode = 'P0001';
  end if;
  if why is null or char_length(why) > 300 then
    raise exception 'VALIDATION: 취소 이유는 1~300자로 입력해 주세요' using errcode = '22023';
  end if;
  update public.execution_results set status = 'voided', void_reason = why, voided_at = now() where id = x.id returning revision into r;
  perform app.execution_audit(x.workspace_id, 'execution_result', x.id, 'result_void', r, jsonb_build_object('status', 'voided'));
  return r;
end $$;
revoke execute on function public.void_execution_result(uuid, text) from public, anon;
grant execute on function public.void_execution_result(uuid, text) to authenticated;

create or replace function public.archive_execution_result(p_result_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  x public.execution_results%rowtype;
  r integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  x := app.lock_own_execution_result(p_result_id);
  if x.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 이미 보관한 성과 기록입니다' using errcode = 'P0001';
  end if;
  update public.execution_results set archived_at = now() where id = x.id returning revision into r;
  perform app.execution_audit(x.workspace_id, 'execution_result', x.id, 'result_archive', r, jsonb_build_object('status', x.status));
  return r;
end $$;
revoke execute on function public.archive_execution_result(uuid) from public, anon;
grant execute on function public.archive_execution_result(uuid) to authenticated;

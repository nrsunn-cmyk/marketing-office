-- P4-EXTERNAL-CHANNELS-01: 외부 채널(crm·search_ad·social_api) 연동, 읽기 전용 성과 수집(readonly_sync), P4B(예약 실행·상담 접수·CRM 후속 작업)
-- 규칙:
--   1) 모든 public 새 표는 RLS 켜고 select만 authenticated 허용(anon 0, 직접 쓰기 0 → perm_cleanup 일관성 유지)
--   2) 비밀값(app.channel_secrets)은 app 스키마에 분리 저장하고 public/anon/authenticated 직접 접근 완전 차단
--   3) 외부 채널 실행/수집은 security definer RPC(dispatch_external_execution_prepare / finish_external_execution / sync_channel_result)로만 기록

-- ─────────────────────────────────────────────
-- 1) 외부 채널 연결 상태 및 비밀값
-- ─────────────────────────────────────────────
create table public.channel_connections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id),
  channel           text not null check (channel in ('crm', 'search_ad', 'social_api')),
  status            text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  account_label     text not null default '' check (char_length(account_label) <= 100),
  endpoint_url      text not null default '' check (char_length(endpoint_url) <= 500),
  metrics_url       text not null default '' check (char_length(metrics_url) <= 500),
  monthly_budget_won bigint not null default 0 check (monthly_budget_won >= 0),
  per_run_limit_won  bigint not null default 0 check (per_run_limit_won >= 0),
  last_checked_at   timestamptz,
  last_error_code   text check (last_error_code is null or char_length(last_error_code) <= 60),
  created_by        uuid not null references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, channel)
);

create table app.channel_secrets (
  workspace_id  uuid not null references public.workspaces (id),
  channel       text not null check (channel in ('crm', 'search_ad', 'social_api')),
  secret_value  text not null check (char_length(secret_value) between 1 and 500),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, channel)
);

revoke all on app.channel_secrets from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) P4B: 예약 실행 · 상담/문의 접수 · CRM 후속 작업
-- ─────────────────────────────────────────────
create table public.execution_schedules (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id),
  project_id       uuid not null,
  execution_job_id uuid not null references public.execution_jobs (id),
  scheduled_at     timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'paused_version_changed', 'cancelled', 'executed')),
  archived_at      timestamptz,
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id)
);

create table public.inquiries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id),
  project_id    uuid not null,
  source_kind   text not null check (source_kind in ('lead_magnet', 'web_copy_contact', 'manual')),
  source_id     uuid,
  contact_name  text not null check (char_length(contact_name) between 1 and 80),
  contact_phone text not null default '' check (char_length(contact_phone) <= 40),
  contact_email text not null default '' check (char_length(contact_email) <= 120),
  note          text not null default '' check (char_length(note) <= 500),
  status        text not null default 'new' check (status in ('new', 'linked', 'closed')),
  archived_at   timestamptz,
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id)
);

create table public.crm_followups (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id),
  project_id       uuid not null,
  inquiry_id       uuid not null references public.inquiries (id),
  assignee_name    text not null check (char_length(assignee_name) between 1 and 60),
  due_date         date not null,
  status           text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'hold')),
  linked_result_id uuid references public.execution_results (id),
  archived_at      timestamptz,
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id)
);

-- RLS 및 권한 정리(PERM_CLEANUP 준수: 직접 쓰기 0, authenticated SELECT만)
alter table public.channel_connections enable row level security;
alter table public.execution_schedules enable row level security;
alter table public.inquiries enable row level security;
alter table public.crm_followups enable row level security;

create policy channel_connections_select on public.channel_connections for select to authenticated using (app.owns_workspace(workspace_id));
create policy execution_schedules_select on public.execution_schedules for select to authenticated using (app.owns_workspace(workspace_id));
create policy inquiries_select on public.inquiries for select to authenticated using (app.owns_workspace(workspace_id));
create policy crm_followups_select on public.crm_followups for select to authenticated using (app.owns_workspace(workspace_id));

revoke all on public.channel_connections, public.execution_schedules, public.inquiries, public.crm_followups from public, anon, authenticated;
grant select on public.channel_connections, public.execution_schedules, public.inquiries, public.crm_followups to authenticated;

-- ─────────────────────────────────────────────
-- 3) 개인정보 마스킹 도우미 (P4B-HANDOFF 2절)
-- ─────────────────────────────────────────────
create or replace function app.mask_name(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_name is null or char_length(p_name) = 0 then ''
    when char_length(p_name) = 1 then '*'
    when char_length(p_name) = 2 then left(p_name, 1) || '*'
    else left(p_name, 1) || repeat('*', char_length(p_name) - 2) || right(p_name, 1)
  end
$$;

create or replace function app.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_phone is null or char_length(trim(p_phone)) = 0 then ''
    when char_length(p_phone) >= 8 then left(p_phone, 3) || '-****-' || right(p_phone, 4)
    else '***'
  end
$$;

create or replace function app.mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_email is null or position('@' in p_email) <= 1 then ''
    else left(p_email, 1) || '***@' || split_part(p_email, '@', 2)
  end
$$;

revoke execute on function app.mask_name(text), app.mask_phone(text), app.mask_email(text) from public, anon, authenticated;

create or replace function app.owner_workspace_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select w.id from public.workspaces w where w.owner_user_id = auth.uid() limit 1
$$;
revoke execute on function app.owner_workspace_id() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4) 외부 채널 연결 설정 / 해제 RPC
-- ─────────────────────────────────────────────
create or replace function public.upsert_channel_connection(
  p_channel text,
  p_account_label text,
  p_endpoint_url text,
  p_metrics_url text default '',
  p_monthly_budget_won bigint default 0,
  p_per_run_limit_won bigint default 0,
  p_secret_key text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  lbl text := app.funnel_trim(coalesce(p_account_label, ''));
  ep text := trim(coalesce(p_endpoint_url, ''));
  mp text := trim(coalesce(p_metrics_url, ''));
  sk text := trim(coalesce(p_secret_key, ''));
  has_secret boolean := false;
  conn_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 외부 채널(crm·search_ad·social_api)만 설정할 수 있습니다' using errcode = '22023';
  end if;
  if char_length(lbl) < 1 or char_length(lbl) > 100 then
    raise exception 'VALIDATION: 계정 표시 이름은 1~100자여야 합니다' using errcode = '22023';
  end if;
  if ep !~ '^https?://' or char_length(ep) > 500 then
    raise exception 'VALIDATION: 실행 연동 주소는 http:// 또는 https:// 로 시작해야 합니다' using errcode = '22023';
  end if;
  if mp <> '' and (mp !~ '^https?://' or char_length(mp) > 500) then
    raise exception 'VALIDATION: 성과 수집 주소는 http:// 또는 https:// 로 시작해야 합니다' using errcode = '22023';
  end if;
  if coalesce(p_monthly_budget_won, 0) < 0 or coalesce(p_per_run_limit_won, 0) < 0 then
    raise exception 'VALIDATION: 비용 한도는 0원 이상이어야 합니다' using errcode = '22023';
  end if;

  select exists(select 1 from app.channel_secrets s where s.workspace_id = ws and s.channel = p_channel) into has_secret;
  if sk = '' and not has_secret then
    raise exception 'VALIDATION: 최초 연결 시 API 키 또는 비밀 토큰을 입력해 주세요' using errcode = '22023';
  end if;
  if sk <> '' then
    if char_length(sk) > 500 then
      raise exception 'VALIDATION: API 키는 500자 이하로 입력해 주세요' using errcode = '22023';
    end if;
    insert into app.channel_secrets (workspace_id, channel, secret_value, updated_at)
    values (ws, p_channel, sk, now())
    on conflict (workspace_id, channel) do update
      set secret_value = excluded.secret_value, updated_at = now();
  end if;

  insert into public.channel_connections (
    workspace_id, channel, status, account_label, endpoint_url, metrics_url,
    monthly_budget_won, per_run_limit_won, last_checked_at, last_error_code, created_by
  )
  values (
    ws, p_channel, 'connected', lbl, ep, mp,
    coalesce(p_monthly_budget_won, 0), coalesce(p_per_run_limit_won, 0), now(), null, uid
  )
  on conflict (workspace_id, channel) do update
    set status = 'connected',
        account_label = excluded.account_label,
        endpoint_url = excluded.endpoint_url,
        metrics_url = excluded.metrics_url,
        monthly_budget_won = excluded.monthly_budget_won,
        per_run_limit_won = excluded.per_run_limit_won,
        last_checked_at = now(),
        last_error_code = null,
        updated_at = now()
  returning id into conn_id;

  return conn_id;
end;
$$;

create or replace function public.disconnect_channel_connection(p_channel text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 알 수 없는 외부 채널입니다' using errcode = '22023';
  end if;

  delete from app.channel_secrets where workspace_id = ws and channel = p_channel;
  update public.channel_connections
     set status = 'disconnected',
         last_error_code = null,
         updated_at = now()
   where workspace_id = ws and channel = p_channel;
  return true;
end;
$$;

-- ─────────────────────────────────────────────
-- 5) 기존 enqueue_execution 확장 (연결된 외부 채널 허용, 미연결 시 기존 오류 문구 유지)
-- ─────────────────────────────────────────────
create or replace function public.enqueue_execution(
  p_project_id uuid, p_source_kind text, p_source_id uuid, p_channel text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  ws   uuid;
  d    public.channel_drafts%rowtype;
  pid  uuid;
  fid  uuid;
  body jsonb;
  j_id uuid := gen_random_uuid();
  is_connected boolean := false;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('tistory_manual', 'crm', 'search_ad', 'social_api') then
    raise exception 'VALIDATION: 알 수 없는 채널입니다' using errcode = '22023';
  end if;
  if p_source_kind is distinct from 'channel_draft' then
    raise exception 'VALIDATION: 지금은 채널 초안만 실행 대기열에 올릴 수 있습니다' using errcode = '22023';
  end if;
  select p.workspace_id into ws from public.projects p
   where p.id = p_project_id and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.owner_user_id = uid);
  if ws is null then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_channel <> 'tistory_manual' then
    select exists(
      select 1 from public.channel_connections c
      where c.workspace_id = ws and c.channel = p_channel and c.status = 'connected'
    ) into is_connected;
    if not is_connected then
      raise exception 'VALIDATION: 아직 연결하지 않은 채널입니다(먼저 외부 채널 연결 설정에서 연결해 주세요)' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(33001, hashtext(p_project_id::text));
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
end;
$$;

-- ─────────────────────────────────────────────
-- 6) 외부 채널 실행 준비/마감 및 읽기 전용 성과 수집(readonly_sync) RPC
-- ─────────────────────────────────────────────
create or replace function public.dispatch_external_execution_prepare(
  p_job_id uuid, p_expected_revision int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  j public.execution_jobs%rowtype;
  conn public.channel_connections%rowtype;
  sec text;
  why text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  perform app.assert_execution_open(j);
  if j.channel = 'tistory_manual' then
    raise exception 'INVALID_TRANSITION: 티스토리 수동 게시 건은 외부 API 실행 대상이 아닙니다' using errcode = 'P0001';
  end if;
  if j.status not in ('queued', 'failed') then
    raise exception 'INVALID_TRANSITION: 승인 완료(실행 대기) 또는 실패 상태에서만 외부 실행할 수 있습니다' using errcode = 'P0001';
  end if;
  if j.status = 'failed' and j.attempt_count >= 3 then
    raise exception 'LIMIT_REACHED: 재시도는 최대 3회까지입니다' using errcode = 'P0001';
  end if;

  why := app.execution_recheck(j);
  if why is not null then
    select * into j from public.execution_jobs where id = j.id;
    return jsonb_build_object('blocked', true, 'step', app.execution_row(j.id));
  end if;

  select * into conn from public.channel_connections where workspace_id = j.workspace_id and channel = j.channel and status = 'connected';
  if not found then
    raise exception 'INVALID_TRANSITION: 외부 채널 연결이 끊겨 있습니다. 연결 설정을 확인해 주세요' using errcode = 'P0001';
  end if;
  select secret_value into sec from app.channel_secrets where workspace_id = j.workspace_id and channel = j.channel;
  if sec is null then
    raise exception 'INVALID_TRANSITION: 외부 채널 API 키가 없습니다. 다시 연결해 주세요' using errcode = 'P0001';
  end if;

  update public.execution_jobs
     set status = 'running',
         attempt_count = case when j.status = 'failed' then j.attempt_count + 1 else greatest(j.attempt_count, 1) end
   where id = j.id
   returning * into j;

  return jsonb_build_object(
    'blocked', false,
    'job_id', j.id,
    'revision', j.revision,
    'channel', j.channel,
    'idempotency_key', j.idempotency_key,
    'payload', j.payload,
    'endpoint_url', conn.endpoint_url,
    'secret_value', sec,
    'per_run_limit_won', conn.per_run_limit_won
  );
end;
$$;

create or replace function public.finish_external_execution(
  p_job_id uuid, p_expected_revision int, p_success boolean, p_external_url text default null, p_error_code text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  j public.execution_jobs%rowtype;
  u_url text := nullif(trim(coalesce(p_external_url, '')), '');
  e_code text := nullif(left(trim(coalesce(p_error_code, '')), 60), '');
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  j := app.lock_own_execution_job(p_job_id);
  if j.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if j.status <> 'running' then
    raise exception 'INVALID_TRANSITION: 실행 중(running) 상태의 건만 마감할 수 있습니다' using errcode = 'P0001';
  end if;

  if p_success then
    update public.execution_jobs
       set status = 'succeeded',
           executed_at = now(),
           external_url = u_url,
           last_error_code = null
     where id = j.id
     returning * into j;
    update public.channel_connections set last_checked_at = now(), last_error_code = null, updated_at = now()
     where workspace_id = j.workspace_id and channel = j.channel;
    perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'external_succeeded', j.revision,
      jsonb_build_object('channel', j.channel));
  else
    update public.execution_jobs
       set status = 'failed',
           last_error_code = coalesce(e_code, 'external_error')
     where id = j.id
     returning * into j;
    update public.channel_connections set last_checked_at = now(), last_error_code = coalesce(e_code, 'external_error'), updated_at = now()
     where workspace_id = j.workspace_id and channel = j.channel;
    perform app.execution_audit(j.workspace_id, 'execution_job', j.id, 'external_failed', j.revision,
      jsonb_build_object('channel', j.channel, 'error_code', coalesce(e_code, 'external_error')));
  end if;
  return app.execution_row(j.id);
end;
$$;

create or replace function public.get_channel_metrics_credentials(p_channel text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  conn public.channel_connections%rowtype;
  sec text;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select * into conn from public.channel_connections where workspace_id = ws and channel = p_channel and status = 'connected';
  if not found then
    raise exception 'INVALID_TRANSITION: 연결된 외부 채널이 아닙니다' using errcode = 'P0001';
  end if;
  if conn.metrics_url = '' then
    raise exception 'VALIDATION: 성과 수집 주소(metrics_url)가 설정되지 않았습니다' using errcode = '22023';
  end if;
  select secret_value into sec from app.channel_secrets where workspace_id = ws and channel = p_channel;
  return jsonb_build_object('metrics_url', conn.metrics_url, 'secret_value', coalesce(sec, ''), 'account_label', conn.account_label);
end;
$$;

create or replace function public.sync_channel_result(
  p_project_id uuid,
  p_execution_job_id uuid,
  p_metric_name text,
  p_value numeric,
  p_unit text,
  p_numerator numeric,
  p_denominator numeric,
  p_source_note text,
  p_period_start date,
  p_period_end date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  p_status text;
  name text := app.funnel_trim(p_metric_name);
  note text := app.funnel_trim(p_source_note);
  r_id uuid;
  cnt int;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select pr.status into p_status from public.projects pr where pr.id = p_project_id and pr.workspace_id = ws;
  if not found then
    raise exception 'NOT_FOUND: 프로젝트를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_status = 'archived' then
    raise exception 'INVALID_TRANSITION: 보관한 프로젝트에는 성과를 수집할 수 없습니다' using errcode = 'P0001';
  end if;
  if char_length(name) < 1 or char_length(name) > 60 then
    raise exception 'VALIDATION: 성과 지표는 1~60자여야 합니다' using errcode = '22023';
  end if;
  if char_length(note) < 1 or char_length(note) > 200 then
    raise exception 'VALIDATION: 출처는 1~200자여야 합니다' using errcode = '22023';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'VALIDATION: 수치는 0 이상이어야 합니다' using errcode = '22023';
  end if;
  if p_unit not in ('count', 'percent', 'won', 'seconds') then
    raise exception 'VALIDATION: 알 수 없는 단위입니다' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end or (p_period_end - p_period_start + 1) > 366 then
    raise exception 'VALIDATION: 집계 기간이 올바르지 않습니다' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(33002, hashtext(p_project_id::text));
  select count(*) into cnt from public.execution_results where workspace_id = ws and project_id = p_project_id;
  if cnt >= 500 then
    raise exception 'LIMIT_REACHED: 프로젝트당 성과 기록은 500개까지입니다' using errcode = 'P0001';
  end if;

  insert into public.execution_results (
    workspace_id, project_id, execution_job_id, metric_name, value, unit, numerator, denominator,
    source_note, period_start, period_end, collection_mode, created_by
  ) values (
    ws, p_project_id, p_execution_job_id, name, p_value, p_unit, p_numerator::bigint, p_denominator::bigint,
    note, p_period_start, p_period_end, 'readonly_sync', uid
  ) returning id into r_id;

  perform app.execution_audit(ws, 'execution_result', r_id, 'result_sync', 1,
    jsonb_build_object('unit', p_unit, 'collection_mode', 'readonly_sync', 'execution_job_id', p_execution_job_id));
  return r_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 7) P4B RPC (예약 실행 · 상담/문의 접수 · CRM 후속 작업)
-- ─────────────────────────────────────────────
create or replace function public.schedule_execution(p_execution_job_id uuid, p_scheduled_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  j public.execution_jobs%rowtype;
  s_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select * into j from public.execution_jobs where id = p_execution_job_id and workspace_id = ws;
  if not found then
    raise exception 'NOT_FOUND: 실행 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if j.archived_at is not null or j.status not in ('pending_approval', 'queued') then
    raise exception 'INVALID_TRANSITION: 승인 대기 또는 실행 대기 상태에서만 예약할 수 있습니다' using errcode = 'P0001';
  end if;
  insert into public.execution_schedules (workspace_id, project_id, execution_job_id, scheduled_at, status, created_by)
  values (ws, j.project_id, j.id, p_scheduled_at, 'scheduled', uid)
  returning id into s_id;
  return s_id;
end;
$$;

create or replace function public.cancel_execution_schedule(p_schedule_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  update public.execution_schedules
     set status = 'cancelled', updated_at = now()
   where id = p_schedule_id and workspace_id = ws and archived_at is null and status in ('scheduled', 'paused_version_changed');
  if not found then
    raise exception 'NOT_FOUND: 예약 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

create or replace function public.create_inquiry(
  p_project_id uuid, p_source_kind text, p_source_id uuid, p_contact_name text, p_contact_phone text, p_contact_email text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  nm text := app.funnel_trim(p_contact_name);
  inq_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects where id = p_project_id and workspace_id = ws and status <> 'archived') then
    raise exception 'INVALID_TRANSITION: 활성 프로젝트에만 문의를 등록할 수 있습니다' using errcode = 'P0001';
  end if;
  if p_source_kind not in ('lead_magnet', 'web_copy_contact', 'manual') then
    raise exception 'VALIDATION: 알 수 없는 접수 출처입니다' using errcode = '22023';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then
    raise exception 'VALIDATION: 문의자 이름은 1~80자여야 합니다' using errcode = '22023';
  end if;
  insert into public.inquiries (
    workspace_id, project_id, source_kind, source_id, contact_name, contact_phone, contact_email, note, created_by
  ) values (
    ws, p_project_id, p_source_kind, p_source_id, nm,
    left(trim(coalesce(p_contact_phone, '')), 40),
    left(trim(coalesce(p_contact_email, '')), 120),
    left(trim(coalesce(p_note, '')), 500),
    uid
  ) returning id into inq_id;
  return inq_id;
end;
$$;

create or replace function public.list_masked_inquiries(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'source_kind', i.source_kind,
      'masked_name', app.mask_name(i.contact_name),
      'masked_phone', app.mask_phone(i.contact_phone),
      'masked_email', app.mask_email(i.contact_email),
      'status', i.status,
      'created_at', i.created_at
    ) order by i.created_at desc)
    from public.inquiries i
    where i.workspace_id = ws and i.project_id = p_project_id and i.archived_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_crm_followup(
  p_inquiry_id uuid, p_assignee_name text, p_due_date date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  inq public.inquiries%rowtype;
  an text := app.funnel_trim(p_assignee_name);
  f_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select * into inq from public.inquiries where id = p_inquiry_id and workspace_id = ws and archived_at is null;
  if not found then
    raise exception 'NOT_FOUND: 상담·문의 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if char_length(an) < 1 or char_length(an) > 60 then
    raise exception 'VALIDATION: 담당자 이름은 1~60자여야 합니다' using errcode = '22023';
  end if;
  insert into public.crm_followups (workspace_id, project_id, inquiry_id, assignee_name, due_date, created_by)
  values (ws, inq.project_id, inq.id, an, p_due_date, uid)
  returning id into f_id;
  update public.inquiries set status = 'linked' where id = inq.id and status = 'new';
  return f_id;
end;
$$;

create or replace function public.update_crm_followup(
  p_followup_id uuid, p_status text, p_linked_result_id uuid default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_status not in ('todo', 'in_progress', 'done', 'hold') then
    raise exception 'VALIDATION: 알 수 없는 후속 작업 상태입니다' using errcode = '22023';
  end if;
  update public.crm_followups
     set status = p_status,
         linked_result_id = coalesce(p_linked_result_id, linked_result_id),
         updated_at = now()
   where id = p_followup_id and workspace_id = ws and archived_at is null;
  if not found then
    raise exception 'NOT_FOUND: CRM 후속 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

-- 모든 새 public RPC 실행 권한 정리
revoke execute on function
  public.upsert_channel_connection(text, text, text, text, bigint, bigint, text),
  public.disconnect_channel_connection(text),
  public.dispatch_external_execution_prepare(uuid, int),
  public.finish_external_execution(uuid, int, boolean, text, text),
  public.get_channel_metrics_credentials(text),
  public.sync_channel_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date),
  public.schedule_execution(uuid, timestamptz),
  public.cancel_execution_schedule(uuid),
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.list_masked_inquiries(uuid),
  public.create_crm_followup(uuid, text, date),
  public.update_crm_followup(uuid, text, uuid)
from public, anon;

grant execute on function
  public.upsert_channel_connection(text, text, text, text, bigint, bigint, text),
  public.disconnect_channel_connection(text),
  public.dispatch_external_execution_prepare(uuid, int),
  public.finish_external_execution(uuid, int, boolean, text, text),
  public.get_channel_metrics_credentials(text),
  public.sync_channel_result(uuid, uuid, text, numeric, text, numeric, numeric, text, date, date),
  public.schedule_execution(uuid, timestamptz),
  public.cancel_execution_schedule(uuid),
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.list_masked_inquiries(uuid),
  public.create_crm_followup(uuid, text, date),
  public.update_crm_followup(uuid, text, uuid)
to authenticated;

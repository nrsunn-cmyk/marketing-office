-- P4-SCHEDULE-RUNNER-01: 예약 실행기(주인님 결정 A2 — 주기 실행은 Supabase pg_cron, 방식은 '실행할 차례' 전환 + 사람이 한 번 클릭)
--
-- 예약 시각이 지나면 예약 행만 바꾼다. 실행 건(execution_jobs)과 외부 호출은 건드리지 않는다.
--   - 예약 뒤 실행 건 지문이 바뀌었거나(맞추기), 원본 초안 내용이 바뀌었거나/검토가 풀렸거나, 실행 건이 막혔으면 → 'paused_version_changed'(자동 보류)
--   - 실행 건이 이미 끝났으면 → 'executed', 보관됐으면 → 'cancelled'
--   - 그 밖은 → 'due'(실행할 차례). 사람이 대기열에서 승인·게시 기록·외부 실행을 누른다
-- 외부 실행 보류(20261124002000)·서버 서명 경계(20261124003000)는 그대로다.
-- pg_cron 확장이 이미 켜져 있을 때만 1분 주기로 등록한다(확장을 켜는 것은 운영 설정 변경이라 여기서 하지 않는다).
-- 확장이 없어도 화면을 열 때 public.refresh_due_execution_schedules() 가 같은 판정을 본인 업무실에만 한다.

-- ─────────────────────────────────────────────
-- 1) 표: 'due' 상태, 예약 때 지문, 차례가 된 시각
-- ─────────────────────────────────────────────
alter table public.execution_schedules
  add column job_source_hash text check (job_source_hash is null or job_source_hash ~ '^[0-9a-f]{64}$'),
  add column due_at timestamptz;

alter table public.execution_schedules drop constraint execution_schedules_status_check;
alter table public.execution_schedules add constraint execution_schedules_status_check
  check (status in ('scheduled', 'due', 'paused_version_changed', 'cancelled', 'executed'));

-- 기존 예약 행: 지금 실행 건 지문을 예약 때 지문으로 채운다(이미 바뀐 것은 알 수 없으므로 지금 기준)
update public.execution_schedules s
   set job_source_hash = j.source_hash
  from public.execution_jobs j
 where j.id = s.execution_job_id and s.job_source_hash is null;

-- 열린 예약(실행 건마다 하나)에 'due' 를 넣는다(007000 색인을 바꿔 만든다)
drop index public.execution_schedules_one_open_per_job;
create unique index execution_schedules_one_open_per_job on public.execution_schedules (execution_job_id)
  where status in ('scheduled', 'due', 'paused_version_changed') and archived_at is null;

-- 실행기가 훑는 색인(시각이 지난 예약만 찾는다)
create index execution_schedules_waiting_idx on public.execution_schedules (scheduled_at)
  where status = 'scheduled' and archived_at is null;

-- ─────────────────────────────────────────────
-- 2) 판정 한 건(예약 행·실행 건 행을 부른 쪽이 잠근 뒤 부른다)
-- ─────────────────────────────────────────────
create or replace function app.schedule_next_status(s public.execution_schedules, j public.execution_jobs, p_now timestamptz)
returns text
language plpgsql stable set search_path = '' as $$
begin
  if j.archived_at is not null then
    return 'cancelled';
  end if;
  if j.status = 'succeeded' then
    return 'executed';
  end if;
  if s.status = 'due' then
    return 'due'; -- 차례가 된 뒤에는 끝나거나 보관될 때만 바뀐다
  end if;
  if s.scheduled_at > p_now then
    return 'scheduled';
  end if;
  if j.status = 'blocked_mismatch'
     or (s.job_source_hash is not null and s.job_source_hash is distinct from j.source_hash)
     or (j.source_kind = 'channel_draft' and app.exec_block_reason(j.source_kind, j.source_id, j.source_hash) is not null) then
    return 'paused_version_changed';
  end if;
  return 'due';
end $$;
revoke execute on function app.schedule_next_status(public.execution_schedules, public.execution_jobs, timestamptz) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3) 실행기: 열린 예약을 훑어 상태만 바꾼다. p_workspace 가 null 이면 전체(크론), 아니면 그 업무실만
--    잠금 순서는 schedule_execution 과 같다(실행 건 → 예약). 다른 요청이 잡고 있는 행은 건너뛰고 다음 주기에 본다
-- ─────────────────────────────────────────────
create or replace function app.run_due_execution_schedules(p_workspace uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  now_at timestamptz := now();
  r record;
  j public.execution_jobs%rowtype;
  s public.execution_schedules%rowtype;
  nxt text;
  changed integer := 0;
begin
  for r in
    select x.id, x.execution_job_id
      from public.execution_schedules x
      join public.execution_jobs y on y.id = x.execution_job_id
     where x.archived_at is null
       and (p_workspace is null or x.workspace_id = p_workspace)
       and (
         (x.status = 'scheduled' and (x.scheduled_at <= now_at or y.status = 'succeeded' or y.archived_at is not null))
         or (x.status in ('due', 'paused_version_changed') and (y.status = 'succeeded' or y.archived_at is not null))
       )
     order by x.scheduled_at
     limit 500
  loop
    select * into j from public.execution_jobs where id = r.execution_job_id for update skip locked;
    continue when not found;
    select * into s from public.execution_schedules where id = r.id for update skip locked;
    continue when not found;
    continue when s.archived_at is not null or s.status not in ('scheduled', 'due', 'paused_version_changed');
    if s.status = 'paused_version_changed' then
      -- 자동 보류는 사람이 취소하기 전까지 그대로. 실행 건이 끝났거나 보관됐을 때만 닫는다
      nxt := case when j.archived_at is not null then 'cancelled' when j.status = 'succeeded' then 'executed' else s.status end;
    else
      nxt := app.schedule_next_status(s, j, now_at);
    end if;
    if nxt is distinct from s.status then
      update public.execution_schedules
         set status = nxt,
             due_at = case when nxt = 'due' then now_at else due_at end,
             updated_at = now_at
       where id = s.id;
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end $$;
revoke execute on function app.run_due_execution_schedules(uuid) from public, anon, authenticated;

-- 화면을 열 때 본인 업무실만 따라잡기(크론이 없어도 화면이 맞게 보인다)
create or replace function public.refresh_due_execution_schedules() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
begin
  if auth.uid() is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  return app.run_due_execution_schedules(ws);
end $$;
revoke execute on function public.refresh_due_execution_schedules() from public, anon;
grant execute on function public.refresh_due_execution_schedules() to authenticated;

-- ─────────────────────────────────────────────
-- 4) 예약: 007000 본문 그대로 + 열린 예약에 'due' + 예약 때 지문 저장
-- ─────────────────────────────────────────────
create or replace function public.schedule_execution(p_execution_job_id uuid, p_scheduled_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  j public.execution_jobs%rowtype;
  s_id uuid;
  lim int := app.p4_r3_limit('schedules_per_job');
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select * into j from public.execution_jobs where id = p_execution_job_id and workspace_id = ws for update;
  if not found then
    raise exception 'NOT_FOUND: 실행 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if j.archived_at is not null or j.status not in ('pending_approval', 'queued') then
    raise exception 'INVALID_TRANSITION: 승인 대기 또는 실행 대기 상태에서만 예약할 수 있습니다' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.execution_schedules s
              where s.execution_job_id = j.id and s.archived_at is null
                and s.status in ('scheduled', 'due', 'paused_version_changed')) then
    raise exception 'INVALID_TRANSITION: 이 실행 건에는 이미 예약이 있습니다. 기존 예약을 취소한 뒤 다시 예약해 주세요' using errcode = 'P0001';
  end if;
  if (select count(*) from public.execution_schedules s where s.execution_job_id = j.id) >= lim then
    raise exception 'LIMIT_REACHED: 한 실행 건의 예약은 취소 포함 %번까지입니다', lim using errcode = 'P0001';
  end if;
  insert into public.execution_schedules (workspace_id, project_id, execution_job_id, scheduled_at, status, created_by, job_source_hash)
  values (ws, j.project_id, j.id, p_scheduled_at, 'scheduled', uid, j.source_hash)
  returning id into s_id;
  return s_id;
end;
$$;

-- 취소: 'due' 도 취소할 수 있다
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
   where id = p_schedule_id and workspace_id = ws and archived_at is null and status in ('scheduled', 'due', 'paused_version_changed');
  if not found then
    raise exception 'NOT_FOUND: 예약 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

revoke execute on function
  public.schedule_execution(uuid, timestamptz),
  public.cancel_execution_schedule(uuid)
from public, anon;
grant execute on function
  public.schedule_execution(uuid, timestamptz),
  public.cancel_execution_schedule(uuid)
to authenticated;

-- ─────────────────────────────────────────────
-- 5) pg_cron 등록: 확장이 이미 켜져 있을 때만(없으면 아무것도 하지 않는다)
-- ─────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $c$select cron.schedule('p4-schedule-runner', '* * * * *', 'select app.run_due_execution_schedules()')$c$;
  end if;
end $$;

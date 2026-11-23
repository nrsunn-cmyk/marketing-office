-- P4-LOW-FIXES-R3-BACKEND-01 (007000): 문의·후속 작업·예약 개수 한도(R3)와 보관 함수
-- create_inquiry 는 006000(R4 출처 확인) 판에 한도·잠금만 더한다. 이 파일을 되돌려도 R4 는 남는다(rollback_007000 이 006000 판으로 되돌림).
-- 설계: Plan/Claude-Backend-20261123/P4-R3-LIMITS-DESIGN-01.md (L1~L4, L6, D2 (가)안)
--   L1 문의: 프로젝트당 보관 안 된 것 기준 상한
--   L2 후속 작업: 문의당 보관 안 된 것 기준 상한
--   L3 실행 건당 열린 예약(scheduled·paused_version_changed) 1개(부분 고유 색인 + 행 잠금)
--   L4 실행 건당 예약 누적(취소 포함) 상한
--   보관: archive_inquiry(문의와 그 후속 작업), archive_crm_followup(후속 작업 하나)
-- 숫자는 app.p4_r3_limit 한 곳에만 둔다(Master·주인님 결정 전 제안값). 바꿀 때는 이 함수만 새 migration 으로 교체한다.
-- 예약 시각 검사(L5)는 결정 D3 전이라 넣지 않는다.
-- 기존 함수의 이름·인자·반환 형식·실행 권한은 그대로다. 데이터는 바꾸지 않는다.
-- 주의: 실행 건 하나에 열린 예약이 이미 2개 이상이면 L3 색인 만들기가 실패한다(precheck_r3.sql 의 jobs_with_multi_open).

-- ─────────────────────────────────────────────
-- 1) 한도 숫자(한 곳)
-- ─────────────────────────────────────────────
create or replace function app.p4_r3_limit(p_name text) returns int
language sql immutable set search_path = '' as $$
  select case p_name
    when 'inquiries_per_project' then 500
    when 'followups_per_inquiry' then 20
    when 'schedules_per_job' then 20
  end
$$;
revoke execute on function app.p4_r3_limit(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2) 색인(세는 열 + 열린 예약 하나)
-- ─────────────────────────────────────────────
create index inquiries_project_active_idx on public.inquiries (project_id) where archived_at is null;
create index crm_followups_inquiry_active_idx on public.crm_followups (inquiry_id) where archived_at is null;
create index execution_schedules_job_idx on public.execution_schedules (execution_job_id);
create unique index execution_schedules_one_open_per_job on public.execution_schedules (execution_job_id)
  where status in ('scheduled', 'paused_version_changed') and archived_at is null;

-- ─────────────────────────────────────────────
-- 3) 예약: 실행 건 행을 잠근 뒤 열린 예약·누적 수 확인
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
                and s.status in ('scheduled', 'paused_version_changed')) then
    raise exception 'INVALID_TRANSITION: 이 실행 건에는 이미 예약이 있습니다. 기존 예약을 취소한 뒤 다시 예약해 주세요' using errcode = 'P0001';
  end if;
  if (select count(*) from public.execution_schedules s where s.execution_job_id = j.id) >= lim then
    raise exception 'LIMIT_REACHED: 한 실행 건의 예약은 취소 포함 %번까지입니다', lim using errcode = 'P0001';
  end if;
  insert into public.execution_schedules (workspace_id, project_id, execution_job_id, scheduled_at, status, created_by)
  values (ws, j.project_id, j.id, p_scheduled_at, 'scheduled', uid)
  returning id into s_id;
  return s_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 4) 문의: 프로젝트 행을 잠근 뒤 개수 확인
-- ─────────────────────────────────────────────
create or replace function public.create_inquiry(
  p_project_id uuid, p_source_kind text, p_source_id uuid, p_contact_name text, p_contact_phone text, p_contact_email text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  nm text := app.funnel_trim(p_contact_name);
  inq_id uuid;
  lim int := app.p4_r3_limit('inquiries_per_project');
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  -- for no key update: 같은 프로젝트의 문의 추가만 한 줄로 세운다(다른 표의 FK key share 잠금은 막지 않음)
  perform 1 from public.projects where id = p_project_id and workspace_id = ws and status <> 'archived' for no key update;
  if not found then
    raise exception 'INVALID_TRANSITION: 활성 프로젝트에만 문의를 등록할 수 있습니다' using errcode = 'P0001';
  end if;
  -- 출처 확인은 006000(R4) 판과 같다
  if p_source_kind is null or p_source_kind not in ('lead_magnet', 'web_copy_contact', 'manual') then
    raise exception 'VALIDATION: 알 수 없는 접수 출처입니다' using errcode = '22023';
  end if;
  if p_source_kind = 'manual' then
    if p_source_id is not null then
      raise exception 'VALIDATION: 직접 등록한 문의에는 출처를 지정할 수 없습니다' using errcode = '22023';
    end if;
  elsif p_source_id is null then
    raise exception 'VALIDATION: 접수 출처를 지정해 주세요' using errcode = '22023';
  elsif p_source_kind = 'lead_magnet' and not exists (
    select 1 from public.lead_magnets m where m.id = p_source_id and m.workspace_id = ws and m.project_id = p_project_id
  ) then
    raise exception 'NOT_FOUND: 같은 프로젝트의 리드 마그넷만 출처로 지정할 수 있습니다' using errcode = 'P0002';
  elsif p_source_kind = 'web_copy_contact' and not exists (
    select 1 from public.web_copy_docs w where w.id = p_source_id and w.workspace_id = ws and w.project_id = p_project_id
  ) then
    raise exception 'NOT_FOUND: 같은 프로젝트의 웹 문구 문서만 출처로 지정할 수 있습니다' using errcode = 'P0002';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 80 then
    raise exception 'VALIDATION: 문의자 이름은 1~80자여야 합니다' using errcode = '22023';
  end if;
  if (select count(*) from public.inquiries i where i.project_id = p_project_id and i.archived_at is null) >= lim then
    raise exception 'LIMIT_REACHED: 문의는 프로젝트당 %개까지입니다. 끝난 문의를 보관한 뒤 다시 등록해 주세요', lim using errcode = 'P0001';
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

-- ─────────────────────────────────────────────
-- 5) 후속 작업: 문의 행을 잠근 뒤 개수 확인
-- ─────────────────────────────────────────────
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
  lim int := app.p4_r3_limit('followups_per_inquiry');
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  select * into inq from public.inquiries where id = p_inquiry_id and workspace_id = ws and archived_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: 상담·문의 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if char_length(an) < 1 or char_length(an) > 60 then
    raise exception 'VALIDATION: 담당자 이름은 1~60자여야 합니다' using errcode = '22023';
  end if;
  if (select count(*) from public.crm_followups f where f.inquiry_id = inq.id and f.archived_at is null) >= lim then
    raise exception 'LIMIT_REACHED: 후속 작업은 문의 하나에 %개까지입니다. 끝난 후속 작업을 보관한 뒤 다시 등록해 주세요', lim using errcode = 'P0001';
  end if;
  insert into public.crm_followups (workspace_id, project_id, inquiry_id, assignee_name, due_date, created_by)
  values (ws, inq.project_id, inq.id, an, p_due_date, uid)
  returning id into f_id;
  update public.inquiries set status = 'linked' where id = inq.id and status = 'new';
  return f_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 6) 보관(D2 (가)안): 한도에 닿았을 때 푸는 길
-- ─────────────────────────────────────────────
create or replace function public.archive_inquiry(p_inquiry_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  inq_id uuid;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  -- 잠금 순서는 create_crm_followup 과 같다(문의 → 후속 작업)
  select id into inq_id from public.inquiries
   where id = p_inquiry_id and workspace_id = ws and archived_at is null
   for update;
  if not found then
    raise exception 'NOT_FOUND: 상담·문의 건을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  update public.inquiries set archived_at = now() where id = inq_id;
  -- 보관한 문의의 후속 작업도 함께 보관한다(문의 없이 남은 후속 작업이 목록에 뜨지 않게)
  update public.crm_followups set archived_at = now(), updated_at = now()
   where inquiry_id = inq_id and archived_at is null;
  return true;
end;
$$;

create or replace function public.archive_crm_followup(p_followup_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  update public.crm_followups set archived_at = now(), updated_at = now()
   where id = p_followup_id and workspace_id = ws and archived_at is null;
  if not found then
    raise exception 'NOT_FOUND: CRM 후속 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  return true;
end;
$$;

-- ─────────────────────────────────────────────
-- 7) 실행 권한(기존과 같은 방식)
-- ─────────────────────────────────────────────
revoke execute on function
  public.schedule_execution(uuid, timestamptz),
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.create_crm_followup(uuid, text, date),
  public.archive_inquiry(uuid),
  public.archive_crm_followup(uuid)
from public, anon;

grant execute on function
  public.schedule_execution(uuid, timestamptz),
  public.create_inquiry(uuid, text, uuid, text, text, text, text),
  public.create_crm_followup(uuid, text, date),
  public.archive_inquiry(uuid),
  public.archive_crm_followup(uuid)
to authenticated;

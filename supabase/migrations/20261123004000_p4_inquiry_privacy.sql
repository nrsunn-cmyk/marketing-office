-- P4-PRIVACY-BACKEND-01 (P4-SAFETY-REVIEW-01 R1·R2)
-- R1: 로그인 역할이 public.inquiries 의 원문(이름·전화·메일·메모)을 직접 읽지 못하게 한다.
--     표 전체 SELECT 를 거두고, 원문이 아닌 열만 열 단위로 다시 준다. 소유자 RLS 정책은 그대로 둔다.
--     화면은 정의자 함수 list_masked_inquiries(가린 값)만 쓰고, 문의 등록은 create_inquiry 로 그대로 된다.
-- R2: CRM 후속 작업이 연결하는 성과는 같은 프로젝트(따라서 같은 업무실)의 것만 허용한다.
--     ① 함수에서 검사해 분명한 오류로 거절 ② 복합 외래 키로 DB 수준에서도 막는다.
--     이미 어긋난 행이 있으면 외래 키 추가가 실패해 migration 전체가 멈춘다(자동 삭제·초기화하지 않음).
--     적용 전 읽기 대조 항목은 Plan/Claude-Backend-20261123/P4-PRIVACY-BACKEND-01.md 3절.

-- ─────────────────────────────────────────────
-- R1. 문의 원문 열 직접 읽기 차단
-- ─────────────────────────────────────────────
revoke select on public.inquiries from public, anon, authenticated;
grant select (id, workspace_id, project_id, source_kind, source_id, status, archived_at, created_by, created_at)
  on public.inquiries to authenticated;

-- ─────────────────────────────────────────────
-- R2. CRM 후속 작업의 성과 연결은 같은 프로젝트만
-- ─────────────────────────────────────────────
-- 외래 키 대상용 유일 제약(id 가 기본 키라 기존 데이터로는 실패하지 않는다)
alter table public.execution_results
  add constraint execution_results_project_id_id_key unique (project_id, id);

-- 기존 단일 외래 키(linked_result_id → execution_results.id)를 같은 프로젝트 복합 외래 키로 바꾼다.
-- 이미 다른 프로젝트를 가리키는 행이 있으면 여기서 실패한다(숨기지 않는다).
alter table public.crm_followups
  drop constraint crm_followups_linked_result_id_fkey;
alter table public.crm_followups
  add constraint crm_followups_project_linked_result_fkey
  foreign key (project_id, linked_result_id) references public.execution_results (project_id, id);

create or replace function public.update_crm_followup(
  p_followup_id uuid, p_status text, p_linked_result_id uuid default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := app.owner_workspace_id();
  uid uuid := auth.uid();
  f public.crm_followups%rowtype;
begin
  if uid is null or ws is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if p_status not in ('todo', 'in_progress', 'done', 'hold') then
    raise exception 'VALIDATION: 알 수 없는 후속 작업 상태입니다' using errcode = '22023';
  end if;
  select * into f from public.crm_followups
   where id = p_followup_id and workspace_id = ws and archived_at is null
   for update;
  if not found then
    raise exception 'NOT_FOUND: CRM 후속 작업을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_linked_result_id is not null and not exists (
    select 1 from public.execution_results r
     where r.id = p_linked_result_id and r.workspace_id = f.workspace_id and r.project_id = f.project_id
  ) then
    raise exception 'NOT_FOUND: 같은 프로젝트의 성과 기록만 연결할 수 있습니다' using errcode = 'P0002';
  end if;
  update public.crm_followups
     set status = p_status,
         linked_result_id = coalesce(p_linked_result_id, linked_result_id),
         updated_at = now()
   where id = f.id;
  return true;
end;
$$;

revoke execute on function public.update_crm_followup(uuid, text, uuid) from public, anon;
grant execute on function public.update_crm_followup(uuid, text, uuid) to authenticated;

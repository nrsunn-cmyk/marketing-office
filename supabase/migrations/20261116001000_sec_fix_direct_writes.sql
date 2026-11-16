-- SEC-FIX-01 직접 쓰기 무결성 우회 차단 (SEC-REPRO-01 83e4d60 재현 결과 반영)
--
-- 고치는 것
--   1) 승인 기록(approvals)·전달 기록(delivery_records)을 로그인 사용자가 RPC 없이 직접 넣지 못하게 한다.
--      → 직접 INSERT 정책을 없애고, 두 RPC(decide_version·record_delivery)만 정의자 권한으로 바꾼다.
--   2) 승인본 포인터(artifacts.approved_version_id)를 직접 바꾸지 못하게 한다.
--      → artifacts 의 UPDATE 권한을 열 단위로 줄인다. invoker RPC 가 바꾸는 열(current_draft_version_id)만 남긴다.
--   3) 승인·감사 기록의 행위자(actor_id) 위조를 막는다.
--      → 실제 사용자(auth.uid() 있음)면 actor_id = auth.uid() 이어야 한다.
--        auth.uid() 가 없으면 "관리자"로 가정하지 않는다. 지금 DB 역할이 RLS를 우회할 수 있는 역할
--        (superuser 또는 bypassrls: 마이그레이션·service_role)일 때만 허용하고, 일반 역할은 거절한다.
--
-- 정의자 권한 함수의 안전 조건
--   - search_path 를 빈 값으로 고정하고 모든 이름을 스키마까지 적는다.
--   - 함수 소유자(마이그레이션 실행 역할)는 표 소유자라 RLS를 받지 않는다(FORCE RLS 없음).
--     그래서 함수 맨 앞에서 auth.uid() 가 있는지, 대상이 그 사용자의 업무실인지 직접 확인한다.
--   - public·anon 의 실행 권한을 회수하고 authenticated 에게만 준다.
--   - 나머지 invoker RPC(record_generation·save_draft_version·save_manual_version·setup_workspace)는 그대로 둔다.
--
-- 남는 위험(별도 기록): audit_events 는 invoker RPC 들이 쓰므로 직접 INSERT 정책을 유지한다.
--   본인이 자기 이름(actor = 본인)으로 감사 기록을 직접 추가하는 것은 여전히 가능하다.

-- ─────────────────────────────────────────────
-- 1) 직접 INSERT 정책 제거
-- ─────────────────────────────────────────────
drop policy if exists approvals_insert on public.approvals;
drop policy if exists delivery_records_insert on public.delivery_records;

-- ─────────────────────────────────────────────
-- 2) 승인본 포인터 직접 수정 차단 (열 단위 권한)
--    표 전체 UPDATE 를 회수하고 current_draft_version_id 만 다시 준다.
--    revision·updated_at 은 guard_update 트리거가 채우므로 권한이 필요 없다.
--    invoker RPC 의 "select … for update" 잠금도 열 하나의 UPDATE 권한으로 충분하다.
-- ─────────────────────────────────────────────
revoke update on public.artifacts from authenticated;
grant update (current_draft_version_id) on public.artifacts to authenticated;

-- ─────────────────────────────────────────────
-- 3) 행위자 강제 트리거
-- ─────────────────────────────────────────────
create or replace function app.enforce_actor() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid        uuid := auth.uid();
  privileged boolean;
begin
  if uid is not null then
    if new.actor_id is distinct from uid then
      raise exception 'ACTOR_MISMATCH: 기록의 행위자는 로그인한 본인이어야 합니다' using errcode = '42501';
    end if;
    return new;
  end if;
  -- 로그인 정보가 없을 때: 지금 역할이 RLS를 우회할 수 있는 역할인지 실제 권한으로 확인한다
  select r.rolsuper or r.rolbypassrls into privileged
    from pg_catalog.pg_roles r
   where r.rolname = current_user;
  if coalesce(privileged, false) then
    return new;
  end if;
  raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
end $$;

revoke execute on function app.enforce_actor() from public, anon, authenticated;

create trigger approvals_actor     before insert on public.approvals    for each row execute function app.enforce_actor();
create trigger audit_events_actor  before insert on public.audit_events for each row execute function app.enforce_actor();

-- ─────────────────────────────────────────────
-- 4) decide_version: 정의자 권한 + 본인 업무실 확인 (본문 규칙은 000600 과 같다)
-- ─────────────────────────────────────────────
create or replace function public.decide_version(
  p_artifact_id uuid,
  p_version_id  uuid,
  p_decision    text,
  p_comment     text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  a   public.artifacts%rowtype;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select * into a from public.artifacts where id = p_artifact_id for update;
  -- 정의자 권한은 RLS를 받지 않으므로 업무실 주인인지 직접 확인한다. 남의 것은 "없음"으로 답한다.
  if not found or not exists (
    select 1 from public.workspaces w where w.id = a.workspace_id and w.owner_user_id = uid
  ) then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.current_draft_version_id is distinct from p_version_id then
    raise exception 'CONFLICT: 최신 버전이 아닙니다. 화면을 새로 고쳐 주세요' using errcode = 'P0001';
  end if;
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'VALIDATION: 알 수 없는 결정입니다' using errcode = '22023';
  end if;

  insert into public.approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision, comment)
  values (a.workspace_id, a.id, p_version_id, uid, p_decision, nullif(trim(p_comment), ''));

  if p_decision = 'approved' then
    update public.artifacts set approved_version_id = p_version_id where id = a.id;
    perform app.move_task(a.task_id, array['review', 'completed']);
  else
    perform app.move_task(a.task_id, array['review', 'changes_requested']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (a.workspace_id, 'artifact', a.id, uid, p_decision, jsonb_build_object('version_id', p_version_id));
end $$;

revoke execute on function public.decide_version(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_version(uuid, uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────
-- 5) record_delivery: 정의자 권한 + 본인 업무실 확인 (본문 규칙은 000800 과 같다)
-- ─────────────────────────────────────────────
create or replace function public.record_delivery(
  p_artifact_id  uuid,
  p_method       text,
  p_delivered_at timestamptz,
  p_note         text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  a    public.artifacts%rowtype;
  d_id uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select * into a from public.artifacts where id = p_artifact_id;
  if not found or not exists (
    select 1 from public.workspaces w where w.id = a.workspace_id and w.owner_user_id = uid
  ) then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.approved_version_id is null then
    raise exception 'VALIDATION: 승인된 결과만 전달 기록을 남길 수 있습니다' using errcode = '22023';
  end if;
  if p_delivered_at is null or p_delivered_at > now() + interval '5 minutes' then
    raise exception 'VALIDATION: 전달 시각이 올바르지 않습니다' using errcode = '22023';
  end if;

  -- 프로젝트와 버전은 인자로 받지 않고 결과물에서 가져온다(같은 프로젝트의 승인본만 기록된다)
  insert into public.delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method, note)
  values (a.workspace_id, a.project_id, a.approved_version_id, p_delivered_at, p_method, nullif(trim(p_note), ''))
  returning id into d_id;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (a.workspace_id, 'artifact', a.id, uid, 'delivered_manual',
          jsonb_build_object('delivery_id', d_id, 'version_id', a.approved_version_id, 'method', p_method));
  return d_id;
end $$;

revoke execute on function public.record_delivery(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.record_delivery(uuid, text, timestamptz, text) to authenticated;

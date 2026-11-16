-- SEC-FIX-01-R1 정의자 함수의 조회·잠금을 "본인 업무실 행"으로 한정한다 (Master 검수 지적)
--
-- 20261116001000 의 decide_version 은 정의자 권한(RLS 미적용)으로 artifacts 를 id 만으로
-- "select … for update" 한 뒤에 주인 확인을 했다. 그러면 다른 업무실의 행도 확인 전에 잠글 수 있다.
-- 여기서는 소유 조건(auth.uid() 의 업무실)을 조회·잠금 쿼리의 WHERE 안에 넣는다.
--   - Postgres 는 FOR UPDATE 에서 WHERE 를 만족하는 행만 잠근다. 권한 없는 행은 잠금 대상이 아니다.
--   - "for update of a" 로 잠금 대상을 artifacts 행으로 한정한다(workspaces 는 EXISTS 하위 조회라 잠그지 않는다).
--   - 판정은 조회 결과(found)로만 한다. 남의 것·없는 것 모두 같은 NOT_FOUND(P0002).
-- record_delivery 도 같은 조회 방식으로 맞춘다(잠금은 원래 없음).
--
-- 이름 표기: 표·함수는 스키마(public.·app.·auth.)를 적는다. now()·trim()·nullif()·jsonb_build_object() 같은
-- 내장 함수는 스키마를 적지 않았다. 빈 search_path 에서도 pg_catalog 는 항상 먼저 찾으므로 그대로 안전하다.
-- 함수 속성(security definer, search_path = '', 실행 권한)은 20261116001000 과 같다.

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
  -- 본인 업무실의 결과물만 찾고 잠근다. 남의 행은 WHERE 에서 빠지므로 잠기지 않는다.
  select x.* into a
    from public.artifacts x
   where x.id = p_artifact_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
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
  -- 본인 업무실의 결과물만 찾는다(decide_version 과 같은 조회 조건)
  select x.* into a
    from public.artifacts x
   where x.id = p_artifact_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid);
  if not found then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.approved_version_id is null then
    raise exception 'VALIDATION: 승인된 결과만 전달 기록을 남길 수 있습니다' using errcode = '22023';
  end if;
  if p_delivered_at is null or p_delivered_at > now() + interval '5 minutes' then
    raise exception 'VALIDATION: 전달 시각이 올바르지 않습니다' using errcode = '22023';
  end if;

  insert into public.delivery_records (workspace_id, project_id, artifact_version_id, delivered_at, method, note)
  values (a.workspace_id, a.project_id, a.approved_version_id, p_delivered_at, p_method, nullif(trim(p_note), ''))
  returning id into d_id;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (a.workspace_id, 'artifact', a.id, uid, 'delivered_manual',
          jsonb_build_object('delivery_id', d_id, 'version_id', a.approved_version_id, 'method', p_method));
  return d_id;
end $$;

-- create or replace 는 기존 권한·속성을 유지하지만, 실수 방지를 위해 실행 권한을 다시 적는다
revoke execute on function public.decide_version(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_version(uuid, uuid, text, text) to authenticated;
revoke execute on function public.record_delivery(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.record_delivery(uuid, text, timestamptz, text) to authenticated;

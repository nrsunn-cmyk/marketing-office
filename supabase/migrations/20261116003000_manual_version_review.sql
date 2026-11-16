-- TASK-REVIEW-FIX-01 (BUG-CAND-01): 직접 고치기로 새 초안을 저장하면 작업을 '검토 중'으로 돌린다.
--
-- 설계 03 F05 "초안 편집 → 새 버전 저장 → 검토 → 승인", 상태 전이 표의 changes_requested → review 에 맞춘다.
-- 새 버전을 만드는 다른 두 경로(record_generation 000600, save_draft_version 000700)와 같은 규칙이다:
--   작업이 완료(completed)가 아니면 move_task(['ready', 'review']).
--   완료된 작업(승인본 있음)에서 직접 고치면 새 초안만 생기고 작업 상태·승인본은 그대로다.
-- 바뀌지 않는 것: 실행 권한(security invoker, RLS 적용), 인자·반환, revision 충돌(CONFLICT) 규칙,
--   승인본 포인터(approved_version_id)는 건드리지 않는다. 기존 마이그레이션 000600 은 고치지 않았다.

create or replace function public.save_manual_version(
  p_artifact_id       uuid,
  p_expected_revision integer,
  p_content           jsonb
) returns table (version_id uuid, version integer)
language plpgsql security invoker as $$
declare
  a      public.artifacts%rowtype;
  base   public.artifact_versions%rowtype;
  st     text;
  v_id   uuid;
  v_no   integer;
begin
  select * into a from public.artifacts where id = p_artifact_id for update;
  if not found then
    raise exception 'NOT_FOUND: 결과물을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if a.revision <> p_expected_revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;

  select * into base from public.artifact_versions where id = a.current_draft_version_id;
  select coalesce(max(av.version), 0) + 1 into v_no from public.artifact_versions av where av.artifact_id = a.id;

  insert into public.artifact_versions (workspace_id, artifact_id, version, content, input_snapshot_id, generator, template_id, created_by)
  values (a.workspace_id, a.id, v_no, p_content, base.input_snapshot_id, 'manual', base.template_id, auth.uid())
  returning id into v_id;

  update public.artifacts set current_draft_version_id = v_id where id = a.id;

  -- 새로 추가: 다른 새 버전 경로와 같은 상태 규칙
  select t.status into st from public.tasks t where t.id = a.task_id for update;
  if st <> 'completed' then
    perform app.move_task(a.task_id, array['ready', 'review']);
  end if;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, revision, details)
  values (a.workspace_id, 'artifact', a.id, auth.uid(), 'edit', v_no, jsonb_build_object('version_id', v_id));

  return query select v_id, v_no;
end $$;

revoke execute on function public.save_manual_version(uuid, integer, jsonb) from anon, public;
grant execute on function public.save_manual_version(uuid, integer, jsonb) to authenticated;

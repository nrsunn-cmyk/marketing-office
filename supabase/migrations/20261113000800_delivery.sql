-- M7 수동 전달 기록 (T18·R08)
-- 앱이 고객에게 보내는 것이 아니라, 운영자가 직접 전달한 사실을 적어 둔다.
-- 승인본만 기록할 수 있고, 기록은 승인본 버전에 고정된다(나중에 새 초안이 생겨도 무엇을 보냈는지 남는다).

create or replace function public.record_delivery(
  p_artifact_id  uuid,
  p_method       text,
  p_delivered_at timestamptz,
  p_note         text default null
) returns uuid
language plpgsql security invoker as $$
declare
  a    public.artifacts%rowtype;
  d_id uuid;
begin
  select * into a from public.artifacts where id = p_artifact_id;
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
  values (a.workspace_id, 'artifact', a.id, auth.uid(), 'delivered_manual',
          jsonb_build_object('delivery_id', d_id, 'version_id', a.approved_version_id, 'method', p_method));
  return d_id;
end $$;

revoke execute on function public.record_delivery(uuid, text, timestamptz, text) from anon, public;
grant execute on function public.record_delivery(uuid, text, timestamptz, text) to authenticated;

-- M3 업무실 처음 설정: 업무실 + 공급자(우리 회사) 정보 1번 버전을 한 번에 만든다.
-- 호출자 권한(security invoker)으로 실행되므로 RLS가 그대로 적용된다.
-- 이미 업무실이 있으면 새로 만들지 않고 기존 id를 돌려준다(중복 제출 안전).

create or replace function public.setup_workspace(
  p_name            text,
  p_legal_name      text,
  p_representative  text default null,
  p_business_number text default null,
  p_phone           text default null,
  p_email           text default null,
  p_address         text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  ws  uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_legal_name), '') = '' then
    raise exception 'VALIDATION: 업무실 이름과 상호는 필수입니다' using errcode = '22023';
  end if;

  select id into ws from public.workspaces where owner_user_id = uid;
  if found then
    return ws;
  end if;

  insert into public.workspaces (owner_user_id, name)
       values (uid, trim(p_name))
    returning id into ws;

  insert into public.supplier_profiles
         (workspace_id, version, legal_name, representative, business_number, phone, email, address)
  values (ws, 1, trim(p_legal_name), nullif(trim(p_representative), ''), nullif(trim(p_business_number), ''),
          nullif(trim(p_phone), ''), nullif(trim(p_email), ''), nullif(trim(p_address), ''));

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action)
       values (ws, 'workspace', ws, uid, 'setup');

  return ws;
end $$;

revoke execute on function public.setup_workspace(text, text, text, text, text, text, text) from anon, public;
grant execute on function public.setup_workspace(text, text, text, text, text, text, text) to authenticated;

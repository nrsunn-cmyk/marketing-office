-- WORKSPACE-RENAME-BACKEND-01(AUDIT-05 C3): 업무실 이름 바꾸기
--
-- PERM-CLEANUP(20261121014000)에서 로그인 역할의 workspaces update 권한을 회수했다(쓰기는 RPC 로만).
-- 그래서 이름만 바꾸는 정의자 RPC 하나를 둔다. 표 권한은 다시 열지 않는다.
--   - 본인 업무실(owner_user_id = auth.uid())의 name 만 바꾼다. id·소유자·만든 시각은 workspaces_guard 가 막는다
--   - p_expected_revision 이 지금 revision 과 다르면 CONFLICT(다른 화면에서 먼저 바꿈). revision·updated_at 은 guard 트리거가 올린다
--   - 이름은 앞뒤 공백을 지우고 1~200자(기존 CHECK). 같은 이름이면 바꾸지 않고 지금 revision 을 돌려준다
-- 번호(20261124009000)는 후보다. 넣는 날 운영 최신 뒤로 정한다.

create or replace function public.rename_workspace(p_name text, p_expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w public.workspaces%rowtype;
  nm text := btrim(coalesce(p_name, ''));
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 200 then
    raise exception 'VALIDATION: 업무실 이름은 1~200자여야 합니다' using errcode = '22023';
  end if;
  select * into w from public.workspaces where owner_user_id = uid for update;
  if not found then
    raise exception 'NOT_FOUND: 업무실을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if p_expected_revision is distinct from w.revision then
    raise exception 'CONFLICT: 다른 곳에서 먼저 수정되었습니다' using errcode = 'P0001';
  end if;
  if w.name = nm then
    return w.revision;
  end if;
  update public.workspaces set name = nm where id = w.id returning revision into w.revision;
  return w.revision;
end $$;
revoke execute on function public.rename_workspace(text, integer) from public, anon;
grant execute on function public.rename_workspace(text, integer) to authenticated;

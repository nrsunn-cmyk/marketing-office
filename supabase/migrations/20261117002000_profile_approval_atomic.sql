-- P2-PROFILE-APP-01-R1 프로필 버전 승인·철회를 DB 안에서 원자적으로 (Codex 검수 지적)
--
-- 문제(20261117001000): 앱 서버가 마지막 결정 순번(seq)을 읽은 뒤 따로 approve_company_profile_version 을 불렀다.
--   RPC 는 기대 순번을 받지 않고 최신 결정을 잠그거나 비교하지 않았다. 그래서 두 요청이 같은 과거 상태를 읽으면
--   둘 다 승인 기록·감사 기록을 남길 수 있었다.
-- 고치는 것:
--   1) 기존 3인자 함수(uuid, text, text)를 지운다(우회 경로·남는 실행 권한 없음).
--   2) 같은 이름의 4인자 함수(uuid, text, bigint, text)로 바꾼다. 같은 트랜잭션에서
--      - 본인 업무실의 프로필 버전 행을 "소유 조건을 WHERE 에 넣은 채" FOR UPDATE 로 잠근다(같은 버전 결정은 한 줄로 직렬화).
--      - 잠근 뒤 마지막 결정 순번을 다시 읽어 p_expected_last_seq 와 같을 때만 기록한다. 다르면 CONFLICT, 기록 0건.
--      - 전이 규칙: 이미 승인된 버전 재승인 → CONFLICT, 승인되지 않은 버전 철회 → VALIDATION.
-- 그대로 두는 것: 정의자 권한·search_path='', auth.uid() 확인, 행위자 = 본인(enforce_actor), 추가 전용 승인·감사 기록,
--   public·anon 실행 회수. 프로필 버전 본문은 reject_mutation 트리거로 이미 DB 수준 불변(20261113000100 583–596행)이라
--   잠근 행의 내용이 곧 승인되는 내용이다.
-- 같은 요청 재전송: 첫 요청이 기록되면 순번이 바뀌므로 재전송은 CONFLICT 이고 기록은 늘지 않는다(멱등 결과 = 추가 0건).

drop function if exists public.approve_company_profile_version(uuid, text, text);

create or replace function public.approve_company_profile_version(
  p_profile_version_id uuid,
  p_decision           text,
  p_expected_last_seq  bigint,
  p_comment            text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  pv   public.company_profile_versions%rowtype;
  last public.company_profile_approvals%rowtype;
  s    bigint;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'revoked') then
    raise exception 'VALIDATION: 알 수 없는 결정입니다' using errcode = '22023';
  end if;
  if p_expected_last_seq is null or p_expected_last_seq < 0 then
    raise exception 'VALIDATION: 기대 순번이 올바르지 않습니다' using errcode = '22023';
  end if;

  -- 본인 업무실의 버전만 찾고 잠근다. 남의 행은 WHERE 에서 빠지므로 잠기지 않는다.
  select x.* into pv
    from public.company_profile_versions x
   where x.id = p_profile_version_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 프로필을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  -- 잠근 뒤 다시 읽는다(앞선 트랜잭션이 커밋한 결정이 보인다)
  select a.* into last
    from public.company_profile_approvals a
   where a.company_profile_version_id = pv.id
   order by a.seq desc
   limit 1;
  if coalesce(last.seq, 0) <> p_expected_last_seq then
    raise exception 'CONFLICT: 그 사이 이 버전에 다른 결정이 기록되었습니다' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and last.decision = 'approved' then
    raise exception 'CONFLICT: 이미 승인된 버전입니다' using errcode = 'P0001';
  end if;
  if p_decision = 'revoked' and last.decision is distinct from 'approved' then
    raise exception 'VALIDATION: 승인된 버전만 철회할 수 있습니다' using errcode = '22023';
  end if;

  insert into public.company_profile_approvals (workspace_id, client_id, company_profile_version_id, actor_id, decision, comment)
  values (pv.workspace_id, pv.client_id, pv.id, uid, p_decision, nullif(trim(p_comment), ''))
  returning seq into s;

  insert into public.audit_events (workspace_id, entity_type, entity_id, actor_id, action, details)
  values (pv.workspace_id, 'company_profile_version', pv.id, uid, 'profile_' || p_decision,
          jsonb_build_object('client_id', pv.client_id, 'version', pv.version, 'seq', s));
  return s;
end $$;

revoke execute on function public.approve_company_profile_version(uuid, text, bigint, text) from public, anon;
grant execute on function public.approve_company_profile_version(uuid, text, bigint, text) to authenticated;

-- DEC09-CLIENT-ASSETS-01: 콘텐츠 브리프 근거로 "같은 고객의 공통 자료"를 허용한다(주인님 DEC-09 B, 2026-11-19).
-- 판단 자료: Plan/Claude-Backend-20261118/DEC-PREP-08-09.md DEC-09 절.
--
-- 바뀌는 것: public.link_claim_source 의 asset 분기만.
--   전: 자료의 project_id = 브리프 project_id
--   후: 위 조건, 또는 (자료 project_id 가 없고 자료 client_id = 브리프 프로젝트의 client_id)
--   감사 source_link details 에 asset 일 때 scope('project'|'client')를 더한다.
-- 바뀌지 않는 것: 표·열·제약·RLS·권한(grant), profile·research 분기, 중복·10개 한도, 해제 함수, 다른 RPC.
--   source_assets.client_id·project_id 와 projects.client_id 는 guard_update 로 바뀌지 않아 한 번 연결한 "같은 고객" 관계는 고정된다.
-- 되돌리기: 22번(20261118002000_p2f_content_brief.sql)의 link_claim_source 정의로 다시 create or replace.
--   이미 만든 공통 자료 연결 행은 남는다(해제는 표시만, 삭제 없음).

create or replace function public.link_claim_source(
  p_claim_id      uuid,
  p_kind          text,
  p_target_id     uuid,
  p_profile_field text default null,
  p_note          text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  c    public.content_brief_claims%rowtype;
  b    public.content_briefs%rowtype;
  nt   text;
  n    integer;
  s_id uuid;
  scope text; -- asset 근거의 범위: 'project' | 'client'(DEC-09)
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED: 로그인 정보가 없습니다' using errcode = '42501';
  end if;
  select x.* into c
    from public.content_brief_claims x
   where x.id = p_claim_id
     and exists (select 1 from public.workspaces w where w.id = x.workspace_id and w.owner_user_id = uid)
     for update of x;
  if not found then
    raise exception 'NOT_FOUND: 주장을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if c.archived_at is not null then
    raise exception 'INVALID_TRANSITION: 보관한 주장에는 근거를 연결할 수 없습니다' using errcode = 'P0001';
  end if;
  perform app.assert_brief_open(c.brief_id);
  select * into b from public.content_briefs where id = c.brief_id;
  nt := app.brief_text(p_note, 300, '근거 메모');

  if p_kind = 'profile' then
    if p_profile_field is null or p_profile_field not in ('products', 'audience', 'strengths', 'brand_rules', 'channel_urls') then
      raise exception 'VALIDATION: 알 수 없는 프로필 항목입니다' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.artifact_versions v
       where v.id = b.strategy_version_id and v.content #>> '{profileRef,id}' = p_target_id::text
    ) or not exists (select 1 from public.company_profile_versions pv where pv.id = p_target_id and pv.workspace_id = b.workspace_id) then
      raise exception 'SOURCE_MISMATCH: 브리프가 참조한 전략의 회사 프로필 버전만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  elsif p_kind = 'asset' then
    -- DEC-09 B: 이 프로젝트 자료, 또는 프로젝트 없이 올린 "같은 고객 공통 자료"만. 다른 프로젝트 자료·다른 고객·남의 업무실은 같은 문구.
    -- 고객 없는 프로젝트(internal_brand·personal)는 p.client_id 가 null 이라 공통 자료 조건이 성립하지 않는다.
    select case when a.project_id = b.project_id then 'project' else 'client' end into scope
      from public.source_assets a
      join public.projects p on p.id = b.project_id and p.workspace_id = b.workspace_id
     where a.id = p_target_id and a.workspace_id = b.workspace_id
       and (a.project_id = b.project_id or (a.project_id is null and a.client_id = p.client_id));
    if p_profile_field is not null or scope is null then
      raise exception 'SOURCE_MISMATCH: 이 프로젝트의 자료나 같은 고객의 공통 자료만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  elsif p_kind = 'research' then
    if p_profile_field is not null or not exists (
      select 1 from public.research_sources rs where rs.id = p_target_id and rs.workspace_id = b.workspace_id and rs.project_id = b.project_id
    ) then
      raise exception 'SOURCE_MISMATCH: 이 프로젝트의 외부 출처만 근거로 쓸 수 있습니다' using errcode = 'P0001';
    end if;
  else
    raise exception 'VALIDATION: 알 수 없는 근거 종류입니다' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.content_claim_sources s
     where s.claim_id = c.id and s.unlinked_at is null and s.kind = p_kind
       and coalesce(s.company_profile_version_id, s.source_asset_id, s.research_source_id) = p_target_id
       and s.profile_field is not distinct from p_profile_field
  ) then
    raise exception 'VALIDATION: 이미 연결한 근거입니다' using errcode = '22023';
  end if;
  select count(*) into n from public.content_claim_sources s where s.claim_id = c.id and s.unlinked_at is null;
  if n >= 10 then
    raise exception 'VALIDATION: 한 주장에는 근거를 10개까지 연결할 수 있습니다' using errcode = '22023';
  end if;

  insert into public.content_claim_sources (workspace_id, claim_id, kind, company_profile_version_id, profile_field, source_asset_id, research_source_id, note, created_by)
  values (c.workspace_id, c.id, p_kind,
          case when p_kind = 'profile' then p_target_id end, case when p_kind = 'profile' then p_profile_field end,
          case when p_kind = 'asset' then p_target_id end, case when p_kind = 'research' then p_target_id end, nt, uid)
  returning id into s_id;
  perform app.brief_audit(c.workspace_id, c.brief_id, 'source_link', null,
                          jsonb_build_object('claim_id', c.id, 'source_id', s_id, 'kind', p_kind, 'target_id', p_target_id)
                            || case when scope is null then '{}'::jsonb else jsonb_build_object('scope', scope) end);
  return s_id;
end $$;

revoke execute on function public.link_claim_source(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.link_claim_source(uuid, text, uuid, text, text) to authenticated;

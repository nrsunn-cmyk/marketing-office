-- M2 행 수준 보안(RLS)
-- 로그인한 본인(authenticated)만 자기 업무실 행을 보고 쓸 수 있다. 비로그인(anon)은 아무것도 못 한다.
-- 주의(C05): 요청 처리 코드는 service_role 키로 접속하지 않는다. service_role은 RLS를 우회한다.
-- DELETE 정책은 두지 않는다. P1에는 삭제 기능이 없고, 보관(archived)으로 대신한다.

grant usage on schema app to authenticated;
grant select on app.machine_states, app.state_transitions to authenticated;

-- 현재 사용자가 해당 업무실의 주인인지
create or replace function app.owns_workspace(ws uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = ws and w.owner_user_id = auth.uid()
  )
$$;
grant execute on function app.owns_workspace(uuid) to authenticated;

alter table public.workspaces enable row level security;
create policy workspaces_select on public.workspaces for select to authenticated using (owner_user_id = auth.uid());
create policy workspaces_insert on public.workspaces for insert to authenticated with check (owner_user_id = auth.uid());
create policy workspaces_update on public.workspaces for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- 템플릿: 시스템 공용, 읽기만
alter table public.templates enable row level security;
create policy templates_select on public.templates for select to authenticated using (true);

-- 업무실 소속 테이블
do $$
declare
  t text;
  writable text[] := array[
    'clients', 'projects', 'source_assets', 'tasks', 'generation_runs',
    'artifacts', 'exports', 'quotes', 'quote_number_sequences'
  ];
  append_only text[] := array[
    'supplier_profiles', 'company_profile_versions', 'project_profiles',
    'task_input_snapshots', 'artifact_versions', 'approvals',
    'quote_versions', 'quote_items', 'delivery_records', 'audit_events'
  ];
begin
  foreach t in array writable || append_only loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app.owns_workspace(workspace_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.owns_workspace(workspace_id))',
      t || '_insert', t);
  end loop;
  foreach t in array writable loop
    execute format(
      'create policy %I on public.%I for update to authenticated using (app.owns_workspace(workspace_id)) with check (app.owns_workspace(workspace_id))',
      t || '_update', t);
  end loop;
end $$;

-- 비로그인 역할은 public 테이블에 접근하지 않는다 (RLS 이전 단계에서 한 번 더 차단)
revoke all on all tables in schema public from anon;
revoke execute on function public.assign_quote_number(uuid, date) from anon, public;
grant execute on function public.assign_quote_number(uuid, date) to authenticated;

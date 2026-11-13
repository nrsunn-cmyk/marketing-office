-- M4 자료 파일 저장소 (비공개)
-- 경로 규칙: {workspace_id}/{asset_id}/original.{확장자}
-- 첫 폴더가 본인 업무실 id 일 때만 올리고 읽을 수 있다. 수정·삭제 정책은 두지 않는다(파일도 추가만).
-- 파일 형식·크기 제한(D05): PDF·PNG·JPEG·TXT, 10MB. 앱 서버도 같은 규칙으로 내용(시그니처)까지 다시 검사한다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('source-assets', 'source-assets', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do nothing;

-- 문자열을 uuid로 바꾸되 형식이 틀리면 오류 대신 null
create or replace function app.try_uuid(value text) returns uuid
language plpgsql immutable as $$
begin
  return value::uuid;
exception when others then
  return null;
end $$;

-- 저장소 경로의 첫 폴더가 현재 사용자의 업무실인지
create or replace function app.owns_storage_path(object_name text) returns boolean
language sql stable as $$
  select app.owns_workspace(app.try_uuid(split_part(object_name, '/', 1)))
$$;

grant execute on function app.try_uuid(text) to authenticated;
grant execute on function app.owns_storage_path(text) to authenticated;

create policy source_assets_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'source-assets' and app.owns_storage_path(name));

create policy source_assets_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'source-assets' and app.owns_storage_path(name));

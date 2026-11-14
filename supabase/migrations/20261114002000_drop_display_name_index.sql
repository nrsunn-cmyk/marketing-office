-- CR12 (Codex CR07·CR08 재검수): 표시 이름 B-tree 인덱스를 없앤다.
-- 제목 없는 링크는 표시 이름에 주소 전체가 들어간다. 앱이 허용하는 2,000자 한글 주소는 5,000바이트가 넘어
-- B-tree 한 칸 한도(약 2,700바이트)를 넘고 저장 자체가 실패했다(오류 54000).
-- 검색은 '%검색어%'(앞에 %)라 B-tree 인덱스를 쓰지 못한다. 즉 이 인덱스는 이득 없이 저장만 막았다.
-- 저장 한도는 줄이지 않는다. 자료가 아주 많아지면 길이 제한이 없는 pg_trgm(GIN) 인덱스를 검토한다.
drop index if exists public.source_assets_display_name_idx;

-- 대신 자료실 목록이 실제로 쓰는 순서(업무실 → 최신순 → 고유번호)에 맞춘 인덱스. 키가 짧아 길이 문제가 없다.
create index if not exists source_assets_workspace_created_idx
  on public.source_assets (workspace_id, created_at desc, id desc);

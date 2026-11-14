-- CR08 (Codex M12 검수): 화면에 보이는 자료 이름으로 검색되게 한다.
-- 화면 표시 규칙과 같은 '표시 이름'을 DB가 자동으로 계산해 둔다: 제목 → 없으면 링크 주소 → 없으면 메모 앞부분(200자).
-- 자동 계산 칸(generated column)이라 앱이 따로 채우지 않아도 항상 표시 규칙과 같다.

alter table public.source_assets
  add column display_name text
  generated always as (coalesce(nullif(btrim(file_name), ''), url, left(text_content, 200))) stored;

create index source_assets_display_name_idx on public.source_assets (workspace_id, display_name);

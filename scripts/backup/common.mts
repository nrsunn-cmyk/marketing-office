/**
 * 백업·복원 공통 도구 (T20). 관리자 키(SUPABASE_SECRET_KEY)를 쓰는 운영 스크립트이며 앱 코드에서 쓰지 않는다 (C05).
 */
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "source-assets";
export const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_marketing-office";

/** 백업 대상 업무 테이블 (개수 비교용) */
export const TABLES = [
  "workspaces",
  "supplier_profiles",
  "clients",
  "company_profile_versions",
  "projects",
  "project_profiles",
  "source_assets",
  "tasks",
  "task_input_snapshots",
  "generation_runs",
  "artifacts",
  "artifact_versions",
  "approvals",
  "quotes",
  "quote_number_sequences",
  "quote_versions",
  "quote_items",
  "exports",
  "delivery_records",
  "audit_events",
] as const;

export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 필요합니다 (.env.local).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function run(cmd: string, args: string[], input?: string): string {
  // 셸을 거치지 않고 실행한다(인자 문자열이 명령으로 해석되지 않게)
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 실패: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** 로컬 DB 컨테이너에서 SQL 실행 (관리자 권한). */
export function psql(sql: string): string {
  return run("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql);
}

export async function tableCounts(sb: SupabaseClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${t} 개수 조회 실패: ${error.message}`);
    out[t] = count ?? 0;
  }
  return out;
}

export interface StoredFile {
  key: string;
  mime: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  createdAt: string;
  counts: Record<string, number>;
  files: StoredFile[];
  quoteTotalWon: number;
}

/** 모든 외래키에 대해 부모 없는 행이 있는지 검사하는 SQL. 하나라도 있으면 오류. */
export const ORPHAN_CHECK_SQL = `
do $$
declare r record; n bigint; bad text := '';
begin
  for r in
    select c.conname, c.conrelid::regclass as child, c.confrelid::regclass as parent,
      (select string_agg(format('ch.%I', a.attname), ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as ccols,
      (select string_agg(format('p.%I', a.attname), ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as pcols,
      (select string_agg(format('ch.%I is not null', a.attname), ' and ') from unnest(c.conkey) k(attnum)
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as notnull
    from pg_constraint c join pg_namespace s on s.oid = c.connamespace
    where c.contype = 'f' and s.nspname = 'public'
  loop
    execute format('select count(*) from %s ch where %s and not exists (select 1 from %s p where (%s) = (%s))',
                   r.child, r.notnull, r.parent, r.pcols, r.ccols) into n;
    if n > 0 then bad := bad || format('%s: %s건; ', r.conname, n); end if;
  end loop;
  if bad <> '' then raise exception 'ORPHANS: %', bad; end if;
end $$;
select 'orphan-check-ok';
`;

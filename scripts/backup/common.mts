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

/**
 * 백업 대상 하나 정하기 (BACKUP-OPS-01, Codex 검수).
 * DB 내보내기(dump)와 파일·API 조회가 반드시 같은 Supabase를 보게 한다. 섞이거나 애매하면 시작 전에 멈춘다.
 * - 로컬: API 주소가 127.0.0.1·localhost 이고 원격 설정(BACKUP_DB_URL·BACKUP_REMOTE)이 없을 때.
 * - 운영: API 주소가 https://<ref>.supabase.co 이고, BACKUP_DB_URL(DB 연결 주소)이 같은 <ref> 를 가리킬 때.
 *   DB 연결 주소는 직접 연결(db.<ref>.supabase.co) 또는 공유 연결(사용자 이름 postgres.<ref>) 모양을 받는다.
 * 돌려주는 값에는 비밀값을 넣지 않는다(목록에 기록용 ref 만). dump 인자에만 연결 주소가 들어간다.
 */
export type BackupTarget =
  | { kind: "local"; label: "local"; dumpArgs: string[] }
  | { kind: "remote"; label: string; dumpArgs: string[] };

export function resolveBackupTarget(env: Record<string, string | undefined> = process.env): BackupTarget {
  const api = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const dbUrl = env.BACKUP_DB_URL ?? "";
  const remoteFlag = env.BACKUP_REMOTE === "1";

  if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(api)) {
    if (dbUrl || remoteFlag) {
      throw new Error("API 주소는 로컬인데 원격 설정(BACKUP_DB_URL 또는 BACKUP_REMOTE)이 있습니다. 서로 다른 DB가 섞이지 않도록 멈춥니다.");
    }
    return { kind: "local", label: "local", dumpArgs: [] };
  }

  const apiRef = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(api)?.[1];
  if (!apiRef) throw new Error(`알 수 없는 Supabase API 주소입니다(${api ? "형식 불일치" : "비어 있음"}). 멈춥니다.`);
  if (!dbUrl) {
    throw new Error("운영 백업에는 BACKUP_DB_URL(DB 연결 주소)이 필요합니다. 없으면 DB를 다른 곳에서 받을 수 있어 멈춥니다.");
  }

  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("BACKUP_DB_URL 형식이 올바르지 않습니다(postgresql://… 모양이어야 함).");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("BACKUP_DB_URL은 postgresql:// 주소여야 합니다.");
  const hostRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  const userRef = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))?.[1];
  const dbRef = hostRef ?? userRef;
  if (!dbRef) throw new Error("BACKUP_DB_URL에서 Supabase 프로젝트를 알 수 없습니다(db.<ref>.supabase.co 또는 사용자 postgres.<ref>).");
  if (dbRef !== apiRef) {
    throw new Error(`API 주소의 프로젝트(${apiRef})와 BACKUP_DB_URL의 프로젝트(${dbRef})가 다릅니다. 서로 다른 DB가 섞이지 않도록 멈춥니다.`);
  }
  return { kind: "remote", label: apiRef, dumpArgs: [`--remote=${dbUrl}`] };
}

/**
 * 검증용 SQL 실행 (관리자 권한).
 * - 로컬: 로컬 DB 컨테이너
 * - 원격: BACKUP_DB_URL(운영 DB 연결 주소)이 꼭 있어야 한다. 없으면 실행하지 않는다.
 *   (API는 원격을 보는데 SQL만 로컬을 보면 서로 다른 DB를 검사하게 된다 — Codex 검수 지적)
 *   psql 프로그램은 로컬 DB 컨테이너 안의 것을 빌려 쓴다.
 */
export function psql(sql: string): string {
  // 백업과 같은 규칙으로 대상을 정한다(로컬/운영 섞임·프로젝트 불일치면 여기서 멈춤)
  const backupTarget = resolveBackupTarget();
  const remote = backupTarget.kind === "remote" ? process.env.BACKUP_DB_URL : undefined;
  const connection = remote ? [remote] : ["-U", "postgres", "-d", "postgres"];
  return run("docker", ["exec", "-i", DB_CONTAINER, "psql", ...connection, "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql);
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
  /** 백업한 곳: "local" 또는 운영 프로젝트 ref (비밀값 아님). 예전 백업에는 없을 수 있다 */
  target?: string;
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

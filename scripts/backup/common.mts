/**
 * 백업·복원 공통 도구 (T20). 관리자 키(SUPABASE_SECRET_KEY)를 쓰는 운영 스크립트이며 앱 코드에서 쓰지 않는다 (C05).
 */
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "source-assets";
export const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_marketing-office";

/**
 * 백업 대상 public 표 전체 (행 수 비교용). BACKUP-P2-TABLES-01: migration 이 만드는 표를 빠짐없이 둔다.
 * - DB 내보내기(supabase db dump --data-only)는 원래 public 표 전체를 담는다. 이 목록은 행 수 검증 범위다.
 * - 백업·검증 때 DB 의 실제 public 표를 읽어, 이 목록에 없는 표가 있으면 멈춘다(새 migration 이 표를 더했는데 목록을 안 고친 경우).
 * - LATER_TABLES 는 뒤 migration(21 퍼널·22 브리프)이 만드는 표다. 아직 그 migration 이 없는 DB 에서는 없어도 된다.
 */
export const LATER_TABLES = [
  // 20261118001000_p2d_funnel_board
  "funnels",
  "funnel_stages",
  "funnel_items",
  // 20261118002000_p2f_content_brief
  "content_briefs",
  "content_brief_claims",
  "content_claim_sources",
] as const;

export const TABLES = [
  "signup_allowlist",
  "templates",
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
  // P2 전략(20261117001000)
  "company_profile_approvals",
  "artifact_version_refs",
  "research_sources",
  ...LATER_TABLES,
] as const;

/** DB 의 실제 public 표 목록(일반·분할 표) */
export const LIST_TABLES_SQL = "select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1;";

/**
 * 표 목록 대조: DB 에 있는데 TABLES 에 없는 표가 있으면 오류(누락 시 실패).
 * TABLES 에 있는데 DB 에 없는 표는 LATER_TABLES 만 허용한다(아직 뒤 migration 이 없는 DB).
 * 돌려주는 값: 행 수를 셀 표(DB 에 있는 것, TABLES 순서)
 */
export function checkTableCoverage(dbTables: readonly string[]): string[] {
  const known = new Set<string>(TABLES);
  const later = new Set<string>(LATER_TABLES);
  const db = new Set(dbTables);
  const unknown = [...db].filter((t) => !known.has(t)).sort();
  if (unknown.length > 0) {
    throw new Error(`백업 목록에 없는 표가 DB에 있습니다: ${unknown.join(", ")}. scripts/backup/common.mts 의 TABLES 에 넣은 뒤 다시 실행하세요.`);
  }
  const missing = TABLES.filter((t) => !db.has(t) && !later.has(t));
  if (missing.length > 0) {
    throw new Error(`DB에 있어야 할 표가 없습니다: ${missing.join(", ")}. 대상 DB의 migration 상태를 확인하세요.`);
  }
  return TABLES.filter((t) => db.has(t));
}

/** 대상 DB 의 public 표 목록(psql, 백업과 같은 대상 규칙) */
export function listDbTables(): string[] {
  return psql(LIST_TABLES_SQL)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 필요합니다 (.env.local).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type EnvMap = Record<string, string | undefined>;

export interface RunOptions {
  /** 자식 프로세스 환경. 주지 않으면 현재 환경을 그대로 물려준다 */
  env?: EnvMap;
  /** 실패 메시지에서 가릴 비밀값(BACKUP-SECRET-01) */
  secrets?: string[];
}

const redact = (text: string, secrets: string[] = []) =>
  secrets.filter((s) => s.length > 0).reduce((t, s) => t.split(s).join("<비밀값 가림>"), text);

export function run(cmd: string, args: string[], input?: string, options: RunOptions = {}): string {
  // 셸을 거치지 않고 실행한다(인자 문자열이 명령으로 해석되지 않게)
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: options.env as NodeJS.ProcessEnv | undefined });
  if (r.status !== 0) throw new Error(redact(`${cmd} ${args.join(" ")} 실패: ${r.stderr || r.stdout}`, options.secrets));
  return r.stdout;
}

/**
 * BACKUP-SECRET-01: 운영 DB 연결 주소를 비밀번호와 나머지로 나눈다.
 * 명령 인자(argv)에는 비밀번호 없는 값만 쓰고, 비밀번호는 환경 변수(덤프) 또는 표준 입력(psql)으로만 넘긴다.
 * - redactedUrl: 비밀번호를 뺀 URL(supabase db dump --remote= 용). CLI 3.1 은 이때 PGPASSWORD 환경 변수를 쓴다(dry-run 확인).
 * - conninfo: 비밀번호 없는 libpq 접속 문자열(psql 인자 용)
 */
export interface DbUrlParts {
  redactedUrl: string;
  password: string;
  conninfo: string;
}

const CONNINFO_PARAMS = new Set(["sslmode", "connect_timeout", "application_name"]);
const conninfoValue = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function splitDbUrl(dbUrl: string): DbUrlParts {
  let u: URL;
  try {
    u = new URL(dbUrl);
  } catch {
    throw new Error("BACKUP_DB_URL 형식이 올바르지 않습니다(postgresql://… 모양이어야 함).");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("BACKUP_DB_URL은 postgresql:// 주소여야 합니다.");
  const password = decodeURIComponent(u.password);
  if (!password) throw new Error("BACKUP_DB_URL에 비밀번호가 없습니다. 대시보드의 연결 문자열에 실제 비밀번호를 넣어야 합니다.");
  if (/[\r\n\0]/.test(password)) throw new Error("BACKUP_DB_URL 비밀번호에 줄바꿈·NUL 문자가 있어 안전하게 넘길 수 없습니다.");
  const user = decodeURIComponent(u.username);
  const dbname = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const parts: Array<[string, string]> = [
    ["host", u.hostname],
    ["port", u.port || "5432"],
    ["user", user],
    ["dbname", dbname],
  ];
  for (const [k, v] of u.searchParams) {
    if (!CONNINFO_PARAMS.has(k)) throw new Error(`BACKUP_DB_URL의 '${k}' 설정은 지원하지 않습니다(sslmode·connect_timeout·application_name 만).`);
    parts.push([k, v]);
  }
  const redacted = new URL(u.toString());
  redacted.password = "";
  return {
    redactedUrl: redacted.toString(),
    password,
    conninfo: parts.map(([k, v]) => `${k}=${conninfoValue(v)}`).join(" "),
  };
}

/** 자식 프로세스에 넘길 환경: 비밀을 담은 BACKUP_DB_URL·SUPABASE_SECRET_KEY 는 빼고, 필요한 값만 더한다 */
export function childEnv(extra: Record<string, string> = {}, base: EnvMap = process.env): EnvMap {
  const env: EnvMap = { ...base };
  delete env.BACKUP_DB_URL;
  delete env.SUPABASE_SECRET_KEY;
  delete env.PGPASSWORD;
  return { ...env, ...extra };
}

/**
 * DB 데이터 내보내기(supabase db dump). 원격이면 인자에는 비밀번호 없는 URL(target.dumpArgs)만 두고,
 * 비밀번호는 자식 환경의 PGPASSWORD 로만 넘긴다(CLI 3.1 dry-run 으로 PGPASSWORD 사용 확인, BACKUP-SECRET-01).
 */
export function runDump(file: string, target: BackupTarget, env: EnvMap = process.env): void {
  const args = ["db", "dump", "--data-only", "--schema", "public,auth", "-f", file, ...target.dumpArgs];
  if (target.kind === "local") {
    run("supabase", args);
    return;
  }
  const { password } = splitDbUrl(env.BACKUP_DB_URL ?? "");
  run("supabase", args, undefined, { env: childEnv({ PGPASSWORD: password }, env), secrets: [password] });
}

/** psql 을 컨테이너 안에서 실행: 표준 입력 첫 줄을 PGPASSWORD 로 읽고, 나머지 입력은 psql 이 SQL 로 읽는다 */
export const PSQL_STDIN_PASSWORD_SCRIPT = 'IFS= read -r PGPASSWORD || exit 2; export PGPASSWORD; exec psql "$@"';

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

  const split = splitDbUrl(dbUrl); // 형식·비밀번호 확인(비밀번호는 여기서 돌려주지 않는다)
  const parsed = new URL(split.redactedUrl);
  const hostRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
  const userRef = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))?.[1];
  const dbRef = hostRef ?? userRef;
  if (!dbRef) throw new Error("BACKUP_DB_URL에서 Supabase 프로젝트를 알 수 없습니다(db.<ref>.supabase.co 또는 사용자 postgres.<ref>).");
  if (dbRef !== apiRef) {
    throw new Error(`API 주소의 프로젝트(${apiRef})와 BACKUP_DB_URL의 프로젝트(${dbRef})가 다릅니다. 서로 다른 DB가 섞이지 않도록 멈춥니다.`);
  }
  // BACKUP-SECRET-01: 명령 인자에는 비밀번호 없는 URL만. 비밀번호는 덤프 때 PGPASSWORD 환경 변수로 넘긴다(backup.mts)
  return { kind: "remote", label: apiRef, dumpArgs: [`--remote=${split.redactedUrl}`] };
}

/**
 * 검증용 SQL 실행 (관리자 권한).
 * - 로컬: 로컬 DB 컨테이너
 * - 원격: BACKUP_DB_URL(운영 DB 연결 주소)이 꼭 있어야 한다. 없으면 실행하지 않는다.
 *   (API는 원격을 보는데 SQL만 로컬을 보면 서로 다른 DB를 검사하게 된다 — Codex 검수 지적)
 *   psql 프로그램은 컨테이너(SUPABASE_DB_CONTAINER, 운영 때는 본인 전용 클라이언트) 안의 것을 빌려 쓴다.
 */
export function psql(sql: string): string {
  // 백업과 같은 규칙으로 대상을 정한다(로컬/운영 섞임·프로젝트 불일치면 여기서 멈춤)
  const backupTarget = resolveBackupTarget();
  if (backupTarget.kind === "local") {
    return run("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], sql);
  }
  // BACKUP-SECRET-01: 비밀번호는 docker·psql 명령 인자에 넣지 않고 표준 입력 첫 줄로 넘긴다(컨테이너 안 sh 가 읽어 PGPASSWORD 로).
  // docker exec -e NAME=값 도 인자에 값이 보이므로 쓰지 않는다.
  const { conninfo, password } = splitDbUrl(process.env.BACKUP_DB_URL ?? "");
  return run(
    "docker",
    ["exec", "-i", DB_CONTAINER, "sh", "-c", PSQL_STDIN_PASSWORD_SCRIPT, "sh", conninfo, "-v", "ON_ERROR_STOP=1", "-At", "-q"],
    `${password}\n${sql}`,
    { env: childEnv(), secrets: [password] },
  );
}

export async function tableCounts(sb: SupabaseClient, tables: readonly string[] = TABLES): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
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

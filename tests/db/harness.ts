/**
 * DB 테스트 도구: PGlite(메모리 Postgres)에 Supabase 흉내 + 실제 마이그레이션을 적용한다.
 * Docker 없이 스키마·제약·트리거·RLS를 검증한다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { expect } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

export type Db = PGlite;
export type Tx = Transaction;
type Queryable = Pick<PGlite, "query" | "exec">;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (e) {
      throw new Error(`마이그레이션 실패: ${file}: ${(e as Error).message}`);
    }
  }
  return db;
}

/** 관리자(superuser) 권한으로 한 줄을 넣고 결과 행을 돌려준다. RLS를 거치지 않는다. */
export async function one<T = Record<string, unknown>>(q: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const r = await q.query<T>(sql, params);
  if (r.rows.length !== 1) throw new Error(`행 1개를 기대했지만 ${r.rows.length}개: ${sql}`);
  return r.rows[0];
}

export async function createUser(db: Db, email: string): Promise<string> {
  // 가입 허용 목록에 있어야 계정을 만들 수 있다(20261115001000_signup_allowlist)
  await db.query("insert into public.signup_allowlist (email) values (lower($1)) on conflict do nothing", [email]);
  return (await one<{ id: string }>(db, "insert into auth.users (email) values ($1) returning id", [email])).id;
}

/**
 * 로그인한 사용자(authenticated) 또는 비로그인(anon) 권한으로 실행한다.
 * 함수 안에서 오류가 나면 트랜잭션은 되돌려진다.
 */
export async function asUser<T>(db: Db, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    if (userId) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

/**
 * 준비 데이터를 관리자 권한으로 넣는다(asUser 트랜잭션 안에서 잠깐 역할을 풀었다가 다시 authenticated 로).
 * 앱에서 정의자 RPC 가 쓰는 표(결과물·버전 등)는 로그인 역할에 쓰기 권한이 없다(PERM-CLEANUP-01). 시험 준비만 이 길로 넣는다.
 */
export async function asSetup<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const before = (await one<{ r: string }>(tx, "select current_user as r")).r;
  await tx.exec("reset role");
  // 오류면 트랜잭션이 이미 중단돼 되돌릴 수 없다(어차피 롤백). 성공했을 때만 들어오기 전 역할로 되돌린다
  const r = await fn();
  if (before !== (await one<{ r: string }>(tx, "select current_user as r")).r) await tx.exec(`set local role ${before}`);
  return r;
}

/** 로그인 역할 직접 쓰기가 권한 단계에서 거절될 때의 문구(PERM-CLEANUP-01 뒤에는 RLS 보다 먼저 막힌다) */
export const DENIED = /permission denied for table|row-level security/;

/** DB 오류 메시지가 패턴과 맞는지 확인한다. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown = null;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  expect(error, `오류를 기대했지만 성공함 (${pattern})`).not.toBeNull();
  expect((error as Error).message).toMatch(pattern);
}

export interface Fixture {
  userId: string;
  workspaceId: string;
  clientA: string;
  clientB: string;
  profileA1: string;
  profileB1: string;
  projectA: string;
  projectB: string;
  logoTemplateId: string;
  quoteTemplateId: string;
}

/** 사용자 1명, 업무실 1개, 가상 고객 A/B와 각자의 프로필·프로젝트 (D09 가상 고객 2개). 본인 권한으로 만든다. */
export async function seedOwner(db: Db, email = "owner@example.test"): Promise<Fixture> {
  const userId = await createUser(db, email);
  // 업무실은 앱에서 정의자 RPC(setup_workspace)로만 만든다. 로그인 역할에는 workspaces 쓰기 권한이 없다(PERM-CLEANUP-01)
  const workspaceId = (await one<{ id: string }>(db, "insert into workspaces (owner_user_id, name) values ($1, '내 업무실') returning id", [userId])).id;
  return asUser(db, userId, async (tx) => {
    const client = async (name: string) =>
      (await one<{ id: string }>(tx, "insert into clients (workspace_id, name) values ($1, $2) returning id", [workspaceId, name])).id;
    const clientA = await client("가상고객A 베이커리");
    const clientB = await client("가상고객B 세무회계");
    const profile = async (clientId: string, products: string) =>
      (
        await one<{ id: string }>(
          tx,
          "insert into company_profile_versions (workspace_id, client_id, version, products) values ($1, $2, 1, $3) returning id",
          [workspaceId, clientId, products],
        )
      ).id;
    const profileA1 = await profile(clientA, "식빵");
    const profileB1 = await profile(clientB, "기장 대행");
    const project = async (clientId: string, title: string) =>
      (
        await one<{ id: string }>(
          tx,
          "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', $3) returning id",
          [workspaceId, clientId, title],
        )
      ).id;
    const projectA = await project(clientA, "A 로고");
    const projectB = await project(clientB, "B 견적");
    const tpl = async (key: string) => (await one<{ id: string }>(tx, "select id from templates where key = $1", [key])).id;
    return {
      userId,
      workspaceId,
      clientA,
      clientB,
      profileA1,
      profileB1,
      projectA,
      projectB,
      logoTemplateId: await tpl("logo-template@1"),
      quoteTemplateId: await tpl("quote-template@1"),
    };
  });
}

let keySeq = 0;
export const newKey = () => `idem-key-${Date.now()}-${++keySeq}`;

export async function createTask(
  tx: Tx,
  f: Fixture,
  projectId: string,
  type: "logo_brief" | "quote" = "logo_brief",
): Promise<string> {
  const templateId = type === "logo_brief" ? f.logoTemplateId : f.quoteTemplateId;
  return (
    await one<{ id: string }>(
      tx,
      "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, $3, $4, $5) returning id",
      [f.workspaceId, projectId, type, templateId, newKey()],
    )
  ).id;
}

export async function createArtifactWithVersion(
  tx: Tx,
  f: Fixture,
  projectId: string,
  taskId: string,
  type: "logo_brief" | "quote" = "logo_brief",
): Promise<{ artifactId: string; versionId: string }> {
  // 앱에서는 정의자 RPC(record_generation)가 쓰는 표라 준비는 관리자 권한으로 넣는다
  return asSetup(tx, async () => {
    const artifactId = (
      await one<{ id: string }>(
        tx,
        "insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, $4) returning id",
        [f.workspaceId, projectId, taskId, type],
      )
    ).id;
    const versionId = await addVersionRaw(tx, f, artifactId, 1);
    await tx.query("update artifacts set current_draft_version_id = $1 where id = $2", [versionId, artifactId]);
    return { artifactId, versionId };
  });
}

export async function addVersion(tx: Tx, f: Fixture, artifactId: string, version: number): Promise<string> {
  return asSetup(tx, () => addVersionRaw(tx, f, artifactId, version));
}

async function addVersionRaw(tx: Tx, f: Fixture, artifactId: string, version: number): Promise<string> {
  return (
    await one<{ id: string }>(
      tx,
      `insert into artifact_versions (workspace_id, artifact_id, version, content, generator)
       values ($1, $2, $3, $4, 'template') returning id`,
      [f.workspaceId, artifactId, version, JSON.stringify({ brief: `v${version}` })],
    )
  ).id;
}

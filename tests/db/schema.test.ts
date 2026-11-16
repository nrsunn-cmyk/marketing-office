import { beforeAll, describe, expect, it } from "vitest";
import { MACHINES } from "@/domain/state";
import { LOGO_TEMPLATE_VERSION } from "@/domain/logo";
import { QUOTE_TEMPLATE_VERSION } from "@/domain/quote";
import {
  addVersion,
  asUser,
  createArtifactWithVersion,
  createDb,
  createTask,
  createUser,
  type Db,
  expectDbError,
  type Fixture,
  newKey,
  one,
  seedOwner,
} from "./harness";

let db: Db;
let f: Fixture;

beforeAll(async () => {
  db = await createDb();
  f = await seedOwner(db);
}, 60_000);

const asOwner = <T>(fn: Parameters<typeof asUser<T>>[2]) => asUser(db, f.userId, fn);
/**
 * 관리자(superuser) 트랜잭션. SEC-FIX-01 이후 로그인 사용자는 승인 기록을 직접 넣거나 승인본 포인터를 직접 바꿀 수 없다
 * (decide_version 한 경로). 승인 트리거·불변 트리거 자체를 시험할 때만 준비·조작을 이 권한으로 한다. 트리거는 관리자에게도 적용된다.
 */
const asAdmin = <T>(fn: Parameters<typeof asUser<T>>[2]) => db.transaction(fn);

describe("마이그레이션과 도메인 코드의 일치", () => {
  it("DB 상태 전이표가 src/domain/state 와 같다", async () => {
    const rows = (await db.query<{ machine: string; from_state: string; to_state: string }>(
      "select machine, from_state, to_state from app.state_transitions",
    )).rows.map((r) => `${r.machine}:${r.from_state}>${r.to_state}`);
    const expected = Object.entries(MACHINES).flatMap(([m, table]) =>
      Object.entries(table as Record<string, readonly string[]>).flatMap(([from, tos]) => tos.map((to) => `${m}:${from}>${to}`)),
    );
    expect(rows.sort()).toEqual(expected.sort());
  });

  it("DB 상태 목록이 src/domain/state 와 같다", async () => {
    const rows = (await db.query<{ machine: string; state: string }>("select machine, state from app.machine_states")).rows.map(
      (r) => `${r.machine}:${r.state}`,
    );
    const expected = Object.entries(MACHINES).flatMap(([m, table]) => Object.keys(table).map((s) => `${m}:${s}`));
    expect(rows.sort()).toEqual(expected.sort());
  });

  it("템플릿 키가 도메인 템플릿 버전 상수와 같다 (C10)", async () => {
    const keys = (await db.query<{ key: string }>("select key from templates order by key")).rows.map((r) => r.key);
    expect(keys).toEqual([LOGO_TEMPLATE_VERSION, QUOTE_TEMPLATE_VERSION].sort());
  });
});

describe("T01 접근 차단 (RLS, DB 수준)", () => {
  let other: string;
  beforeAll(async () => {
    other = await createUser(db, "stranger@example.test");
  });

  const tables = ["workspaces", "clients", "company_profile_versions", "projects", "tasks", "artifacts", "templates"];

  it.each(tables)("비로그인(anon)은 %s 를 읽을 수 없다", async (table) => {
    await expectDbError(asUser(db, null, (tx) => tx.query(`select * from ${table}`)), /permission denied/);
  });

  it.each(tables.filter((t) => t !== "templates"))("다른 계정은 %s 에서 본인 행을 볼 수 없다", async (table) => {
    const rows = await asUser(db, other, (tx) => tx.query(`select * from ${table}`));
    expect(rows.rows).toEqual([]);
  });

  it("다른 계정은 본인 업무실에 고객을 추가할 수 없다", async () => {
    await expectDbError(
      asUser(db, other, (tx) =>
        tx.query("insert into clients (workspace_id, name) values ($1, '끼어들기')", [f.workspaceId]),
      ),
      /row-level security/,
    );
  });

  it("다른 계정은 본인 고객을 수정할 수 없다 (0행 갱신)", async () => {
    const r = await asUser(db, other, (tx) => tx.query("update clients set name = '변조' where id = $1", [f.clientA]));
    expect(r.affectedRows).toBe(0);
    const name = await one<{ name: string }>(db, "select name from clients where id = $1", [f.clientA]);
    expect(name.name).toBe("가상고객A 베이커리");
  });

  it("다른 사람 명의로 업무실을 만들 수 없다", async () => {
    await expectDbError(
      asUser(db, other, (tx) => tx.query("insert into workspaces (owner_user_id, name) values ($1, 'x')", [f.userId])),
      /row-level security/,
    );
  });

  it("업무실은 1인당 1개 (P1)", async () => {
    await expectDbError(
      asOwner((tx) => tx.query("insert into workspaces (owner_user_id, name) values ($1, '두 번째')", [f.userId])),
      /duplicate key/,
    );
  });

  it("삭제 정책이 없어 본인도 고객을 지울 수 없다 (보관으로 대신)", async () => {
    const r = await asOwner((tx) => tx.query("delete from clients where id = $1", [f.clientA]));
    expect(r.affectedRows).toBe(0);
  });

  it("본인은 템플릿을 고치거나 추가할 수 없다", async () => {
    await expectDbError(
      asOwner((tx) => tx.query("insert into templates (type, version, key) values ('quote', 99, 'x@99')")),
      /row-level security/,
    );
  });
});

describe("T02·T03 고객 자료 혼합 방지 (C03)", () => {
  it("A 프로젝트에 B 고객의 프로필 버전을 연결할 수 없다", async () => {
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into project_profiles (workspace_id, project_id, client_id, company_profile_version_id) values ($1, $2, $3, $4)",
          [f.workspaceId, f.projectA, f.clientA, f.profileB1],
        ),
      ),
      /foreign key/,
    );
  });

  it("고객 id를 B로 바꿔 적어도 A 프로젝트와 맞지 않으면 거절", async () => {
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into project_profiles (workspace_id, project_id, client_id, company_profile_version_id) values ($1, $2, $3, $4)",
          [f.workspaceId, f.projectA, f.clientB, f.profileB1],
        ),
      ),
      /foreign key/,
    );
  });

  it("같은 고객의 프로필 버전은 연결된다", async () => {
    const r = await asOwner((tx) =>
      tx.query(
        "insert into project_profiles (workspace_id, project_id, client_id, company_profile_version_id) values ($1, $2, $3, $4)",
        [f.workspaceId, f.projectA, f.clientA, f.profileA1],
      ),
    );
    expect(r.affectedRows).toBe(1);
  });

  it("자료에 A 프로젝트와 B 고객을 함께 지정할 수 없다", async () => {
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into source_assets (workspace_id, client_id, project_id, kind, text_content) values ($1, $2, $3, 'text', '메모')",
          [f.workspaceId, f.clientB, f.projectA],
        ),
      ),
      /foreign key/,
    );
  });

  it("같은 고객의 두 프로젝트는 각자 자료를 가진다 (T03)", async () => {
    const projectA2 = await asOwner(async (tx) => {
      const p = await one<{ id: string }>(
        tx,
        "insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'client', 'A 두 번째') returning id",
        [f.workspaceId, f.clientA],
      );
      await tx.query(
        "insert into source_assets (workspace_id, client_id, project_id, kind, text_content) values ($1, $2, $3, 'text', 'A2 자료')",
        [f.workspaceId, f.clientA, p.id],
      );
      return p.id;
    });
    const rows = await asOwner((tx) =>
      tx.query<{ text_content: string }>("select text_content from source_assets where project_id = $1", [f.projectA]),
    );
    expect(rows.rows.map((r) => r.text_content)).not.toContain("A2 자료");
    expect(projectA2).toBeTruthy();
  });

  it("client 유형 프로젝트는 고객 필수, 자체 프로젝트는 고객 금지 (R07)", async () => {
    await expectDbError(
      asOwner((tx) => tx.query("insert into projects (workspace_id, kind, title) values ($1, 'client', 'x')", [f.workspaceId])),
      /check constraint/,
    );
    await expectDbError(
      asOwner((tx) =>
        tx.query("insert into projects (workspace_id, client_id, kind, title) values ($1, $2, 'personal', 'x')", [
          f.workspaceId,
          f.clientA,
        ]),
      ),
      /check constraint/,
    );
  });

  it("프로젝트의 고객을 나중에 바꿀 수 없다", async () => {
    await expectDbError(
      asOwner((tx) => tx.query("update projects set client_id = $1 where id = $2", [f.clientB, f.projectA])),
      /FROZEN_COLUMN/,
    );
  });

  it("작업의 템플릿 유형은 작업 유형과 같아야 한다", async () => {
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'logo_brief', $3, $4)",
          [f.workspaceId, f.projectA, f.quoteTemplateId, newKey()],
        ),
      ),
      /foreign key/,
    );
  });

  it("결과물은 다른 프로젝트의 작업에 붙을 수 없다", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const taskB = await createTask(tx, f, f.projectB);
        await tx.query("insert into artifacts (workspace_id, project_id, task_id, type) values ($1, $2, $3, 'logo_brief')", [
          f.workspaceId,
          f.projectA,
          taskB,
        ]);
      }),
      /foreign key/,
    );
  });
});

/**
 * 추가 전용 기록은 두 겹으로 막힌다.
 * 1) 본인 계정: UPDATE/DELETE 정책이 없어 RLS가 0행으로 걸러낸다.
 * 2) RLS를 우회하는 관리자 권한: 트리거가 IMMUTABLE_ROW로 거부한다.
 */
async function expectImmutable(table: string, sql: string, params: unknown[]): Promise<void> {
  const before = (await db.query(`select * from ${table} order by 1`)).rows;
  const r = await asOwner((tx) => tx.query(sql, params));
  expect(r.affectedRows, `${table}: 본인 계정으로 바뀐 행`).toBe(0);
  await expectDbError(db.query(sql, params), /IMMUTABLE_ROW/);
  expect((await db.query(`select * from ${table} order by 1`)).rows).toEqual(before);
}

describe("C04 추가 전용 기록은 수정·삭제 불가", () => {
  it("회사 프로필 버전 수정·삭제 불가 (R06)", async () => {
    await expectImmutable("company_profile_versions", "update company_profile_versions set products = '변조' where id = $1", [f.profileA1]);
    await expectImmutable("company_profile_versions", "delete from company_profile_versions where id = $1", [f.profileA1]);
  });

  it("결과 버전·승인·감사 기록 수정 불가", async () => {
    const { versionId, artifactId } = await asOwner(async (tx) => {
      const task = await createTask(tx, f, f.projectA);
      return createArtifactWithVersion(tx, f, f.projectA, task);
    });
    await expectImmutable("artifact_versions", "update artifact_versions set content = '{}' where id = $1", [versionId]);
    await asAdmin((tx) =>
      tx.query(
        "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')",
        [f.workspaceId, artifactId, versionId, f.userId],
      ),
    );
    await expectImmutable("approvals", "update approvals set decision = 'rejected' where artifact_version_id = $1", [versionId]);
    await asOwner((tx) =>
      tx.query("insert into audit_events (workspace_id, entity_type, entity_id, actor_id, action) values ($1, 'artifact', $2, $3, 'approve')", [
        f.workspaceId,
        artifactId,
        f.userId,
      ]),
    );
    await expectImmutable("audit_events", "delete from audit_events where entity_id = $1", [artifactId]);
  });

  it("템플릿은 관리자 권한으로도 고칠 수 없다 (새 버전 행만 추가)", async () => {
    await expectDbError(db.query("update templates set body = 'x' where key = 'logo-template@1'"), /IMMUTABLE_ROW/);
  });

  it("관리자 권한으로도 승인 버전은 바뀌지 않는다 (트리거는 RLS와 별개)", async () => {
    const versionId = await asOwner(async (tx) => {
      const task = await createTask(tx, f, f.projectA);
      return (await createArtifactWithVersion(tx, f, f.projectA, task)).versionId;
    });
    await expectDbError(db.query("update artifact_versions set version = 9 where id = $1", [versionId]), /IMMUTABLE_ROW/);
  });
});

describe("T14·C02 승인본과 새 초안", () => {
  it("승인 기록 없이 승인본 포인터를 지정할 수 없다", async () => {
    await expectDbError(
      asAdmin(async (tx) => {
        const task = await createTask(tx, f, f.projectA);
        const { artifactId, versionId } = await createArtifactWithVersion(tx, f, f.projectA, task);
        await tx.query("update artifacts set approved_version_id = $1 where id = $2", [versionId, artifactId]);
      }),
      /APPROVAL_REQUIRED/,
    );
  });

  it("마지막 결정이 수정 요청이면 승인본으로 지정할 수 없다", async () => {
    await expectDbError(
      asAdmin(async (tx) => {
        const task = await createTask(tx, f, f.projectA);
        const { artifactId, versionId } = await createArtifactWithVersion(tx, f, f.projectA, task);
        const approve = (d: string) =>
          tx.query(
            "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, $5)",
            [f.workspaceId, artifactId, versionId, f.userId, d],
          );
        await approve("approved");
        await approve("changes_requested");
        await tx.query("update artifacts set approved_version_id = $1 where id = $2", [versionId, artifactId]);
      }),
      /APPROVAL_REQUIRED/,
    );
  });

  it("같은 순간에 여러 결정이 들어와도 항상 마지막 결정 기준 (순서 고정 회귀 테스트)", async () => {
    for (let round = 0; round < 10; round += 1) {
      const lastIsApproved = round % 2 === 0;
      const attempt = asAdmin(async (tx) => {
        const task = await createTask(tx, f, f.projectA);
        const { artifactId, versionId } = await createArtifactWithVersion(tx, f, f.projectA, task);
        const decisions = lastIsApproved
          ? ["changes_requested", "approved", "changes_requested", "approved"]
          : ["approved", "changes_requested", "approved", "changes_requested"];
        for (const d of decisions) {
          await tx.query(
            "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, $5)",
            [f.workspaceId, artifactId, versionId, f.userId, d],
          );
        }
        await tx.query("update artifacts set approved_version_id = $1 where id = $2", [versionId, artifactId]);
      });
      if (lastIsApproved) await attempt;
      else await expectDbError(attempt, /APPROVAL_REQUIRED/);
    }
  });

  it("승인 후 재생성은 새 초안 버전이 되고 승인본은 그대로 남는다", async () => {
    const result = await asAdmin(async (tx) => {
      const task = await createTask(tx, f, f.projectA);
      const { artifactId, versionId: v1 } = await createArtifactWithVersion(tx, f, f.projectA, task);
      await tx.query(
        "insert into approvals (workspace_id, artifact_id, artifact_version_id, actor_id, decision) values ($1, $2, $3, $4, 'approved')",
        [f.workspaceId, artifactId, v1, f.userId],
      );
      await tx.query("update artifacts set approved_version_id = $1 where id = $2", [v1, artifactId]);
      const v2 = await addVersion(tx, f, artifactId, 2);
      await tx.query("update artifacts set current_draft_version_id = $1 where id = $2", [v2, artifactId]);
      return { v1, v2, row: await one<{ approved_version_id: string; current_draft_version_id: string }>(tx, "select * from artifacts where id = $1", [artifactId]) };
    });
    expect(result.row.approved_version_id).toBe(result.v1);
    expect(result.row.current_draft_version_id).toBe(result.v2);
  });

  it("포인터는 다른 결과물의 버전을 가리킬 수 없다", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const t1 = await createTask(tx, f, f.projectA);
        const t2 = await createTask(tx, f, f.projectA);
        const a1 = await createArtifactWithVersion(tx, f, f.projectA, t1);
        const a2 = await createArtifactWithVersion(tx, f, f.projectA, t2);
        await tx.query("update artifacts set current_draft_version_id = $1 where id = $2", [a2.versionId, a1.artifactId]);
      }),
      /foreign key/,
    );
  });

  it("같은 결과물에 같은 버전 번호를 두 번 만들 수 없다", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const t = await createTask(tx, f, f.projectA);
        const a = await createArtifactWithVersion(tx, f, f.projectA, t);
        await addVersion(tx, f, a.artifactId, 1);
      }),
      /duplicate key/,
    );
  });
});

describe("T13 편집 충돌 (revision 낙관적 잠금)", () => {
  it("저장할 때마다 revision이 1씩 오르고, 오래된 revision으로는 0행 갱신", async () => {
    const id = await asOwner(async (tx) =>
      (await one<{ id: string }>(tx, "insert into clients (workspace_id, name) values ($1, '충돌 시험') returning id", [f.workspaceId])).id,
    );
    const save = (rev: number, name: string) =>
      asOwner((tx) =>
        tx.query<{ revision: number }>("update clients set name = $1 where id = $2 and revision = $3 returning revision", [name, id, rev]),
      );
    expect((await save(1, "탭1 저장")).rows).toEqual([{ revision: 2 }]);
    expect((await save(1, "탭2 오래된 저장")).rows).toEqual([]);
    const row = await one<{ name: string; revision: number }>(db, "select name, revision from clients where id = $1", [id]);
    expect(row).toEqual({ name: "탭1 저장", revision: 2 });
  });

  it("revision 값을 직접 조작해도 트리거가 이전 값 + 1로 맞춘다", async () => {
    const r = await asOwner((tx) =>
      tx.query<{ revision: number }>("update clients set revision = 999 where id = $1 returning revision", [f.clientB]),
    );
    expect(r.rows[0].revision).toBeLessThan(999);
  });
});

describe("T15 중복 실행 방지 (C01)", () => {
  it("같은 프로젝트에 같은 작업 키로 두 번 만들 수 없다", async () => {
    const key = newKey();
    const insert = () =>
      asOwner((tx) =>
        tx.query(
          "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key) values ($1, $2, 'logo_brief', $3, $4)",
          [f.workspaceId, f.projectA, f.logoTemplateId, key],
        ),
      );
    await insert();
    await expectDbError(insert(), /duplicate key/);
  });

  it("같은 작업·동작·키의 실행 기록은 하나뿐", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const task = await createTask(tx, f, f.projectA);
        const key = newKey();
        const run = () =>
          tx.query(
            "insert into generation_runs (workspace_id, task_id, action, idempotency_key, input_hash, mode) values ($1, $2, 'generate', $3, 'h1', 'template')",
            [f.workspaceId, task, key],
          );
        await run();
        await run();
      }),
      /duplicate key/,
    );
  });
});

describe("상태 전이 (DB 트리거)", () => {
  it("작업: draft → completed 직행 거부", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const task = await createTask(tx, f, f.projectA);
        await tx.query("update tasks set status = 'completed' where id = $1", [task]);
      }),
      /INVALID_TRANSITION/,
    );
  });

  it("작업: 정상 흐름 허용", async () => {
    const status = await asOwner(async (tx) => {
      const task = await createTask(tx, f, f.projectA);
      for (const s of ["ready", "running", "review", "completed"]) {
        await tx.query("update tasks set status = $1 where id = $2", [s, task]);
      }
      return (await one<{ status: string }>(tx, "select status from tasks where id = $1", [task])).status;
    });
    expect(status).toBe("completed");
  });

  it("없는 상태 값 거부", async () => {
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into tasks (workspace_id, project_id, type, template_id, idempotency_key, status) values ($1, $2, 'logo_brief', $3, $4, 'running_fast')",
          [f.workspaceId, f.projectA, f.logoTemplateId, newKey()],
        ),
      ),
      /INVALID_STATE/,
    );
  });

  it("자료: 업로드에서 추출 완료로 직행 거부 (T05)", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const a = await one<{ id: string }>(
          tx,
          "insert into source_assets (workspace_id, client_id, kind, file_name, object_key, mime, bytes) values ($1, $2, 'file', 'a.pdf', 'k/a.pdf', 'application/pdf', 10) returning id",
          [f.workspaceId, f.clientA],
        );
        await tx.query("update source_assets set extraction_status = 'extracted' where id = $1", [a.id]);
      }),
      /INVALID_TRANSITION/,
    );
  });

  it("PDF: 파일 키·체크섬 없이 ready 불가", async () => {
    await expectDbError(
      asOwner(async (tx) => {
        const t = await createTask(tx, f, f.projectA);
        const { versionId } = await createArtifactWithVersion(tx, f, f.projectA, t);
        const e = await one<{ id: string }>(
          tx,
          "insert into exports (workspace_id, artifact_version_id, format, idempotency_key) values ($1, $2, 'pdf', $3) returning id",
          [f.workspaceId, versionId, newKey()],
        );
        await tx.query("update exports set status = 'rendering' where id = $1", [e.id]);
        await tx.query("update exports set status = 'ready' where id = $1", [e.id]);
      }),
      /check constraint/,
    );
  });
});

describe("M4 자료 파일 저장소 정책", () => {
  const put = (uid: string | null, name: string) =>
    asUser(db, uid, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('source-assets', $1)", [name]));

  it("비공개 버킷, 10MB, 허용 형식 4가지 (D05)", async () => {
    const b = await one<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      db,
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'source-assets'",
    );
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(10 * 1024 * 1024);
    expect(b.allowed_mime_types.sort()).toEqual(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
  });

  it("본인 업무실 폴더에는 올리고 읽을 수 있다", async () => {
    const name = `${f.workspaceId}/${crypto.randomUUID()}/original.pdf`;
    await put(f.userId, name);
    const r = await asOwner((tx) => tx.query("select name from storage.objects where name = $1", [name]));
    expect(r.rows).toHaveLength(1);
  });

  it("다른 계정은 본인 폴더에 올릴 수도, 본인 파일을 볼 수도 없다 (T01)", async () => {
    const stranger = await createUser(db, "storage-stranger@example.test");
    const name = `${f.workspaceId}/${crypto.randomUUID()}/original.png`;
    await put(f.userId, name);
    await expectDbError(put(stranger, `${f.workspaceId}/${crypto.randomUUID()}/x.png`), /row-level security/);
    const r = await asUser(db, stranger, (tx) => tx.query("select name from storage.objects where name = $1", [name]));
    expect(r.rows).toEqual([]);
  });

  it("업무실 id가 아닌 폴더 이름은 오류 없이 거절", async () => {
    await expectDbError(put(f.userId, "not-a-uuid/file.pdf"), /row-level security/);
    await expectDbError(put(f.userId, `../${f.workspaceId}/file.pdf`), /row-level security/);
  });

  it("다른 버킷에는 올릴 수 없다", async () => {
    await db.query("insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing");
    await expectDbError(
      asOwner((tx) => tx.query("insert into storage.objects (bucket_id, name) values ('other', $1)", [`${f.workspaceId}/x.pdf`])),
      /row-level security/,
    );
  });

  it("본인도 파일을 수정·삭제할 수 없다 (정책 없음)", async () => {
    const name = `${f.workspaceId}/${crypto.randomUUID()}/original.txt`;
    await put(f.userId, name);
    const del = await asOwner((tx) => tx.query("delete from storage.objects where name = $1", [name]));
    expect(del.affectedRows).toBe(0);
  });
});

describe("M3 업무실 처음 설정 (setup_workspace)", () => {
  it("업무실과 공급자 1번 버전을 함께 만들고, 다시 불러도 같은 업무실", async () => {
    const uid = await createUser(db, "setup@example.test");
    const call = () =>
      asUser(db, uid, async (tx) =>
        (await one<{ id: string }>(tx, "select setup_workspace('새 업무실', '나다움 마케팅', '대표', null, null, null, null) as id")).id,
      );
    const first = await call();
    const second = await call();
    expect(second).toBe(first);
    const supplier = await one<{ legal_name: string; version: number; representative: string | null; phone: string | null }>(
      db,
      "select legal_name, version, representative, phone from supplier_profiles where workspace_id = $1",
      [first],
    );
    expect(supplier).toEqual({ legal_name: "나다움 마케팅", version: 1, representative: "대표", phone: null });
    const audit = await db.query("select action from audit_events where workspace_id = $1", [first]);
    expect(audit.rows).toEqual([{ action: "setup" }]);
  });

  it("상호가 비면 아무것도 만들지 않는다", async () => {
    const uid = await createUser(db, "setup-empty@example.test");
    await expectDbError(
      asUser(db, uid, (tx) => tx.query("select setup_workspace('업무실', '   ')")),
      /VALIDATION/,
    );
    const r = await db.query("select 1 from workspaces where owner_user_id = $1", [uid]);
    expect(r.rows).toEqual([]);
  });

  it("비로그인은 호출할 수 없다", async () => {
    await expectDbError(asUser(db, null, (tx) => tx.query("select setup_workspace('x', 'y')")), /permission denied/);
  });
});

describe("견적 저장 (R04·R06·C08)", () => {
  // 견적·고정본·항목은 로그인 사용자가 직접 넣을 수 없다(CR03, finalize_quote 만 가능).
  // 이 묶음은 DB 제약(금액 규칙·불변성)을 시험하므로 관리자 권한으로 직접 넣는다.
  async function createQuote() {
    const { task, artifactId, versionId } = await asOwner(async (tx) => {
      const task = await createTask(tx, f, f.projectB, "quote");
      return { task, ...(await createArtifactWithVersion(tx, f, f.projectB, task, "quote")) };
    });
    {
      const quote = await one<{ id: string }>(
        db,
        "insert into quotes (workspace_id, task_id, artifact_id) values ($1, $2, $3) returning id",
        [f.workspaceId, task, artifactId],
      );
      return { quoteId: quote.id, artifactId, versionId };
    }
  }

  const insertVersion = (q: { quoteId: string; artifactId: string; versionId: string }, sub: number, tax: number, total: number, mode = "EXCLUSIVE", bp = 1000) =>
    db.query(
        `insert into quote_versions (workspace_id, quote_id, artifact_id, artifact_version_id, supplier_snapshot, customer_snapshot,
           tax_mode, tax_rate_bp, subtotal_won, tax_won, total_won)
         values ($1, $2, $3, $4, '{}', '{}', $5, $6, $7, $8, $9) returning id`,
        [f.workspaceId, q.quoteId, q.artifactId, q.versionId, mode, bp, sub, tax, total],
    );

  it("합계 ≠ 공급가 + 세액이면 저장 거부", async () => {
    await expectDbError(insertVersion(await createQuote(), 100_000, 10_000, 100_000), /check constraint/);
  });

  it("미적용 모드에 세액이 있으면 거부", async () => {
    await expectDbError(insertVersion(await createQuote(), 100_000, 10_000, 110_000, "NO_TAX", 0), /check constraint/);
  });

  it("정상 견적 버전과 항목 저장, 이후 수정 불가 (T12)", async () => {
    const q = await createQuote();
    const qv = (await insertVersion(q, 100_000, 10_000, 110_000)).rows[0] as { id: string };
    await db.query(
      "insert into quote_items (workspace_id, quote_version_id, position, name, quantity_hundredths, unit_price_won, line_amount_won) values ($1, $2, 0, '로고 기획', 200, 50000, 100000)",
      [f.workspaceId, qv.id],
    );
    // 로그인 사용자는 확정 견적에 행을 더할 수 없다 (CR03)
    await expectDbError(
      asOwner((tx) =>
        tx.query(
          "insert into quote_items (workspace_id, quote_version_id, position, name, quantity_hundredths, unit_price_won, line_amount_won) values ($1, $2, 9, '사후 추가', 100, 1, 1)",
          [f.workspaceId, qv.id],
        ),
      ),
      /row-level security/,
    );
    await expectImmutable("quote_items", "update quote_items set unit_price_won = 1 where quote_version_id = $1", [qv.id]);
    await expectImmutable("quote_versions", "update quote_versions set total_won = 1 where id = $1", [qv.id]);
  });

  it("빈 단가(null)는 저장되지만 음수·0 수량은 거부", async () => {
    const q = await createQuote();
    const qv = (await insertVersion(q, 0, 0, 0)).rows[0] as { id: string };
    const item = (pos: number, qty: number, price: number | null) =>
      db.query(
        "insert into quote_items (workspace_id, quote_version_id, position, name, quantity_hundredths, unit_price_won) values ($1, $2, $3, 'x', $4, $5)",
        [f.workspaceId, qv.id, pos, qty, price],
      );
    await item(0, 100, null);
    await expectDbError(item(1, 0, 100), /check constraint/);
    await expectDbError(item(2, 100, -1), /check constraint/);
  });

  it("견적 번호는 확정할 때 차례대로 발번되고, 같은 견적은 같은 번호", async () => {
    const q1 = await createQuote();
    const q2 = await createQuote();
    // 번호 발번은 확정 함수 안에서만 쓰는 내부 함수다(CR03). 번호 규칙 자체는 관리자 권한으로 시험한다.
    const assign = async (id: string) => (await one<{ n: string }>(db, "select assign_quote_number($1, '2026-11-13') as n", [id])).n;
    expect(await assign(q1.quoteId)).toBe("Q-2026-0001");
    expect(await assign(q2.quoteId)).toBe("Q-2026-0002");
    expect(await assign(q1.quoteId)).toBe("Q-2026-0001");
  });

  it("해가 바뀌면 번호가 0001부터 다시 시작한다", async () => {
    const q = await createQuote();
    const n = (await one<{ n: string }>(db, "select assign_quote_number($1, '2027-01-02') as n", [q.quoteId])).n;
    expect(n).toBe("Q-2027-0001");
  });

  it("정해진 견적 번호는 바꿀 수 없다", async () => {
    const q = await createQuote();
    await db.query("select assign_quote_number($1, '2026-11-13')", [q.quoteId]);
    await expectDbError(db.query("update quotes set quote_number = 'Q-2026-9999' where id = $1", [q.quoteId]), /FROZEN_COLUMN/);
    // 로그인 사용자는 견적 행을 고칠 권한 자체가 없다(0행)
    const r = await asOwner((tx) => tx.query("update quotes set quote_number = 'Q-2026-9999' where id = $1", [q.quoteId]));
    expect(r.affectedRows).toBe(0);
  });

  it("로그인 사용자는 본인 것이라도 번호 발번 함수를 직접 부를 수 없다 (CR03)", async () => {
    const q = await createQuote();
    await expectDbError(asOwner((tx) => tx.query("select assign_quote_number($1)", [q.quoteId])), /permission denied/);
    const stranger = await createUser(db, "quote-stranger@example.test");
    await expectDbError(asUser(db, stranger, (tx) => tx.query("select assign_quote_number($1)", [q.quoteId])), /permission denied/);
  });
});

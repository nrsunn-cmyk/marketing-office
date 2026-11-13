/**
 * 복원 훈련 (T20) — 로컬 전용.
 * 로컬 DB를 비우고(supabase db reset) 백업을 다시 넣은 뒤, 파일을 다시 올리고 검증한다.
 *
 * 실행: RESTORE_DRILL_CONFIRM=local node --env-file=.env.local scripts/backup/restore-drill.mts <백업 폴더>
 *
 * 운영 DB에는 절대 실행하지 않는다. 운영 복원은 새 Supabase 프로젝트를 만들어 같은 순서로 진행한다
 * (마이그레이션 적용 → data.sql 적용 → 파일 업로드 → verify).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { admin, BUCKET, psql, run, type Manifest } from "./common.mts";
import { verify } from "./verify.mts";

const dir = process.argv[2];
if (!dir) {
  console.error("사용법: RESTORE_DRILL_CONFIRM=local node --env-file=.env.local scripts/backup/restore-drill.mts <백업 폴더>");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (process.env.RESTORE_DRILL_CONFIRM !== "local" || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("로컬 Supabase(127.0.0.1)에서 RESTORE_DRILL_CONFIRM=local 일 때만 실행합니다. 이 훈련은 로컬 DB를 비웁니다.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;

// 1) 로컬 DB 비우기 (마이그레이션만 다시 적용된 빈 상태)
run("supabase", ["db", "reset"]);

// 2) 데이터 넣기: 서로 참조하는 표(artifacts ↔ artifact_versions)가 있어 넣는 동안 트리거·외래키 검사를 멈추고,
//    넣은 뒤 아래 검증에서 외래키 고아 행을 직접 확인한다.
//    마이그레이션이 다시 만든 기본 데이터(템플릿)는 백업과 id가 달라 충돌하므로 비우고 백업 그대로 넣는다.
const data = readFileSync(join(dir, "data.sql"), "utf8");
psql(
  `set session_replication_role = replica;\ntruncate table public.templates cascade;\n${data}\nset session_replication_role = origin;`,
);

// 3) 파일 다시 올리기
const sb = admin();
for (const f of manifest.files) {
  const buf = readFileSync(join(dir, "files", f.key));
  const { error } = await sb.storage.from(BUCKET).upload(f.key, buf, { contentType: f.mime, upsert: true });
  if (error) throw new Error(`파일 올리기 실패: ${f.key}: ${error.message}`);
}

// 4) 검증
await verify(manifest);
console.log("복원 훈련 통과");

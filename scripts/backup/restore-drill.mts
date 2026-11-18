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
import {
  admin,
  apiPort,
  BUCKET,
  configApiPort,
  containerProject,
  dbContainer,
  localProjectId,
  psql,
  resolveBackupTarget,
  run,
  SHARED_PROJECT_ID,
  type Manifest,
} from "./common.mts";
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
// SQL 대상 확인이 초기화 뒤에서 실패하면 로컬 자료만 지워질 수 있으므로 먼저 차단한다.
if (process.env.BACKUP_DB_URL) {
  console.error("로컬 복원 훈련에는 BACKUP_DB_URL을 지정할 수 없습니다. 원격 DB 설정을 제거한 별도 로컬 환경에서 실행하세요. DB는 초기화하지 않았습니다.");
  process.exit(1);
}
// 백업·검증과 같은 규칙으로 대상을 한 번 더 정한다(BACKUP_REMOTE 같은 원격 설정이 남아 있으면 여기서 멈춤).
// 이 검사를 초기화 뒤의 psql()에 맡기면 로컬 DB만 비고 복원은 안 된 채 끝난다(ENG-BKP-02).
try {
  if (resolveBackupTarget().kind !== "local") throw new Error("로컬 대상이 아닙니다.");
} catch (e) {
  console.error(`복원 훈련을 시작하지 않았습니다: ${(e as Error).message} DB는 초기화하지 않았습니다.`);
  process.exit(1);
}
// R1 W3: supabase db reset 은 현재 폴더의 프로젝트를 비운다. data.sql 을 넣을 컨테이너가 그 프로젝트의 DB 가 아니면
// (예: 개인 스택을 비우고 공용 스택에 넣음) 초기화 전에 멈춘다.
// R2(QA-BACKUP-P2-01-R1 R1-a·R1-b): 공용 스택 project_id 는 무조건 멈춤, API 포트 대조, 컨테이너 라벨로 프로젝트 확인.
{
  const stop = (why: string) => {
    console.error(`복원 훈련을 시작하지 않았습니다: ${why} DB는 초기화하지 않았습니다.`);
    process.exit(1);
  };
  const id = localProjectId();
  if (!id) stop("현재 폴더에 supabase/config.toml(project_id)이 없습니다. 전용 연습 스택 폴더에서 실행하세요.");
  if (id === SHARED_PROJECT_ID) stop(`초기화 대상이 공용 로컬 스택(${SHARED_PROJECT_ID})입니다. 복원 연습은 전용 연습 스택에서만 합니다.`);
  const cfgPort = configApiPort();
  const urlPort = apiPort(url);
  if (cfgPort === null || cfgPort !== urlPort) {
    stop(`API 주소 포트(${urlPort ?? "없음"})가 초기화할 프로젝트(${id})의 API 포트(${cfgPort ?? "없음"})와 다릅니다. 파일 업로드·검증이 다른 스택으로 갈 수 있습니다.`);
  }
  let container = "";
  try {
    container = dbContainer("local");
  } catch (e) {
    stop((e as Error).message);
  }
  let labelProject = "";
  try {
    labelProject = containerProject(container);
  } catch (e) {
    stop((e as Error).message);
  }
  if (labelProject !== id) {
    stop(`초기화할 프로젝트(${id})와 데이터를 넣을 컨테이너(${container}, 프로젝트 ${labelProject || "스택 아님"})가 다릅니다.`);
  }
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

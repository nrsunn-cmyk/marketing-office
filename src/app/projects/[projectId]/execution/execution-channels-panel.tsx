import type { FormState } from "../../../_components/form-state";
import { ActionForm } from "../../../_components/action-form";
import styles from "../../../ui.module.css";
import s from "./execution.module.css";
import type { P4ExternalBoard } from "@/features/execution/channels";
import { formatKst, resultHeadline, type ExecutionBoard } from "./execution-model";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export interface ExternalExecutionActions {
  saveConnection?: Action;
  disconnectConnection?: Action;
  dispatchExternal?: Action;
  syncMetrics?: Action;
  enqueueChannel?: Action;
  scheduleJob?: Action;
  cancelSchedule?: Action;
  createInquiry?: Action;
  createFollowup?: Action;
  updateFollowup?: Action;
  archiveInquiry?: Action;
  archiveFollowup?: Action;
}

const CHANNEL_ITEMS = [
  { key: "crm", title: "고객 관리 (CRM)", desc: "상담·리드 마그넷 후속 처리 및 외부 CRM 웹훅 연동" },
  { key: "search_ad", title: "검색 광고", desc: "검색 광고 캠페인 집행 및 성과 지표 읽기 전용 수집" },
  { key: "social_api", title: "SNS", desc: "공식 SNS 게시 API 실행 및 노출·전환 지표 수집" },
] as const;

/** 채널 내부 값 → 화면 이름(AGY DESIGN-QA-P4-INTEGRATE-01 권고 1). 티스토리는 수동 게시 채널 */
const CHANNEL_NAME: Record<string, string> = { crm: "고객 관리", search_ad: "검색 광고", social_api: "SNS", tistory_manual: "티스토리" };
const channelName = (key: string) => CHANNEL_NAME[key] ?? key;

/**
 * P4-SCHEDULE-RUNNER-01 예약 실행기 문구 — 초안(AGY 확정 대기, 확정본이 오면 이 블록만 바꾼다).
 * 실행기는 예약 시각에 '실행할 차례'로 바꾸기만 하고 실제 실행(승인·게시 기록·외부 실행)은 사람이 누른다
 */
export const SCHEDULE_RUNNER_COPY = {
  dueLabel: "실행할 차례",
  intro: "예약 시각이 되면 '실행할 차례'로 알려 드립니다. 실행은 대기열에서 직접 눌러 주세요. 원본 초안 내용이 바뀌면 자동 보류됩니다.",
  dueNote: "예약 시각이 되었습니다. 대기열에서 이 실행 건을 실행해 주세요.",
  dueLink: "실행 건으로 이동 →",
  dueSummary: (n: number) => `실행할 차례 ${n}건`,
  banner: (n: number) => `예약 시각이 된 실행 건이 ${n}건 있습니다.`,
  bannerLink: "예약 실행 보기 →",
  unknownJob: "실행 건",
} as const;

/** P4B 상태 이름표(AGY P4B-HANDOFF·P4-HANDOFF-CONSISTENCY, 권고 2). 자동 보류만 경고 톤 */
const SCHEDULE_STATUS: Record<string, string> = { scheduled: "예약됨", due: SCHEDULE_RUNNER_COPY.dueLabel, paused_version_changed: "자동 보류", cancelled: "취소됨", executed: "실행 완료" };
const INQUIRY_STATUS: Record<string, string> = { new: "신규", linked: "후속 연결됨", closed: "종료" };
const FOLLOWUP_STATUS = { todo: "할 일", in_progress: "진행 중", done: "완료", hold: "보류" } as const;
function StatusPill({ map, value }: { map: Record<string, string>; value: string }) {
  const tone = value === "paused_version_changed" ? styles.pillWarning : value === "due" ? styles.pillInfo : styles.pillNeutral;
  return <span className={`${styles.pill} ${tone}`}>{map[value] ?? value}</span>;
}

/** P4B 문구 — AGY 확정본(Design/p4-execution/P4B-HANDOFF.md 4절) 그대로 */
export const P4B_COPY = {
  scIntro: "승인된 실행 건에 예정 시각(한국 시간)을 붙여 관리합니다.",
  scEmpty: "예약된 실행 건이 없습니다.",
  scEmptyDesc: "실행 승인 대기열에서 승인된 건에 예정 시각을 붙이면 이곳에 한국 시간 기준으로 표시됩니다.",
  scPaused: "예약 이후 원본 초안 내용이 바뀌어 자동 보류되었습니다. 최신 초안으로 맞춘 뒤 다시 예약해 주세요.",
  scCancel: "예약 취소",
  scNoPermission: "보관한 프로젝트이거나 예약을 바꿀 권한이 없습니다.",
  iqIntro: "리드 마그넷 신청과 홈페이지 문의를 기록합니다. 목록에서는 개인정보를 최소한으로 가려서 표시합니다.",
  iqMasking: "개인정보 최소 표시 · 마스킹 적용",
  iqEmpty: "아직 접수된 상담·문의가 없습니다.",
  iqEmptyDesc: "리드 마그넷 신청이나 홈페이지 문의가 들어오면 개인정보를 가린 요약 목록으로 표시됩니다.",
  iqConnect: "CRM 후속 작업으로 연결",
  iqNoPermission: "보관한 프로젝트이거나 후속 작업을 연결할 권한이 없습니다.",
  crIntro: "접수된 상담·문의를 담당자와 기한(한국 날짜)을 정해 후속 관리하고, 완료된 건은 성과 수동 입력과 연결합니다.",
  crEmpty: "등록된 CRM 후속 작업이 없습니다.",
  crEmptyDesc: "상담·문의 접수 목록에서 후속 작업으로 연결하면 담당자·기한·진행 상태를 관리할 수 있습니다.",
  crSave: "상태 저장",
  crNoPermission: "보관한 프로젝트이거나 후속 작업 상태를 바꿀 권한이 없습니다.",
} as const;
/** P4-UX-POLISH-FRONT-01 문구 — AGY 확정본(msg_eda62e087f14, UX-SCENARIO-AUDIT-04 A3~A6) 그대로 */
export const P4_POLISH_COPY = {
  inquiryPrefix: "상담: ",
  linkResult: "연결할 성과",
  linkResultNone: "선택 안 함",
  linkedResult: (name: string) => `연결된 성과: ${name}`,
  addFollowup: "후속 작업 추가",
} as const;
/**
 * Tester msg_d50295c3379a: 서버는 빈 값이면 기존 연결을 유지한다(update_crm_followup coalesce).
 * 그래서 이미 연결된 후속 작업의 빈 선택지는 '해제'가 아니라 '유지'다. ⚠ AGY 확정 대기 초안
 */
export const P4_LINK_KEEP_COPY = { linkResultKeep: "바꾸지 않음" } as const;

/** P4-ARCHIVE-BUTTONS-FRONT-01 문구 — AGY 원안 확정(msg_3eaa3c935a83, UX-SCENARIO-AUDIT-04 A1) */
export const P4_ARCHIVE_COPY = {
  inquirySummary: "이 상담 보관",
  inquiryWarn: "보관하면 이 상담에 연결된 후속 작업도 함께 보관됩니다. 보관한 항목은 목록에서 사라집니다.",
  followupSummary: "이 후속 작업 보관",
  followupNote: "보관하면 목록에서 사라집니다.",
  confirm: "보관 확인",
  done: "보관했습니다.",
} as const;

/** 성과 선택 칸의 빈 선택지 이름: 연결이 있으면 '바꾸지 않음', 없으면 '선택 안 함' */
export function emptyResultOptionLabel(linkedResultId: string | null | undefined): string {
  return linkedResultId ? P4_LINK_KEEP_COPY.linkResultKeep : P4_POLISH_COPY.linkResultNone;
}

/** 외부 게시 주소는 https 일 때만 새 창 링크(A6, 그 밖은 글자로만) */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const C = P4B_COPY;

/** 예약 시각이 지나 '실행할 차례'인 예약 수(실행 화면 머리 알림과 예약 구획이 같이 쓴다) */
export const dueScheduleCount = (b: P4ExternalBoard | null | undefined) => (b?.schedules ?? []).filter((x) => x.status === "due").length;

/** 빈 목록 안내(제목 + 설명) */
function Empty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className={s.exEmpty}>
      <p>
        <strong>{title}</strong>
      </p>
      <p className={styles.muted}>{desc}</p>
    </div>
  );
}

/** 읽기 전용 안내 */
function NoPermission({ text }: { text: string }) {
  return (
    <p className={styles.muted} role="note">
      {text}
    </p>
  );
}

export function ExternalChannelsPanel({
  board,
  externalBoard,
  actions,
  notConnected,
}: {
  board: ExecutionBoard | null;
  externalBoard: P4ExternalBoard | null;
  actions: ExternalExecutionActions;
  notConnected: Action;
}) {
  const connMap = new Map((externalBoard?.connections ?? []).map((c) => [c.channel, c]));
  const connectedChannels = (externalBoard?.connections ?? []).filter((c) => c.status === "connected");
  const externalJobs = (board?.jobs ?? []).filter((j) => j.channel !== "tistory_manual" && !j.archivedAt);
  const jobById = new Map((board?.jobs ?? []).map((j) => [j.id, j]));
  const dueCount = dueScheduleCount(externalBoard);
  const inquiryName = new Map((externalBoard?.inquiries ?? []).map((q) => [q.id, q.maskedName]));
  const activeResults = (board?.results ?? []).filter((r) => r.status === "active" && r.archivedAt === null);
  const resultName = new Map((board?.results ?? []).map((r) => [r.id, resultHeadline(r)]));
  const schedulableJobs = (board?.jobs ?? []).filter(
    (j) => !j.archivedAt && (j.status === "pending_approval" || j.status === "queued"),
  );

  return (
    <>
      <section className={`${styles.section} ${s.exSection}`} aria-labelledby="external-channels-setup">
        <h2 id="external-channels-setup" className={styles.subtitle}>
          외부 채널 연결 설정 (고객 관리 · 검색 광고 · SNS)
        </h2>
        <p className={styles.muted}>
          저장된 API 키와 토큰은 화면에 다시 표시하지 않습니다. 비용 한도(월 예산 · 1회 상한)를 함께 설정할 수 있습니다.
        </p>

        <ul className={s.exList}>
          {CHANNEL_ITEMS.map((item) => {
            const conn = connMap.get(item.key);
            const isConnected = conn?.status === "connected";
            return (
              <li key={item.key} className={s.exCard}>
                <div className={s.exCardHead}>
                  <strong>{item.title}</strong>
                  <span className={styles.badge}>{isConnected ? "연결됨" : "미연결"}</span>
                </div>
                <p className={styles.muted}>{item.desc}</p>
                {isConnected && conn ? (
                  <p className={styles.muted}>
                    계정: {conn.accountLabel} · 키 등록됨(화면 비노출) · 월 한도 {conn.monthlyBudgetWon.toLocaleString("ko-KR")}원 · 1회 한도{" "}
                    {conn.perRunLimitWon.toLocaleString("ko-KR")}원
                  </p>
                ) : null}
                <details className={s.exFold}>
                  <summary>{isConnected ? "연결 정보 수정 · 키 교체" : "API 키 · 주소 연결하기"}</summary>
                  <ActionForm action={actions.saveConnection ?? notConnected} submitLabel="연결 저장">
                    <input type="hidden" name="channel" value={item.key} />
                    <div className={styles.field}>
                      <label htmlFor={`label-${item.key}`}>계정 표시 이름</label>
                      <input id={`label-${item.key}`} name="accountLabel" defaultValue={conn?.accountLabel ?? ""} required maxLength={100} />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`ep-${item.key}`}>실행 연동 주소 (POST Endpoint / Webhook)</label>
                      <input
                        id={`ep-${item.key}`}
                        name="endpointUrl"
                        type="url"
                        defaultValue={conn?.endpointUrl ?? ""}
                        placeholder="https://..."
                        required
                        maxLength={500}
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`mp-${item.key}`}>성과 수집 주소 (GET Metrics, 선택)</label>
                      <input
                        id={`mp-${item.key}`}
                        name="metricsUrl"
                        type="url"
                        defaultValue={conn?.metricsUrl ?? ""}
                        placeholder="https://..."
                        maxLength={500}
                      />
                    </div>
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label htmlFor={`mb-${item.key}`}>월 비용 한도 (원)</label>
                        <input
                          id={`mb-${item.key}`}
                          name="monthlyBudgetWon"
                          type="number"
                          min={0}
                          defaultValue={conn?.monthlyBudgetWon ?? 0}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`pr-${item.key}`}>1회 실행 상한 (원)</label>
                        <input
                          id={`pr-${item.key}`}
                          name="perRunLimitWon"
                          type="number"
                          min={0}
                          defaultValue={conn?.perRunLimitWon ?? 0}
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor={`sk-${item.key}`}>
                        {isConnected ? "새 API 키 / 토큰 (바꿀 때만 입력, 기존 값 비노출)" : "API 키 / 비밀 토큰 (필수)"}
                      </label>
                      <input
                        id={`sk-${item.key}`}
                        name="secretKey"
                        type="password"
                        autoComplete="off"
                        required={!isConnected}
                        maxLength={500}
                      />
                    </div>
                  </ActionForm>
                </details>
                {isConnected ? (
                  <details className={s.exFold}>
                    <summary>연결 끊기 (키 폐기)</summary>
                    <ActionForm action={actions.disconnectConnection ?? notConnected} submitLabel="연결 끊기 확인">
                      <input type="hidden" name="channel" value={item.key} />
                      <p className={styles.muted}>연결을 끊으면 저장된 API 키가 즉시 삭제됩니다.</p>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {board && connectedChannels.length > 0 ? (
        <section className={`${styles.section} ${s.exSection}`} aria-labelledby="external-dispatch">
          <h2 id="external-dispatch" className={styles.subtitle}>
            외부 채널 실행 · 성과 자동 수집 (읽기 전용)
          </h2>
          {board.canWrite && board.enqueueOptions.length > 0 ? (
            <ActionForm action={actions.enqueueChannel ?? notConnected} submitLabel="외부 채널 대기열에 올리기">
              <input type="hidden" name="projectId" value={board.projectId} />
              <div className={styles.row}>
                <div className={styles.field}>
                  <label htmlFor="ext-draft">검토 완료 초안</label>
                  <select id="ext-draft" name="draftId" required>
                    {board.enqueueOptions.map((o) => (
                      <option key={o.draftId} value={o.draftId}>
                        {o.title} (v{o.revision})
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="ext-ch">연결된 외부 채널</label>
                  <select id="ext-ch" name="channel" required>
                    {connectedChannels.map((c) => (
                      <option key={c.channel} value={c.channel}>
                        {channelName(c.channel)} ({c.accountLabel})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </ActionForm>
          ) : null}

          {externalJobs.length > 0 ? (
            <ul className={s.exList}>
              {externalJobs.map((j) => (
                <li key={j.id} className={s.exCard}>
                  <div className={s.exCardHead}>
                    <strong>
                      [{channelName(j.channel)}] {j.payloadTitle}
                    </strong>
                    <span className={styles.badge}>{j.statusLabel}</span>
                  </div>
                  {(j.status === "queued" || j.status === "failed") && board.canWrite ? (
                    <ActionForm action={actions.dispatchExternal ?? notConnected} submitLabel="외부 채널 즉시 실행">
                      <input type="hidden" name="jobId" value={j.id} />
                      <input type="hidden" name="revision" value={j.revision} />
                    </ActionForm>
                  ) : null}
                  {j.externalUrl ? (
                    <p className={styles.muted}>
                      외부 게시 주소:{" "}
                      {safeExternalUrl(j.externalUrl) ? (
                        <a href={j.externalUrl} target="_blank" rel="noopener noreferrer" className={styles.touchLink}>
                          {j.externalUrl}
                        </a>
                      ) : (
                        j.externalUrl
                      )}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>등록된 외부 채널 실행 건이 없습니다.</p>
          )}

          {connectedChannels.some((c) => c.metricsUrl) && board.canWrite ? (
            <div className={s.exFold}>
              <ActionForm action={actions.syncMetrics ?? notConnected} submitLabel="외부 성과 자동 수집(읽기 전용)">
                <input type="hidden" name="projectId" value={board.projectId} />
                <div className={styles.field}>
                  <label htmlFor="sync-ch">수집 대상 채널</label>
                  <select id="sync-ch" name="channel" required>
                    {connectedChannels
                      .filter((c) => c.metricsUrl)
                      .map((c) => (
                        <option key={c.channel} value={c.channel}>
                          {channelName(c.channel)} ({c.accountLabel})
                        </option>
                      ))}
                  </select>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </section>
      ) : null}

      {board && externalBoard ? (
        <section className={`${styles.section} ${s.exSection}`} aria-labelledby="p4b-ops">
          <h2 id="p4b-ops" className={styles.subtitle}>
            예약 실행 · 상담 접수 (마스킹) · CRM 후속 작업
          </h2>
          <details className={s.exFold} open={dueCount > 0}>
            <summary>
              예약 실행 ({externalBoard.schedules.length}건){dueCount > 0 ? ` · ${SCHEDULE_RUNNER_COPY.dueSummary(dueCount)}` : ""}
            </summary>
            <p className={styles.muted}>{C.scIntro}</p>
            <p className={styles.muted}>{SCHEDULE_RUNNER_COPY.intro}</p>
            {!board.canWrite ? <NoPermission text={C.scNoPermission} /> : null}
            {board.canWrite && schedulableJobs.length > 0 ? (
              <ActionForm action={actions.scheduleJob ?? notConnected} submitLabel="한국 시간(KST) 예약 등록">
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="sched-job">실행 건</label>
                    <select id="sched-job" name="executionJobId" required>
                      {schedulableJobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          [{channelName(j.channel)}] {j.payloadTitle}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="sched-at">예약 시각 (KST)</label>
                    <input id="sched-at" name="scheduledAt" type="datetime-local" required />
                  </div>
                </div>
              </ActionForm>
            ) : null}
            {externalBoard.schedules.length === 0 ? (
              <Empty title={C.scEmpty} desc={C.scEmptyDesc} />
            ) : (
              <ul className={s.exList}>
                {externalBoard.schedules.map((sc) => {
                  const job = jobById.get(sc.executionJobId);
                  return (
                  <li key={sc.id} className={s.exCard}>
                    <div className={s.exCardHead}>
                      <span>
                        {job ? `[${channelName(job.channel)}] ${job.payloadTitle}` : SCHEDULE_RUNNER_COPY.unknownJob} · {formatKst(sc.scheduledAt)}
                      </span>
                      <StatusPill map={SCHEDULE_STATUS} value={sc.status} />
                    </div>
                    {sc.status === "paused_version_changed" ? <p className={s.exWarn}>{C.scPaused}</p> : null}
                    {sc.status === "due" ? (
                      <p role="note">
                        {SCHEDULE_RUNNER_COPY.dueNote}{" "}
                        <a href={job && job.channel !== "tistory_manual" ? "#external-dispatch" : `#job-${sc.executionJobId}`} className={styles.touchLink}>
                          {SCHEDULE_RUNNER_COPY.dueLink}
                        </a>
                      </p>
                    ) : null}
                    {(sc.status === "scheduled" || sc.status === "due") && board.canWrite ? (
                      <ActionForm action={actions.cancelSchedule ?? notConnected} submitLabel={C.scCancel}>
                        <input type="hidden" name="scheduleId" value={sc.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </details>

          <details className={s.exFold}>
            <summary>상담 · 문의 접수 기록 (개인정보 마스킹 · {externalBoard.inquiries.length}건)</summary>
            <p className={styles.muted}>{C.iqIntro}</p>
            <p>
              <span className={`${styles.pill} ${styles.pillInfo}`}>{C.iqMasking}</span>
            </p>
            {board.canWrite ? (
              <ActionForm action={actions.createInquiry ?? notConnected} submitLabel="상담·문의 등록">
                <input type="hidden" name="projectId" value={board.projectId} />
                <input type="hidden" name="sourceKind" value="manual" />
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="inq-name">이름</label>
                    <input id="inq-name" name="contactName" required maxLength={80} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="inq-phone">연락처</label>
                    <input id="inq-phone" name="contactPhone" type="tel" maxLength={40} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="inq-email">이메일</label>
                    <input id="inq-email" name="contactEmail" type="email" maxLength={120} />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="inq-note">상담 메모</label>
                  <input id="inq-note" name="note" maxLength={500} />
                </div>
              </ActionForm>
            ) : (
              <NoPermission text={C.iqNoPermission} />
            )}
            {externalBoard.inquiries.length === 0 ? (
              <Empty title={C.iqEmpty} desc={C.iqEmptyDesc} />
            ) : (
              <ul className={s.exList}>
                {externalBoard.inquiries.map((inq) => (
                  <li key={inq.id} className={s.exCard}>
                    <div className={s.exCardHead}>
                      <span>
                        <strong>{inq.maskedName}</strong> ({inq.maskedPhone || "연락처 없음"} · {inq.maskedEmail || "이메일 없음"})
                      </span>
                      <StatusPill map={INQUIRY_STATUS} value={inq.status} />
                    </div>
                    {board.canWrite ? (
                      <ActionForm action={actions.createFollowup ?? notConnected} submitLabel={inq.status === "linked" ? P4_POLISH_COPY.addFollowup : C.iqConnect}>
                        <input type="hidden" name="inquiryId" value={inq.id} />
                        <div className={styles.row}>
                          <div className={styles.field}>
                            <label htmlFor={`asg-${inq.id}`}>담당자</label>
                            <input id={`asg-${inq.id}`} name="assigneeName" required maxLength={60} />
                          </div>
                          <div className={styles.field}>
                            <label htmlFor={`due-${inq.id}`}>기한</label>
                            <input id={`due-${inq.id}`} name="dueDate" type="date" required />
                          </div>
                        </div>
                      </ActionForm>
                    ) : null}
                    {/* AUDIT-04 A1: 한도에 닿으면 서버가 '보관한 뒤 다시 등록'을 안내하므로 보관할 길을 둔다 */}
                    {board.canWrite ? (
                      <details className={s.exFold} data-archive="inquiry">
                        <summary>{P4_ARCHIVE_COPY.inquirySummary}</summary>
                        <ActionForm action={actions.archiveInquiry ?? notConnected} submitLabel={P4_ARCHIVE_COPY.confirm} variant="secondary">
                          <input type="hidden" name="inquiryId" value={inq.id} />
                          <p className={s.exWarn}>{P4_ARCHIVE_COPY.inquiryWarn}</p>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className={s.exFold}>
            <summary>CRM 후속 작업 목록 ({externalBoard.followups.length}건)</summary>
            <p className={styles.muted}>{C.crIntro}</p>
            {!board.canWrite ? <NoPermission text={C.crNoPermission} /> : null}
            {externalBoard.followups.length === 0 ? (
              <Empty title={C.crEmpty} desc={C.crEmptyDesc} />
            ) : (
              <ul className={s.exList}>
                {externalBoard.followups.map((f) => (
                  <li key={f.id} className={s.exCard}>
                    <div className={s.exCardHead}>
                      <span>
                        {inquiryName.get(f.inquiryId) ? `${P4_POLISH_COPY.inquiryPrefix}${inquiryName.get(f.inquiryId)} · ` : ""}담당: {f.assigneeName} · 기한: {f.dueDate}
                      </span>
                      <StatusPill map={FOLLOWUP_STATUS} value={f.status} />
                    </div>
                    {f.linkedResultId && resultName.get(f.linkedResultId) ? (
                      <p className={styles.muted}>{P4_POLISH_COPY.linkedResult(resultName.get(f.linkedResultId)!)}</p>
                    ) : null}
                    {board.canWrite ? (
                      <ActionForm action={actions.updateFollowup ?? notConnected} submitLabel={C.crSave}>
                        <input type="hidden" name="followupId" value={f.id} />
                        <div className={styles.field}>
                          <label htmlFor={`fst-${f.id}`}>진행 상태</label>
                          <select id={`fst-${f.id}`} name="status" defaultValue={f.status}>
                            {Object.entries(FOLLOWUP_STATUS).map(([v, t]) => (
                              <option key={v} value={v}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                        {activeResults.length > 0 ? (
                          <div className={styles.field}>
                            <label htmlFor={`flr-${f.id}`}>{P4_POLISH_COPY.linkResult}</label>
                            {/* 서버는 빈 값이면 기존 연결을 유지한다(update_crm_followup coalesce) */}
                            <select id={`flr-${f.id}`} name="linkedResultId" defaultValue={activeResults.some((r) => r.id === f.linkedResultId) ? (f.linkedResultId ?? "") : ""}>
                              <option value="">{emptyResultOptionLabel(f.linkedResultId)}</option>
                              {activeResults.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {resultHeadline(r)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </ActionForm>
                    ) : null}
                    {board.canWrite ? (
                      <details className={s.exFold} data-archive="followup">
                        <summary>{P4_ARCHIVE_COPY.followupSummary}</summary>
                        <ActionForm action={actions.archiveFollowup ?? notConnected} submitLabel={P4_ARCHIVE_COPY.confirm} variant="secondary">
                          <input type="hidden" name="followupId" value={f.id} />
                          <p className={styles.muted}>{P4_ARCHIVE_COPY.followupNote}</p>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      ) : null}
    </>
  );
}

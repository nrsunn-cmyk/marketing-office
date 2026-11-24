import type { FormState } from "../../../_components/form-state";
import { ActionForm } from "../../../_components/action-form";
import styles from "../../../ui.module.css";
import s from "./execution.module.css";
import type { P4ExternalBoard } from "@/features/execution/channels";
import { formatKst, type ExecutionBoard } from "./execution-model";

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
}

const CHANNEL_ITEMS = [
  { key: "crm", title: "고객 관리 (CRM)", desc: "상담·리드 마그넷 후속 처리 및 외부 CRM 웹훅 연동" },
  { key: "search_ad", title: "검색 광고", desc: "검색 광고 캠페인 집행 및 성과 지표 읽기 전용 수집" },
  { key: "social_api", title: "SNS", desc: "공식 SNS 게시 API 실행 및 노출·전환 지표 수집" },
] as const;

/** 채널 내부 값 → 화면 이름(AGY DESIGN-QA-P4-INTEGRATE-01 권고 1). 티스토리는 수동 게시 채널 */
const CHANNEL_NAME: Record<string, string> = { crm: "고객 관리", search_ad: "검색 광고", social_api: "SNS", tistory_manual: "티스토리" };
const channelName = (key: string) => CHANNEL_NAME[key] ?? key;

/** P4B 상태 이름표(AGY P4B-HANDOFF·P4-HANDOFF-CONSISTENCY, 권고 2). 자동 보류만 경고 톤 */
const SCHEDULE_STATUS: Record<string, string> = { scheduled: "예약됨", paused_version_changed: "자동 보류", cancelled: "취소됨", executed: "실행 완료" };
const INQUIRY_STATUS: Record<string, string> = { new: "신규", linked: "후속 연결됨", closed: "종료" };
const FOLLOWUP_STATUS = { todo: "할 일", in_progress: "진행 중", done: "완료", hold: "보류" } as const;
function StatusPill({ map, value }: { map: Record<string, string>; value: string }) {
  const tone = value === "paused_version_changed" ? styles.pillWarning : styles.pillNeutral;
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
const C = P4B_COPY;

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
                    <p className={styles.muted}>외부 게시 주소: {j.externalUrl}</p>
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
          <details className={s.exFold}>
            <summary>예약 실행 ({externalBoard.schedules.length}건)</summary>
            <p className={styles.muted}>{C.scIntro}</p>
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
                {externalBoard.schedules.map((sc) => (
                  <li key={sc.id} className={s.exCard}>
                    <div className={s.exCardHead}>
                      <span>{formatKst(sc.scheduledAt)}</span>
                      <StatusPill map={SCHEDULE_STATUS} value={sc.status} />
                    </div>
                    {sc.status === "paused_version_changed" ? <p className={s.exWarn}>{C.scPaused}</p> : null}
                    {sc.status === "scheduled" && board.canWrite ? (
                      <ActionForm action={actions.cancelSchedule ?? notConnected} submitLabel={C.scCancel}>
                        <input type="hidden" name="scheduleId" value={sc.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
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
                      <ActionForm action={actions.createFollowup ?? notConnected} submitLabel={C.iqConnect}>
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
                        담당: {f.assigneeName} · 기한: {f.dueDate}
                      </span>
                      <StatusPill map={FOLLOWUP_STATUS} value={f.status} />
                    </div>
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
                      </ActionForm>
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

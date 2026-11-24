import type { FormState } from "../../../_components/form-state";
import { ActionForm } from "../../../_components/action-form";
import { HashArrival } from "../../../_components/hash-arrival";
import styles from "../../../ui.module.css";
import s from "./execution.module.css";
import type { P4ExternalBoard } from "@/features/execution/channels";
import type { ExecutionBoard } from "./execution-model";

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
                        {c.channel} ({c.accountLabel})
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
                      [{j.channel}] {j.payloadTitle}
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
                          {c.channel} ({c.accountLabel})
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
          {/* 현황 「후속 열기」(#p4b-ops)로 들어왔을 때 늦게 그려져도 이 구획으로(UX-G1-G4-FRONT-01 r2) */}
          <HashArrival id="p4b-ops" />

          <details className={s.exFold}>
            <summary>예약 실행 ({externalBoard.schedules.length}건)</summary>
            {board.canWrite && schedulableJobs.length > 0 ? (
              <ActionForm action={actions.scheduleJob ?? notConnected} submitLabel="한국 시간(KST) 예약 등록">
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor="sched-job">실행 건</label>
                    <select id="sched-job" name="executionJobId" required>
                      {schedulableJobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          [{j.channel}] {j.payloadTitle}
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
            <ul className={s.exList}>
              {externalBoard.schedules.map((sc) => (
                <li key={sc.id} className={s.exCard}>
                  <span>
                    {sc.scheduledAt} · 상태: {sc.status}
                  </span>
                  {sc.status === "scheduled" && board.canWrite ? (
                    <ActionForm action={actions.cancelSchedule ?? notConnected} submitLabel="예약 취소">
                      <input type="hidden" name="scheduleId" value={sc.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>

          <details className={s.exFold}>
            <summary>상담 · 문의 접수 기록 (개인정보 마스킹 · {externalBoard.inquiries.length}건)</summary>
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
                    <input id="inq-phone" name="contactPhone" maxLength={40} />
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
            ) : null}
            <ul className={s.exList}>
              {externalBoard.inquiries.map((inq) => (
                <li key={inq.id} className={s.exCard}>
                  <strong>{inq.maskedName}</strong> ({inq.maskedPhone || "연락처 없음"} · {inq.maskedEmail || "이메일 없음"}) · 상태: {inq.status}
                  {board.canWrite ? (
                    <ActionForm action={actions.createFollowup ?? notConnected} submitLabel="CRM 후속 작업 연결">
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
          </details>

          <details className={s.exFold}>
            <summary>CRM 후속 작업 목록 ({externalBoard.followups.length}건)</summary>
            <ul className={s.exList}>
              {externalBoard.followups.map((f) => (
                <li key={f.id} className={s.exCard}>
                  <span>
                    담당: {f.assigneeName} · 기한: {f.dueDate} · 상태: {f.status}
                  </span>
                  {board.canWrite ? (
                    <ActionForm action={actions.updateFollowup ?? notConnected} submitLabel="상태 저장">
                      <input type="hidden" name="followupId" value={f.id} />
                      <select name="status" defaultValue={f.status}>
                        <option value="todo">할 일</option>
                        <option value="in_progress">진행 중</option>
                        <option value="done">완료</option>
                        <option value="hold">보류</option>
                      </select>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </>
  );
}

import Link from "next/link";
import { LEAD_MAGNET_DELIVERIES, LEAD_MAGNET_FORMATS, LEAD_MAGNET_LIMITS, LEAD_MAGNET_STATUSES } from "@/domain/lead-magnet/constants";
import { FUNNEL_ITEM_KINDS, type FunnelItemKind } from "@/domain/funnel/constants";
import { archiveLeadMagnetAction, createLeadMagnetAction, rebaseLeadMagnetAction, updateLeadMagnetAction } from "@/features/lead-magnet/actions";
import type { FunnelBoard } from "@/features/funnel/server";
import type { LeadMagnetView } from "@/features/lead-magnet/server";
import { ActionForm } from "../../_components/action-form";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import lm from "./lead-magnet.module.css";
import { LeadMagnetEditForm } from "./lead-magnet-edit-form";
import { emptyLeadMagnet, leadMagnetToForm } from "./lead-magnet-form";

/**
 * P2E-UI-01 리드마그넷 영역(퍼널 보드 아래). 시안 Design/P2-next-concepts/lead-magnet.html(R1).
 * 서버 P2E-BACKEND-01. list = null 이면 목록을 읽지 못한 것(퍼널 보드는 그대로 보인다).
 * - 한도: 퍼널마다 보관하지 않은 리드마그넷 20개. 보관한 것은 연결 카드가 남아 있을 때만 목록에 온다(읽기 전용)
 * - 이전 전략 기준: 표시만 하고 편집은 막지 않는다(DEC-P2-01-A). 맞추기는 리드마그넷마다 따로 누른다(서버 RPC 가 하나씩)
 */
export function LeadMagnetSection({ board, list, readOnly, taskId }: { board: FunnelBoard; list: LeadMagnetView[] | null; readOnly: boolean; taskId: string }) {
  const stageOptions = board.stages.map((s) => ({ id: s.id, label: `${s.position}단계 · ${s.label}` }));
  const active = (list ?? []).filter((x) => !x.archived);
  const archived = (list ?? []).filter((x) => x.archived);
  const staleCount = active.filter((x) => x.stale).length;
  const full = active.length >= LEAD_MAGNET_LIMITS.perFunnel;
  // 새로 만들 때 기본 단계: 시안처럼 고려(없으면 첫 단계)
  const defaultStage = board.stages.find((s) => s.key === "consideration")?.id ?? board.stages[0]?.id ?? "";

  return (
    <section className={`${styles.section} ${f.funnel} ${lm.lmSection}`} aria-labelledby="lead-magnets">
      <div className={lm.lmHead}>
        <h2 id="lead-magnets" className={`${styles.subtitle} ${lm.lmTitle}`}>
          리드마그넷
          {list && (
            <span className={styles.badge}>
              {active.length}/{LEAD_MAGNET_LIMITS.perFunnel}개
            </span>
          )}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>
          잠재 고객의 연락처·관심을 얻으려고 주는 무료 자료(체크리스트·가이드·템플릿 등)를 기획하고 퍼널 단계와 연결합니다. 만든 리드마그넷은 퍼널 보드의 전환 오퍼 카드에서 연결합니다.
        </p>
      </div>

      {list === null ? (
        <>
          <p className={styles.error} role="alert">
            리드마그넷 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          <p>
            <Link href={`/tasks/${taskId}#lead-magnets`} className={`${styles.secondaryButton} ${f.touch}`}>
              다시 불러오기
            </Link>
          </p>
        </>
      ) : (
        <>
          {readOnly && (
            <p className={styles.muted} role="note">
              읽기 전용이라 리드마그넷을 추가·수정·보관할 수 없습니다.
            </p>
          )}
          {staleCount > 0 && (
            <div className={`${styles.notice} ${f.warnBox}`} role="note">
              <p className={f.keep}>
                <strong>이전 전략 기준:</strong> 리드마그넷 {staleCount}개가 지금 승인본{board.strategy.approvedVersion ? `(${board.strategy.approvedVersion.version}번 버전)` : ""}보다 앞선 전략을 기준으로 합니다. 대상·약속하는 가치가 지금 전략과 맞는지 확인하고, 리드마그넷마다 &lsquo;지금 승인본 기준으로 맞추기&rsquo;를 눌러 주세요. 맞추지 않아도 편집은 됩니다.
              </p>
            </div>
          )}

          {!readOnly &&
            (full ? (
              <p className={styles.muted} role="note">
                보관하지 않은 리드마그넷이 {LEAD_MAGNET_LIMITS.perFunnel}개라 더 추가할 수 없습니다. 쓰지 않는 리드마그넷을 보관해 주세요.
              </p>
            ) : (
              <details className={`${f.inlineDetails} ${lm.lmAddBox}`}>
                <summary>{active.length === 0 ? "+ 첫 리드마그넷 추가" : "+ 리드마그넷 추가"}</summary>
                {/* 추가에 성공하면 개수가 바뀌어 폼이 새로 그려지고 입력이 비워진다 */}
                <LeadMagnetEditForm key={active.length} action={createLeadMagnetAction} hidden={{}} initial={emptyLeadMagnet(defaultStage)} stages={stageOptions} submitLabel="리드마그넷 추가" />
              </details>
            ))}

          {active.length === 0 && (
            <div className={styles.emptyState}>
              <strong>등록된 리드마그넷이 없습니다.</strong>
              <p className={styles.muted}>고려·전환 단계에서 잠재 고객이 연락처를 남기도록 이끌 체크리스트·가이드·템플릿을 추가해 보세요.</p>
            </div>
          )}

          {active.length > 0 && (
            <ul className={lm.lmGrid} aria-label="리드마그넷 목록">
              {active.map((x) => (
                <LeadMagnetCard key={x.id} x={x} readOnly={readOnly} stageOptions={stageOptions} />
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <div className={lm.lmArchived}>
              <h3 className={lm.lmSubhead}>보관된 리드마그넷 {archived.length}개</h3>
              <p className={`${styles.muted} ${f.keep}`}>보관했지만 아직 이 리드마그넷을 가리키는 퍼널 카드가 있어 보입니다. 읽기 전용이며, 카드의 연결을 풀면 목록에서 빠집니다.</p>
              <ul className={lm.lmGrid} aria-label="보관된 리드마그넷 목록">
                {archived.map((x) => (
                  <LeadMagnetCard key={x.id} x={x} readOnly stageOptions={stageOptions} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LeadMagnetCard({ x, readOnly, stageOptions }: { x: LeadMagnetView; readOnly: boolean; stageOptions: Array<{ id: string; label: string }> }) {
  const titleId = `lm-${x.id}`;
  const live = x.status === "ready" || x.status === "live";
  return (
    <li className={`${lm.lmCard} ${x.stale ? lm.lmCardStale : ""} ${x.archived ? lm.lmCardArchived : ""}`} aria-labelledby={titleId}>
      <p className={lm.lmBadges}>
        <span className={`${f.tag} ${f.tag_lead_magnet}`}>{LEAD_MAGNET_FORMATS[x.format] ?? x.format}</span>
        <span className={f.tag}>단계: {x.stageLabel || "알 수 없음"}</span>
        <span className={`${f.tag} ${live ? f.tag_cta : ""}`}>{LEAD_MAGNET_STATUSES[x.status] ?? x.status}</span>
        {x.stale && <span className={`${f.tag} ${f.tag_warn}`}>이전 전략 기준</span>}
        {x.archived && <span className={f.tag}>보관됨</span>}
      </p>
      <h3 id={titleId} className={lm.lmCardTitle}>
        {x.title}
      </h3>
      <dl className={lm.lmMeta}>
        <dt>대상</dt>
        <dd className={x.audience ? undefined : styles.muted}>{x.audience ?? "적지 않음"}</dd>
        <dt>약속하는 가치</dt>
        <dd className={x.promise ? undefined : styles.muted}>{x.promise ?? "적지 않음"}</dd>
        <dt>전달 방식</dt>
        <dd className={x.delivery ? undefined : styles.muted}>{x.delivery ? LEAD_MAGNET_DELIVERIES[x.delivery] : "선택 안 함"}</dd>
        <dt>수집할 정보</dt>
        <dd>
          {x.leadFields.length ? x.leadFields.join(", ") : <span className={styles.muted}>없음</span>} ({x.leadFields.length}/{LEAD_MAGNET_LIMITS.leadFields}개)
        </dd>
        <dt>구성·목차</dt>
        <dd>
          {x.outline.length === 0 ? (
            <span className={styles.muted}>없음 (0/{LEAD_MAGNET_LIMITS.outline}줄)</span>
          ) : (
            <details className={f.inlineDetails}>
              <summary>
                {x.outline.length}/{LEAD_MAGNET_LIMITS.outline}줄 보기
              </summary>
              <ol className={f.basisList}>
                {x.outline.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ol>
            </details>
          )}
        </dd>
        <dt>연결 카드</dt>
        <dd>
          {x.linkedItems.length === 0 ? (
            <span className={styles.muted}>연결된 카드 없음</span>
          ) : (
            <ul className={lm.lmLinked}>
              {x.linkedItems.map((i) => (
                <li key={i.id}>
                  {FUNNEL_ITEM_KINDS[i.kind as FunnelItemKind] ?? i.kind} · {i.title}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>기준 전략</dt>
        <dd>{x.strategyVersion.version ? `${x.strategyVersion.version}번 버전` : "알 수 없음"}</dd>
      </dl>
      {!readOnly && !x.archived && (
        <div className={lm.lmActions}>
          {x.stale && (
            <ActionForm action={rebaseLeadMagnetAction} submitLabel="지금 승인본 기준으로 맞추기" pendingLabel="맞추는 중…" variant="secondary" className={f.inlineForm}>
              <input type="hidden" name="leadMagnetId" value={x.id} />
              <input type="hidden" name="revision" value={x.revision} />
            </ActionForm>
          )}
          <details className={f.inlineDetails}>
            <summary>고치기·보관</summary>
            {/* 저장에 성공하면 revision 이 바뀌어 폼이 서버 값으로 새로 그려진다 */}
            <LeadMagnetEditForm key={x.revision} action={updateLeadMagnetAction} hidden={{ leadMagnetId: x.id, revision: x.revision }} initial={leadMagnetToForm(x)} stages={stageOptions} submitLabel="리드마그넷 저장" />
            <ActionForm action={archiveLeadMagnetAction} submitLabel="이 리드마그넷 보관" pendingLabel="보관 중…" variant="secondary" className={f.inlineForm}>
              <input type="hidden" name="leadMagnetId" value={x.id} />
              <input type="hidden" name="revision" value={x.revision} />
              <p className={`${styles.muted} ${f.keep}`}>보관하면 목록과 한도에서 빠집니다(지우지 않음, 되돌리기는 아직 없습니다). 연결된 카드의 연결은 남습니다.</p>
            </ActionForm>
          </details>
        </div>
      )}
    </li>
  );
}

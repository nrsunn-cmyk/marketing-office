import Link from "next/link";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import pb from "./production-brief.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import { ProductionBriefEditForm, type BriefAction } from "./production-brief-edit-form";
import {
  DELIVERABLE_TYPES,
  PB_COPY,
  PRODUCTION_BRIEF_STATUSES,
  TEXT_FIELDS,
  productionBriefToForm,
  staleText,
  type ProductionBriefSectionData,
  type ProductionBriefView,
} from "./production-brief-model";

/** 서버 동작 자리(P3-a 서버가 오면 actions.ts 의 동작을 넘긴다. 없으면 각 단추가 '아직 연결 안 됨'만 안내) */
export interface ProductionBriefActions {
  create?: BriefAction;
  update?: BriefAction;
  rebase?: BriefAction;
  archive?: BriefAction;
}

/**
 * P3A-UI-PREP-01 공통 제작 브리프 영역(서버 연결 전, 표시·입력 부품).
 * 시안 Design/p3-production/production-brief.html, 인계표 P3A-HANDOFF.md 2절 상태 6종:
 *   작성 중 · 확정 · 이전 전략 기준(계산 배지) · 보관(읽기 전용) · 빈 상태 · 프로젝트 읽기 전용
 * + 목록을 읽지 못함(data = null).
 * 읽기 전용(보관·프로젝트)일 때는 폼을 하나도 그리지 않고 내용만 보인다.
 * 화면 연결(작업 상세 페이지에 붙이기)은 서버가 온 뒤에 한다.
 */
export function ProductionBriefSection({
  data,
  readOnly,
  taskId,
  actions = {},
}: {
  data: ProductionBriefSectionData | null;
  readOnly: boolean;
  taskId: string;
  actions?: ProductionBriefActions;
}) {
  const b = data?.brief ?? null;
  return (
    <section className={`${styles.section} ${f.funnel} ${pb.pbSection}`} aria-labelledby="production-brief">
      <div className={pb.pbHead}>
        <h2 id="production-brief" className={`${styles.subtitle} ${pb.pbTitle}`}>
          {PB_COPY.heading}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{PB_COPY.intro}</p>
        {b && <Badges b={b} />}
      </div>

      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {PB_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#production-brief`} className={`${styles.secondaryButton} ${f.touch}`}>
              다시 불러오기
            </Link>
          </p>
        </>
      ) : b === null ? (
        <EmptyState data={data} readOnly={readOnly} actions={actions} />
      ) : (
        <BriefBody b={b} data={data} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

function Badges({ b }: { b: ProductionBriefView }) {
  return (
    <p className={pb.pbBadges}>
      <span className={`${pb.pbStatus} ${pb[`pbStatus_${b.status}`]}`}>{PRODUCTION_BRIEF_STATUSES[b.status]}</span>
      {b.stale && <span className={`${f.tag} ${f.tag_warn}`}>이전 전략 기준</span>}
      <span className={f.tag}>{b.strategyVersion.version ? `전략 ${b.strategyVersion.version}번 버전 기준` : "기준 전략 알 수 없음"}</span>
    </p>
  );
}

function EmptyState({ data, readOnly, actions }: { data: ProductionBriefSectionData; readOnly: boolean; actions: ProductionBriefActions }) {
  return (
    <div className={`${styles.emptyState} ${pb.pbEmpty}`}>
      <strong>{PB_COPY.emptyTitle}</strong>
      {readOnly ? (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {PB_COPY.projectReadOnly}
        </p>
      ) : data.canCreate ? (
        <>
          <p className={`${styles.muted} ${f.keep}`}>{PB_COPY.emptyDesc}</p>
          <BriefActionButton action={actions.create} hidden={{}} submitLabel={PB_COPY.create} pendingLabel="만드는 중…" variant="primary" />
        </>
      ) : (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          {data.createBlockedReason ?? "승인된 전략이 있어야 제작 브리프를 만들 수 있습니다."}
        </p>
      )}
    </div>
  );
}

function BriefBody({ b, data, readOnly, actions }: { b: ProductionBriefView; data: ProductionBriefSectionData; readOnly: boolean; actions: ProductionBriefActions }) {
  const archived = b.status === "archived";
  const locked = readOnly || archived;
  return (
    <>
      {locked && (
        <div className={`${styles.notice} ${pb.pbBanner}`} role="note">
          <p className={f.keep}>{archived ? PB_COPY.archivedNote : PB_COPY.projectReadOnly}</p>
        </div>
      )}
      {b.stale && !archived && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>이전 전략 기준:</strong> {staleText(b.strategyVersion.version, data.approvedVersion)}
          </p>
          {!locked && (
            <BriefActionButton action={actions.rebase} hidden={{ briefId: b.id, revision: b.revision }} submitLabel={PB_COPY.rebase} pendingLabel="맞추는 중…" />
          )}
        </div>
      )}
      {b.status === "confirmed" && !locked && (
        <p className={`${styles.muted} ${f.keep}`} role="note">
          확정한 제작 브리프는 이후 홈페이지·디자인 자산 단계의 기준본으로 씁니다. 고치면 그 단계에서도 바뀐 내용을 다시 확인해 주세요.
        </p>
      )}

      {locked ? (
        <ReadOnlyView b={b} />
      ) : (
        <>
          {/* 저장에 성공하면 revision 이 바뀌어 폼이 서버 값으로 새로 그려진다 */}
          <ProductionBriefEditForm key={b.revision} action={actions.update} hidden={{ briefId: b.id, revision: b.revision }} initial={productionBriefToForm(b)} />
          <div className={pb.pbDanger}>
            <BriefActionButton action={actions.archive} hidden={{ briefId: b.id, revision: b.revision }} submitLabel={PB_COPY.archive} pendingLabel="보관 중…">
              <p className={`${styles.muted} ${f.keep}`}>보관하면 내용만 볼 수 있고 고칠 수 없습니다. 보관은 되돌릴 수 없습니다.</p>
            </BriefActionButton>
          </div>
        </>
      )}
    </>
  );
}

/** 읽기 전용: 폼 없이 내용만(글은 React 글자로만 그린다) */
function ReadOnlyView({ b }: { b: ProductionBriefView }) {
  return (
    <dl className={pb.pbView}>
      {TEXT_FIELDS.map((fd) => {
        const value = b[fd.key];
        return (
          <div key={fd.key} className={pb.pbViewRow}>
            <dt>{fd.label}</dt>
            <dd className={value ? pb.pbViewText : styles.muted}>{value || "적지 않음"}</dd>
          </div>
        );
      })}
      <div className={pb.pbViewRow}>
        <dt>포함 산출물 종류</dt>
        <dd>{b.deliverableTypes.length ? b.deliverableTypes.map((k) => DELIVERABLE_TYPES[k] ?? k).join(", ") : <span className={styles.muted}>선택 안 함</span>}</dd>
      </div>
      <div className={pb.pbViewRow}>
        <dt>진행 상태</dt>
        <dd>{PRODUCTION_BRIEF_STATUSES[b.status]}</dd>
      </div>
    </dl>
  );
}

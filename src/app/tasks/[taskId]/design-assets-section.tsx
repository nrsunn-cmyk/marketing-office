import Link from "next/link";
import { BadgeStale, EmptyAssetsArt, P3AssetsIcon } from "../../_components/p3-icons";
import styles from "../../ui.module.css";
import f from "./funnel.module.css";
import da from "./design-assets.module.css";
import { BriefActionButton } from "./production-brief-buttons";
import type { BriefAction } from "./production-brief-edit-form";
import { DesignAssetList, type DesignAssetActions } from "./design-assets-list";
import { DA_COPY, DA_LABELS, P3_COMMON_COPY, type DesignAssetsData } from "./design-assets-model";

export interface DesignAssetSectionActions extends DesignAssetActions {
  upload?: BriefAction;
  registerGenerated?: BriefAction;
  rebase?: BriefAction;
}

/**
 * P3C-UI-PREP-01 디자인 자산 관리 영역(서버 연결 전, 가짜 데이터로 그리는 부품). 실제 파일 올리기는 하지 않는다.
 * 시안 Design/p3-production/assets.html 상태: 작성 중 · 검토 완료 · 이전 기준 · 보관 · 읽기 전용 · 빈 상태
 * + 한도(50/50) · 권한 없음 · 불러오기 실패(data = null). 문구는 P3-COPY-FINAL.md 그대로.
 * 화면 연결(작업 상세에 붙이기)은 서버가 온 뒤에 한다.
 */
export function DesignAssetSection({ data, readOnly, taskId, actions = {} }: { data: DesignAssetsData | null; readOnly: boolean; taskId: string; actions?: DesignAssetSectionActions }) {
  return (
    <section className={`${styles.section} ${f.funnel} ${da.daSection}`} aria-labelledby="design-assets">
      <div className={da.daHead}>
        <h2 id="design-assets" className={`${styles.subtitle} ${da.daTitle}`}>
          <P3AssetsIcon className={da.daIcon} />
          {DA_COPY.heading}
          {data && <span className={styles.badge}>{`자산 ${data.assets.length} / ${data.limit}개`}</span>}
          {data?.stale && (
            <span className={`${f.tag} ${f.tag_warn} ${da.daTagIcon}`}>
              <BadgeStale />
              이전 기준
            </span>
          )}
        </h2>
        <p className={`${styles.muted} ${f.keep}`}>{DA_COPY.intro}</p>
      </div>
      {data === null ? (
        <>
          <p className={styles.error} role="alert">
            {DA_COPY.loadError}
          </p>
          <p>
            <Link href={`/tasks/${taskId}#design-assets`} className={`${styles.secondaryButton} ${f.touch}`}>
              {P3_COMMON_COPY.reload}
            </Link>
          </p>
        </>
      ) : (
        <Body data={data} readOnly={readOnly} actions={actions} />
      )}
    </section>
  );
}

function Body({ data, readOnly, actions }: { data: DesignAssetsData; readOnly: boolean; actions: DesignAssetSectionActions }) {
  const locked = readOnly || !data.canWrite;
  const full = data.assets.length >= data.limit;
  const create = !locked && !full && (
    <div className={da.daCreate}>
      <BriefActionButton action={actions.upload} hidden={{}} submitLabel={DA_COPY.createUpload} pendingLabel={P3_COMMON_COPY.savePending} variant="primary" />
      <BriefActionButton action={actions.registerGenerated} hidden={{}} submitLabel={DA_COPY.createGenerated} pendingLabel={P3_COMMON_COPY.savePending} />
    </div>
  );
  return (
    <>
      <div className={`${styles.notice} ${da.daBanner}`} role="note">
        <p className={f.keep}>{DA_COPY.fileRuleNotice}</p>
      </div>
      {readOnly ? (
        <div className={`${styles.notice} ${da.daBanner}`} role="note">
          <p className={f.keep}>{P3_COMMON_COPY.projectReadOnly}</p>
        </div>
      ) : (
        !data.canWrite && (
          <div className={`${styles.notice} ${da.daBanner}`} role="note">
            <p className={f.keep}>{DA_COPY.noPermission}</p>
          </div>
        )
      )}
      {data.stale && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>
            <strong>{DA_LABELS.stalePrefix}</strong> {DA_COPY.staleBanner}
          </p>
          {!locked && <BriefActionButton action={actions.rebase} hidden={{}} submitLabel={DA_COPY.rebase} pendingLabel={P3_COMMON_COPY.rebasePending} />}
        </div>
      )}
      {!locked && full && (
        <div className={`${styles.notice} ${f.warnBox}`} role="note">
          <p className={f.keep}>{DA_COPY.limitReached}</p>
        </div>
      )}

      {data.assets.length === 0 ? (
        <div className={`${styles.emptyState} ${da.daEmpty}`}>
          <EmptyAssetsArt className={da.daEmptyArt} />
          <strong>{DA_COPY.emptyTitle}</strong>
          {!locked && <p className={`${styles.muted} ${f.keep}`}>{DA_COPY.emptyDesc}</p>}
          {create}
        </div>
      ) : (
        <>
          {create}
          <DesignAssetList assets={data.assets} locked={locked} actions={actions} />
        </>
      )}
    </>
  );
}

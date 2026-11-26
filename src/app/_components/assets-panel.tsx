import { addTextAssetAction, addUrlAssetAction, confirmSourceUploadAction, confirmUploadAction, prepareSourceUploadAction } from "@/features/assets/actions";
import { listAssets, type AssetOwner } from "@/features/assets/server";
import { ASSET_KIND_LABELS, EXTRACTION_STATUS_LABELS, UPLOAD_STATUS_LABELS } from "@/domain/state/labels";
import Link from "next/link";
import { isTextTruncated, LIBRARY_TEXT_COPY, TEXT_PREVIEW_CHARS, textAssetHref } from "../assets/library-text-copy";
import styles from "../ui.module.css";
import { ActionForm } from "./action-form";
import { MobileActionSheet } from "./mobile-action-sheet";
import { SourceUploadForm } from "./source-upload-form";

function OwnerFields({ owner }: { owner: AssetOwner }) {
  return (
    <>
      {owner.clientId && <input type="hidden" name="clientId" value={owner.clientId} />}
      {owner.projectId && <input type="hidden" name="projectId" value={owner.projectId} />}
    </>
  );
}

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 자료(파일·링크·메모) 목록과 추가 폼. 고객 화면과 프로젝트 화면에서 같이 쓴다. */
export async function AssetsPanel({ owner, heading = "자료" }: { owner: AssetOwner; heading?: string }) {
  const assets = await listAssets(owner);
  return (
    <section className={styles.section} aria-labelledby="assets-heading">
      <h2 id="assets-heading" className={styles.subtitle}>
        {heading}
      </h2>
      {assets.length === 0 ? (
        <p className={styles.muted}>등록된 자료가 없습니다.</p>
      ) : (
        <ul className={styles.list} aria-label="자료 목록">
          {assets.map((a) => (
            <li key={a.id} className={styles.listItem}>
              {/* UI-RESP-04: 긴 파일 이름·주소는 한 줄 말줄임 + title, 상태·버튼은 좁으면 아래 줄로 */}
              <div className={styles.rowMainGrow}>
                <span className={styles.metaRow}>
                  <span className={styles.badge}>{ASSET_KIND_LABELS[a.kind]}</span>
                  <strong className={styles.rowTitle} title={a.file_name ?? (a.kind === "url" ? (a.url ?? undefined) : undefined)}>
                    {a.file_name ?? (a.kind === "url" ? a.url : "메모")}
                  </strong>
                </span>
                {a.kind === "url" && a.url && (
                  <div className={styles.muted}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.metaLink} title={a.url}>
                      {a.url}
                    </a>
                  </div>
                )}
                {a.kind === "text" && (
                  <div className={styles.muted}>
                    {a.text_content?.slice(0, TEXT_PREVIEW_CHARS)}
                    {/* AUDIT-05 C2: 잘린 메모는 전체 보기로 */}
                    {isTextTruncated(a.text_content) && (
                      <>
                        {"… "}
                        <Link href={textAssetHref(a.id)} className={styles.metaLink}>
                          {LIBRARY_TEXT_COPY.fullViewLink}
                        </Link>
                      </>
                    )}
                  </div>
                )}
                {a.kind === "file" && (
                  <div className={styles.muted}>
                    {a.mime} · {formatBytes(a.bytes)} · {EXTRACTION_STATUS_LABELS[a.extraction_status]}
                  </div>
                )}
              </div>
              <div className={styles.rowActions}>
                <span className={styles.badge}>{UPLOAD_STATUS_LABELS[a.upload_status] ?? a.upload_status}</span>
                {a.kind === "file" && a.upload_status === "stored" && (
                  <a href={`/assets/${a.id}/download`} className={styles.touchLink}>
                    내려받기
                  </a>
                )}
                {a.kind === "file" && a.upload_status === "pending" && (
                  <ActionForm action={confirmUploadAction} submitLabel="저장 다시 확인" pendingLabel="확인 중…" className={styles.row} variant="secondary">
                    <input type="hidden" name="assetId" value={a.id} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 넓은 화면은 그대로, 휴대폰은 '자료 추가 열기' 버튼으로 아래쪽 창에서 연다 (AGY 04 §2.2) */}
      <MobileActionSheet title="자료 추가">
      <details>
        <summary>파일 올리기 (PDF·PNG·JPEG·TXT, 10MB까지)</summary>
        {/* SOURCE-UPLOAD-UI-01: 파일은 브라우저가 저장소에 직접 올린다(운영 함수 본문 4.5MB 한도). 예약 → 올리기 → 확정 */}
        <SourceUploadForm
          owner={{ clientId: owner.clientId ?? null, projectId: owner.projectId ?? null }}
          actions={{ prepare: prepareSourceUploadAction, confirm: confirmSourceUploadAction }}
        />
      </details>

      <details>
        <summary>메모 추가</summary>
        <ActionForm action={addTextAssetAction} submitLabel="메모 저장">
          <OwnerFields owner={owner} />
          <div className={styles.field}>
            <label htmlFor="memo-title">제목 (선택)</label>
            <input id="memo-title" name="title" />
          </div>
          <div className={styles.field}>
            <label htmlFor="memo-text">내용</label>
            <textarea id="memo-text" name="text" />
          </div>
        </ActionForm>
      </details>

      <details>
        <summary>링크 추가</summary>
        <ActionForm action={addUrlAssetAction} submitLabel="링크 저장">
          <OwnerFields owner={owner} />
          <div className={styles.field}>
            <label htmlFor="link-title">이름 (선택)</label>
            <input id="link-title" name="title" />
          </div>
          <div className={styles.field}>
            <label htmlFor="link-url">주소</label>
            <input id="link-url" name="url" type="url" placeholder="https://" />
          </div>
        </ActionForm>
      </details>
      </MobileActionSheet>
    </section>
  );
}

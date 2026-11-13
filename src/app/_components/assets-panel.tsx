import { addTextAssetAction, addUrlAssetAction, confirmUploadAction, uploadAssetAction } from "@/features/assets/actions";
import { listAssets, type AssetOwner } from "@/features/assets/server";
import { ASSET_KIND_LABELS, EXTRACTION_STATUS_LABELS, UPLOAD_STATUS_LABELS } from "@/domain/state/labels";
import styles from "../ui.module.css";
import { ActionForm } from "./action-form";

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
              <div>
                <span className={styles.badge}>{ASSET_KIND_LABELS[a.kind]}</span>{" "}
                <strong>{a.file_name ?? (a.kind === "url" ? a.url : "메모")}</strong>
                {a.kind === "url" && a.url && (
                  <div className={styles.muted}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">
                      {a.url}
                    </a>
                  </div>
                )}
                {a.kind === "text" && <div className={styles.muted}>{a.text_content?.slice(0, 120)}</div>}
                {a.kind === "file" && (
                  <div className={styles.muted}>
                    {a.mime} · {formatBytes(a.bytes)} · {EXTRACTION_STATUS_LABELS[a.extraction_status]}
                  </div>
                )}
              </div>
              <div className={styles.row}>
                <span className={styles.badge}>{UPLOAD_STATUS_LABELS[a.upload_status] ?? a.upload_status}</span>
                {a.kind === "file" && a.upload_status === "stored" && (
                  <a href={`/assets/${a.id}/download`}>내려받기</a>
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

      <details>
        <summary>파일 올리기 (PDF·PNG·JPEG·TXT, 10MB까지)</summary>
        <ActionForm action={uploadAssetAction} submitLabel="파일 올리기" pendingLabel="올리는 중…" resetOnSuccess>
          <OwnerFields owner={owner} />
          <div className={styles.field}>
            <label htmlFor="asset-file">파일</label>
            <input id="asset-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" />
          </div>
        </ActionForm>
      </details>

      <details>
        <summary>메모 추가</summary>
        <ActionForm action={addTextAssetAction} submitLabel="메모 저장" resetOnSuccess>
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
        <ActionForm action={addUrlAssetAction} submitLabel="링크 저장" resetOnSuccess>
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
    </section>
  );
}

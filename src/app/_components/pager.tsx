import Link from "next/link";
import { PAGE_SIZE } from "@/domain/paging";
import styles from "../ui.module.css";

/**
 * 목록 아래 쪽 이동 (CR07). 전체 개수와 지금 보는 범위를 알려 주고, 다음 쪽·처음으로 이동한다.
 * 걸러 보기 조건(params)은 쪽을 옮겨도 그대로 유지한다.
 */
export function Pager({
  basePath,
  params,
  total,
  page,
  shown,
  nextCursor,
  label,
}: {
  basePath: string;
  params: Record<string, string | null | undefined>;
  total: number;
  page: number;
  shown: number;
  nextCursor: string | null;
  label: string;
}) {
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) keep.set(k, v);
  const first = keep.toString() ? `${basePath}?${keep}` : basePath;
  const next = new URLSearchParams(keep);
  if (nextCursor) {
    next.set("cursor", nextCursor);
    next.set("page", String(page + 1));
  }
  const from = shown === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = (page - 1) * PAGE_SIZE + shown;

  return (
    <nav aria-label={`${label} 쪽 이동`} className={styles.pager}>
      <span className={styles.muted} role="status">
        전체 {total.toLocaleString("ko-KR")}개 중 {from.toLocaleString("ko-KR")}–{to.toLocaleString("ko-KR")}번째
      </span>
      <span className={styles.row}>
        {page > 1 && (
          <Link href={first} className={styles.secondaryButton}>
            처음으로
          </Link>
        )}
        {nextCursor && (
          <Link href={`${basePath}?${next}`} className={styles.secondaryButton}>
            다음 {PAGE_SIZE}개
          </Link>
        )}
      </span>
    </nav>
  );
}

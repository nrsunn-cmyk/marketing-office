import Link from "next/link";
import styles from "./ui.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>찾을 수 없습니다</h1>
      <p className={styles.muted}>주소가 잘못되었거나, 접근할 수 없는 항목입니다.</p>
      <Link href="/">첫 화면으로</Link>
    </main>
  );
}

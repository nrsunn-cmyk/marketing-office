import Image from "next/image";
import Link from "next/link";
import styles from "./landing.module.css";

/**
 * 공식 웹페이지 메인(랜딩 홈) 컴포넌트
 * 주인님 확정: 시안 1 (테크 그리드 & B2B 신뢰) + 지적이고 전문적인 실사 오피스 캐릭터
 * 비로그인 방문자 접속 시 루트(/)에서 기본 제공되는 대표 대외 웹사이트
 * LANDING-COPY-DRAFT-01(DEC-01 초안): 근거를 대기 어려운 절대 표현을 앱이 실제로 하는 기능의 서술로 바꾸고,
 * 목업의 숫자·금액에는 '예시'를 표시했다. 대조표: Plan/Claude-Plan-Audit-20261118/LANDING-COPY-DRAFT-01.md
 */
export function LandingPage() {
  return (
    <div className={styles.landingWrapper}>
      {/* ── 글로벌 헤더 ── */}
      <header className={styles.landingHeader}>
        <div className={`${styles.container} ${styles.landingHeaderInner}`}>
          <Link href="/" className={styles.brandLogoLink}>
            {/* SVG 로고는 변환 없이 그대로(머리글 AppNav 와 같은 방식), 첫 화면이라 먼저 불러온다.
                SITE-FIX-01(AGY SITE-FIX-HANDOFF 4절): 어두운 헤더(#0b1120)에서 글자가 묻히지 않게 테마별 판을 쓴다(보이지 않는 쪽은 display:none) */}
            <Image
              src="/brand/logo-horizontal.svg"
              alt="마케팅 업무실"
              width={260}
              height={48}
              unoptimized
              priority
              className={`${styles.logoImg} ${styles.logoLight}`}
            />
            <Image
              src="/brand/logo-horizontal-dark.svg"
              alt="마케팅 업무실"
              width={260}
              height={48}
              unoptimized
              priority
              className={`${styles.logoImg} ${styles.logoDark}`}
            />
          </Link>

          <nav>
            <ul className={styles.navMenu}>
              <li>
                <a href="#solutions" className={styles.navLink}>
                  핵심 솔루션
                </a>
              </li>
              <li>
                <a href="#mockup" className={styles.navLink}>
                  전략 정리
                </a>
              </li>
              <li>
                <a href="#mockup" className={styles.navLink}>
                  A4 공식 견적서
                </a>
              </li>
              <li>
                <a href="#workflow" className={styles.navLink}>
                  업무 프로세스
                </a>
              </li>
            </ul>
          </nav>

          <div className={styles.headerActions}>
            <Link
              href="/login"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
              id="headerLoginBtn"
            >
              로그인
            </Link>
            <Link
              href="/signup"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
            >
              무료 시작하기
            </Link>
          </div>
        </div>
      </header>

      {/* ── 메인 히어로 섹션 ── */}
      <section className={styles.heroSection}>
        <div className={styles.container}>
          <div className={`${styles.badgePill} ${styles.heroBadge}`}>
            {/* SITE-FIX-01: ⚡ 이모지 대신 AGY Design/site/hero-spark.svg(currentColor, 장식) */}
            <svg className={styles.heroSpark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
              <path d="M13 2L4.5 13.5H12L11 22L19.5 10.5H12L13 2Z" />
            </svg>
            <span>1인 에이전시를 위한 전문 AI 마케팅 업무실</span>
          </div>

          <h1 className={styles.heroTitle}>
            고객 자료는 단 한 번 입력,<br />
            <span className={styles.highlight}>출처가 보이는 전략과 견적까지</span>
          </h1>

          <p className={styles.heroDesc}>
            고객 자료는 한 번 등록해 여러 작업에 다시 쓰고, 전략의 사실마다 출처를 붙이고, 견적은 입력한 단가로 자동 계산합니다.<br />
            1인 마케터의 반복 업무를 한곳에서 정리하는 마케팅 업무실입니다.
          </p>

          <div className={styles.heroActions}>
            <Link
              href="/login"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
            >
              내 업무실 열기
            </Link>
            <a
              href="#mockup"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnLg}`}
            >
              실제 시스템 둘러보기
            </a>
          </div>

          {/* 지적이고 전문적인 오피스 캐릭터 쇼케이스 */}
          <div className={styles.characterShowcaseCard}>
            <div className={styles.characterImgBox}>
              {/* 원본 1264×848 JPG(702KB)를 화면 폭에 맞춰 줄인 최적화 이미지로 받는다(LANDING-FIX-01 I1) */}
              <Image
                src="/brand/office-character-intellectual.jpg"
                alt="나다움 마케팅 오피스 수석 전략 디렉터 실사"
                width={1264}
                height={848}
                sizes="(max-width: 860px) 100vw, 600px"
                priority
                className={styles.characterPhoto}
              />
              <div className={styles.characterBadgeFloating}>
                <span className={styles.livePulse} />
                <span>수석 마케팅 디렉터 & AI 오케스트레이터</span>
              </div>
            </div>

            <div className={styles.characterTextBox}>
              <div className={`${styles.badgePill} ${styles.characterBadgeTag}`}>
                ✦ 지적이고 체계적인 1인 에이전시 파트너
              </div>

              <h3 className={styles.characterQuote}>
                &ldquo;우리는 뜬구름 잡는 조언을 하지 않습니다.<br />
                <span className={styles.characterQuoteHighlight}>
                  등록한 자료와 출처
                </span>
                를 근거로<br />
                고객사의 브랜드 전략과 견적을 정리합니다.&rdquo;
              </h3>

              <p className={styles.characterBio}>
                나다움 마케팅 오피스는 1인 마케터가 고객 자료를 한곳에 모아 두고, 출처를 붙인 전략 초안과 A4 PDF 견적서까지 이어서 만들 수 있도록 돕는 업무 도구입니다.
              </p>

              <div className={styles.characterStatsMini}>
                <div>
                  <strong>1회</strong>
                  <span>고객 자료 등록</span>
                </div>
                <div>
                  <strong>출처</strong>
                  <span>사실마다 표시</span>
                </div>
                <div>
                  <strong>자동</strong>
                  <span>공급가·부가세 계산</span>
                </div>
                <div>
                  <strong>A4 PDF</strong>
                  <span>견적서 내려받기</span>
                </div>
              </div>
            </div>
          </div>

          {/* 실제 시스템 UI 목업 */}
          <div className={styles.mockupWrapper} id="mockup">
            <div className={styles.mockupHeaderBar}>
              <span className={`${styles.dot} ${styles.dotRed}`} />
              <span className={`${styles.dot} ${styles.dotYellow}`} />
              <span className={`${styles.dot} ${styles.dotGreen}`} />
              <span className={styles.mockupUrl}>
                예시 화면 · 아래 숫자·이름·금액은 설명을 위한 예시입니다
              </span>
            </div>

            <div className={styles.mockupInner}>
              {/* 상단 현황 타일(예시 숫자) */}
              <div className={styles.kpiRow}>
                <div className={`${styles.kpiCard} ${styles.blue}`}>
                  <div className={styles.kpiLabel}>진행 중 프로젝트</div>
                  <div className={styles.kpiValue}>6건</div>
                  <div className={styles.kpiSub}>고객사 3곳 활성 업무</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.amber}`}>
                  <div className={styles.kpiLabel}>검토 대기 작업</div>
                  <div className={styles.kpiValue}>2건</div>
                  <div className={styles.kpiSub}>P2 전략 승인 대기 중</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.slate}`}>
                  <div className={styles.kpiLabel}>자료 대기 프로젝트</div>
                  <div className={styles.kpiValue}>1건</div>
                  <div className={styles.kpiSub}>고객 브랜드 에셋 미비</div>
                </div>
                <div className={`${styles.kpiCard} ${styles.rose}`}>
                  <div className={styles.kpiLabel}>7일 안 마감 납기</div>
                  <div className={styles.kpiValue}>4건</div>
                  <div className={styles.kpiSub}>로고 브리프 및 견적 확정</div>
                </div>
              </div>

              {/* 스플릿 뷰: 팩트 기반 전략 vs 공식 A4 견적서 */}
              <div className={styles.mockupSplit}>
                <div className={styles.panelBox}>
                  <div className={styles.panelTitle}>
                    <span>🎯 출처를 붙인 마케팅 전략 초안 (예시)</span>
                    <span className={styles.factTag}>사실마다 출처 표시</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-main)" }}>
                    <p style={{ margin: "4px 0" }}>
                      <strong>[타깃 세그먼트]</strong> 3040 맞춤형 구독형 B2B 고객사
                    </p>
                    <p style={{ margin: "4px 0" }}>
                      <strong>[핵심 가치 제안]</strong> 흩어진 자료를 한곳에, 승인한 결과물은 버전으로 관리
                    </p>
                    <div
                      style={{
                        background: "var(--bg-surface)",
                        padding: 10,
                        borderRadius: 6,
                        marginTop: 10,
                        borderLeft: "3px solid #2563eb",
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      💡 <em>&ldquo;고객 프로필의 [회사 강점 3종]과 [자료 출처 2건]은 사실로, 출처가 없는 내용은 &lsquo;추정&rsquo;으로 나눠 정리했습니다. 사람이 검토한 뒤 승인합니다.&rdquo;</em>
                    </div>
                  </div>
                </div>

                <div className={styles.panelBox}>
                  <div className={styles.panelTitle}>
                    <span>📑 A4 PDF 견적서 (예시 금액)</span>
                    <span className={styles.quoteMatchBadge}>● 자동 계산</span>
                  </div>
                  <div>
                    <div className={styles.quoteRow}>
                      <span>브랜드 로고 브리프 제작</span>
                      <span>350,000원</span>
                    </div>
                    <div className={styles.quoteRow}>
                      <span>P2 종합 마케팅 전략 기획</span>
                      <span>800,000원</span>
                    </div>
                    <div className={styles.quoteRow}>
                      <span>부가세 (VAT 10%)</span>
                      <span>115,000원</span>
                    </div>
                    <div className={styles.quoteTotal}>
                      <span>총 합계금액 (KRW)</span>
                      <span>1,265,000원</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 핵심 신뢰 지표 바 */}
          <div className={styles.metricsBar}>
            <div>
              <div className={styles.metricNumber}>출처</div>
              <div className={styles.metricLabel}>사실마다 출처 연결</div>
              <div className={styles.metricDesc}>출처가 없으면 &lsquo;추정&rsquo;으로 구분</div>
            </div>
            <div>
              <div className={styles.metricNumber}>1회</div>
              <div className={styles.metricLabel}>고객 정보 등록</div>
              <div className={styles.metricDesc}>고객 정보·프로필을 여러 작업에 다시 사용</div>
            </div>
            <div>
              <div className={styles.metricNumber}>원 단위</div>
              <div className={styles.metricLabel}>견적 자동 계산</div>
              <div className={styles.metricDesc}>단가×수량과 부가세를 정수로 계산</div>
            </div>
            <div>
              <div className={styles.metricNumber}>4단계</div>
              <div className={styles.metricLabel}>원스톱 납품 프로세스</div>
              <div className={styles.metricDesc}>고객 등록부터 정식 PDF까지</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3대 핵심 솔루션 섹션 ── */}
      <section className={`${styles.container} ${styles.solutionsSection}`} id="solutions">
        <div className={styles.sectionHead}>
          <div className={styles.sectionEyebrow}>CORE SOLUTIONS</div>
          <h2 className={styles.sectionHeading}>에이전시 실무를 위한 3대 핵심 솔루션</h2>
        </div>

        <div className={styles.solutionsGrid}>
          {/* 솔루션 1 */}
          <div className={styles.solutionCard}>
            <div className={styles.solIcon}>🏢</div>
            <h3 className={styles.solTitle}>고객 & 브랜드 자산화</h3>
            <p className={styles.solDesc}>
              매번 미팅할 때마다 고객사 정보를 다시 묻지 마세요. 
              고객의 상품, 타깃, 강점, 브랜드 규칙, 채널을 한 번 등록해 두면 그 고객의 프로젝트에서 다시 씁니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 고객사별 회사 프로필을 버전으로 보관
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 로고 브리프 입력을 고객 정보로 미리 채움
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 이미 만든 결과물은 만들 때의 프로필 버전을 유지
              </li>
            </ul>
          </div>

          {/* 솔루션 2 */}
          <div className={styles.solutionCard}>
            <div className={styles.solIcon}>🎯</div>
            <h3 className={styles.solTitle}>근거를 남기는 전략 정리</h3>
            <p className={styles.solDesc}>
              사실에는 출처(승인한 회사 프로필·자료·외부 주소)를 하나씩 붙이고, 출처가 없는 내용은 &lsquo;추정&rsquo;으로 따로 적습니다.
              입력한 내용만 정리하며 점수나 숫자를 새로 만들지 않습니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 출처 없는 사실은 &lsquo;추정&rsquo;으로 구분
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 승인한 전략을 이어받는 퍼널 5단계 보드 (준비 중)
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 전략 버전별 검토·승인 기록
              </li>
            </ul>
          </div>

          {/* 솔루션 3 */}
          <div className={styles.solutionCard}>
            <div className={styles.solIcon}>📑</div>
            <h3 className={styles.solTitle}>공식 A4 PDF 견적서 발행</h3>
            <p className={styles.solDesc}>
              복잡한 엑셀 수식과 씨름할 필요가 없습니다. 
              항목별 단가와 수량을 입력하면 공급가·부가세·합계를 계산하고, 확정하면 견적 번호가 붙은 A4 PDF 견적서를 내려받을 수 있습니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 입력하는 동안 원 단위 자동 계산(저장할 때 다시 확인)
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 한국어 A4 PDF 견적서 내려받기
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 확정한 견적은 번호·금액 고정, 전달 기록 남기기
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── 워크플로우 4단계 ── */}
      <section className={`${styles.container} ${styles.workflowSection}`} id="workflow">
        <div className={styles.workflowWrap}>
          <div className={styles.sectionHead} style={{ marginBottom: 36 }}>
            <div className={styles.sectionEyebrow}>WORKFLOW</div>
            <h2 className={styles.sectionHeading}>1인 마케터의 업무를 정리하는 4단계</h2>
          </div>

          <div className={styles.flowSteps}>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepTitle}>고객 프로필 등록</div>
              <div className={styles.stepDesc}>
                고객사의 업종, 타깃 고객, 브랜드 강점과 참고 자료를 한 번 등록합니다.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepTitle}>작업 선택 & 질문</div>
              <div className={styles.stepDesc}>
                로고, 마케팅 전략, 견적 중 필요한 작업을 선택하고 추가 질문에만 답변합니다.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepTitle}>전략 정리 & 검토</div>
              <div className={styles.stepDesc}>
                입력한 사실·출처로 정리한 전략과 브리프를 사람이 직접 확인하고 승인합니다.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNum}>4</div>
              <div className={styles.stepTitle}>공식 견적 & 납품</div>
              <div className={styles.stepDesc}>
                A4 견적서를 내려받아 계약에 쓰고, 승인한 결과물을 고객사 프로젝트에 보관합니다.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA 배너 ── */}
      <section className={styles.container}>
        <div className={styles.ctaBanner}>
          <h2 className={styles.ctaHeading}>지금 나만의 마케팅 업무실을 열어보세요</h2>
          <p className={styles.ctaText}>
            더 이상 산발적인 메모와 불안한 엑셀에 의존하지 마세요.<br />
            나다움 마케팅 오피스가 든든한 업무 파트너가 되어 드립니다.
          </p>
          <Link
            href="/login"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnLg}`}
            style={{ background: "#ffffff", color: "#1e3a8a", border: "none", fontWeight: 800 }}
          >
            지금 로그인하고 업무실 시작하기
          </Link>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className={`${styles.container} ${styles.landingFooter}`}>
        <div>
          <strong>나다움 마케팅 오피스</strong> · 1인 마케터를 위한 마케팅 업무실
        </div>
        <div>
          <Link href="/login" className={styles.footerLoginLink}>
            내 업무실 로그인 화면 바로가기 ↗
          </Link>
        </div>
      </footer>
    </div>
  );
}

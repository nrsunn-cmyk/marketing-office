import Image from "next/image";
import Link from "next/link";
import styles from "./landing.module.css";

/**
 * 공식 웹페이지 메인(랜딩 홈) 컴포넌트
 * 주인님 확정: 시안 1 (테크 그리드 & B2B 신뢰) + 지적이고 전문적인 실사 오피스 캐릭터
 * 비로그인 방문자 접속 시 루트(/)에서 기본 제공되는 대표 대외 웹사이트
 */
export function LandingPage() {
  return (
    <div className={styles.landingWrapper}>
      {/* ── 글로벌 헤더 ── */}
      <header className={styles.landingHeader}>
        <div className={`${styles.container} ${styles.landingHeaderInner}`}>
          <Link href="/" className={styles.brandLogoLink}>
            {/* SVG 로고는 변환 없이 그대로(머리글 AppNav 와 같은 방식), 첫 화면이라 먼저 불러온다 */}
            <Image
              src="/brand/logo-horizontal.svg"
              alt="나다움 마케팅 오피스"
              width={260}
              height={48}
              unoptimized
              priority
              className={styles.logoImg}
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
                  P2 전략 엔진
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
            <span>⚡ 1인 에이전시를 위한 전문 AI 마케팅 업무실</span>
          </div>

          <h1 className={styles.heroTitle}>
            고객 자료는 단 한 번 입력,<br />
            AI와 함께 <span className={styles.highlight}>검증된 전략과 견적까지</span>
          </h1>

          <p className={styles.heroDesc}>
            반복 입력의 피로, 근거 없는 AI 환각, 주먹구구식 엑셀 견적을 끝냅니다.<br />
            1인 마케터를 10인 에이전시급 생산성으로 이끄는 단 하나의 마케팅 OS.
          </p>

          <div className={styles.heroActions}>
            <Link
              href="/login"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
            >
              내 업무실 열기 (로그인) →
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
                  100% 검증된 데이터와 사실(Facts)
                </span>
                만으로<br />
                고객사의 브랜드 전략과 공식 견적을 완성합니다.&rdquo;
              </h3>

              <p className={styles.characterBio}>
                나다움 마케팅 오피스는 1인 마케터가 10인 에이전시급 성과를 낼 수 있도록, 고객 자료의 영구 자산화부터 출처 기반 마케팅 퍼널 기획, 원클릭 정식 A4 견적서 발행까지 오차 없이 보좌하는 지능형 비즈니스 플랫폼입니다.
              </p>

              <div className={styles.characterStatsMini}>
                <div>
                  <strong>100%</strong>
                  <span>데이터 무결성</span>
                </div>
                <div>
                  <strong>0건</strong>
                  <span>AI 환각 차단</span>
                </div>
                <div>
                  <strong>0원</strong>
                  <span>견적 계산 오차</span>
                </div>
                <div>
                  <strong>A4 PDF</strong>
                  <span>공식 견적 출력</span>
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
                https://marketing-office-zeta.vercel.app/ (나다움 마케팅 오피스 내부 현황 대시보드)
              </span>
            </div>

            <div className={styles.mockupInner}>
              {/* 상단 4대 실시간 KPI 타일 */}
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
                    <span>🎯 P2 팩트 기반 마케팅 전략 수립 (Strict Facts)</span>
                    <span className={styles.factTag}>검증된 팩트 100%</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-main)" }}>
                    <p style={{ margin: "4px 0" }}>
                      <strong>[타깃 세그먼트]</strong> 3040 맞춤형 구독형 B2B 고객사
                    </p>
                    <p style={{ margin: "4px 0" }}>
                      <strong>[핵심 가치 제안]</strong> 자료 분산 0%, 승인된 산출물 버전 관리
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
                      💡 <em>&ldquo;추정이나 환각 없이, 고객 프로필에 등록된 [회사 강점 3종]과 [리서치 출처 2건]만을 근거로 퍼널 5단계 브리프를 확정했습니다.&rdquo;</em>
                    </div>
                  </div>
                </div>

                <div className={styles.panelBox}>
                  <div className={styles.panelTitle}>
                    <span>📑 원클릭 공식 A4 PDF 견적서</span>
                    <span className={styles.quoteMatchBadge}>● 계산 일치</span>
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
              <div className={styles.metricNumber}>0건</div>
              <div className={styles.metricLabel}>AI 거짓말(환각) 차단</div>
              <div className={styles.metricDesc}>철저한 Facts & 출처 계약</div>
            </div>
            <div>
              <div className={styles.metricNumber}>100%</div>
              <div className={styles.metricLabel}>고객 데이터 재사용</div>
              <div className={styles.metricDesc}>1회 등록 후 모든 작업 연동</div>
            </div>
            <div>
              <div className={styles.metricNumber}>0원</div>
              <div className={styles.metricLabel}>견적 계산 오차</div>
              <div className={styles.metricDesc}>단가·세액 정수 산출 엔진</div>
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
              고객의 사업 목표, 타깃, 톤앤매너, 공식 레퍼런스를 단 한 번 등록하면 모든 프로젝트에 안전하게 연결됩니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 고객사별 브랜드 프로필 영구 보관
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 로고 브리프 및 디자인 에셋 자동 연동
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 과거 납품 이력 및 데이터 불변성 보장
              </li>
            </ul>
          </div>

          {/* 솔루션 2 */}
          <div className={styles.solutionCard}>
            <div className={styles.solIcon}>🎯</div>
            <h3 className={styles.solTitle}>근거 기반 P2 전략 엔진</h3>
            <p className={styles.solDesc}>
              일반 챗봇의 뜬구름 잡는 소리는 배제합니다.
              검증된 사실(Facts)과 출처(Sources)만을 바탕으로 고객 퍼널 분석, 실행 브리프, 콘텐츠 카피를 오차 없이 설계합니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 거짓 정보(Hallucination) 원천 차단 설계
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 퍼널 5단계별 맞춤형 실행 브리프
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 승인된 전략 기반 결과물 버전 추적
              </li>
            </ul>
          </div>

          {/* 솔루션 3 */}
          <div className={styles.solutionCard}>
            <div className={styles.solIcon}>📑</div>
            <h3 className={styles.solTitle}>공식 A4 PDF 견적서 발행</h3>
            <p className={styles.solDesc}>
              복잡한 엑셀 수식과 씨름할 필요가 없습니다. 
              항목별 단가와 수량을 입력하면 부가세 계산부터 정식 회사 직인이 들어간 표준 A4 PDF 견적서까지 즉시 인쇄·다운로드됩니다.
            </p>
            <ul className={styles.solFeatureList}>
              <li>
                <span className={styles.solCheck}>✓</span> 실시간 단가·수량·세율 정수 자동 계산
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 한국어 인쇄 최적화 표준 A4 PDF 출력
              </li>
              <li>
                <span className={styles.solCheck}>✓</span> 견적 버전별 승인 이력 및 납품 관리
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
            <h2 className={styles.sectionHeading}>1인 마케터도 10인 에이전시처럼 일하는 4단계</h2>
          </div>

          <div className={styles.flowSteps}>
            <div className={styles.stepCard}>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepTitle}>고객 프로필 등록</div>
              <div className={styles.stepDesc}>
                고객사의 업종, 타깃 고객, 브랜드 강점과 참고 문헌을 단 1회 등록합니다.
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
              <div className={styles.stepTitle}>AI 전략 수립 & 검토</div>
              <div className={styles.stepDesc}>
                팩트 기반 AI 엔진이 생성한 전략과 브리프를 사람이 직접 확인하고 승인합니다.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNum}>4</div>
              <div className={styles.stepTitle}>공식 견적 & 납품</div>
              <div className={styles.stepDesc}>
                정식 A4 견적서를 출력해 계약을 맺고, 승인된 결과물을 고객사 프로젝트에 영구 보관합니다.
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
            나다움 마케팅 오피스가 든든한 AI 파트너가 되어 드립니다.
          </p>
          <Link
            href="/login"
            className={`${styles.btn} ${styles.btnSecondary} ${styles.btnLg}`}
            style={{ background: "#ffffff", color: "#1e3a8a", border: "none", fontWeight: 800 }}
          >
            지금 로그인하고 업무실 시작하기 →
          </Link>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className={`${styles.container} ${styles.landingFooter}`}>
        <div>
          <strong>나다움 마케팅 오피스</strong> · 1인 운영 전문 AI 마케팅 에이전시 플랫폼
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

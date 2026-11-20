import type { ComponentType, SVGProps } from "react";
import { P3AssetsIcon, P3BriefIcon, P3BundleIcon, P3PptIcon, P3QaIcon, P3VideoIcon, P3WebCopyIcon } from "../../_components/p3-icons";
import { HELP_COPY, HELP_LABELS, HELP_TERMS, helpSteps, P3_CONNECTED_STEPS, type P3Step } from "./p3-help-model";
import s from "./p3-help.module.css";

const ICON: Record<P3Step, ComponentType<Omit<SVGProps<SVGSVGElement>, "viewBox" | "children">>> = {
  brief: P3BriefIcon,
  webCopy: P3WebCopyIcon,
  assets: P3AssetsIcon,
  video: P3VideoIcon,
  ppt: P3PptIcon,
  qa: P3QaIcon,
  bundle: P3BundleIcon,
};

/** P3-HELP-UI-01: 작업 상세 P3 영역 위 접힌 사용 안내(기본 접힘, 진행률 막대 없음 — 단계별 배지만) */
export function P3Help({ connected = P3_CONNECTED_STEPS }: { connected?: readonly P3Step[] }) {
  return (
    <details className={s.help} id="p3-help">
      <summary className={s.summary}>
        <span>{HELP_COPY.toggleSummary}</span>
        <span className={s.summaryBadge}>{HELP_LABELS.badge}</span>
      </summary>
      <div className={s.body}>
        <p className={s.intro}>{HELP_COPY.intro}</p>
        <section aria-labelledby="p3-help-steps">
          <h3 id="p3-help-steps" className={s.sectionH}>
            {HELP_LABELS.stepsHeading}
          </h3>
          <ul className={s.steps}>
            {helpSteps(connected).map((st) => {
              const Icon = ICON[st.step];
              return (
                <li key={st.step} className={s.step}>
                  <div className={s.stepTop}>
                    <span className={s.stepName}>
                      <Icon width={18} height={18} className={s.icon} />
                      {st.title}
                    </span>
                    <span className={st.available ? `${s.badge} ${s.badgeOk}` : s.badge}>{st.status}</span>
                  </div>
                  <p className={s.desc}>{st.desc}</p>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="p3-help-terms">
          <h3 id="p3-help-terms" className={s.sectionH}>
            {HELP_LABELS.termsHeading}
          </h3>
          <ul className={s.terms}>
            {HELP_TERMS.map((t) => (
              <li key={t.title} className={s.term}>
                <h4 className={s.termTitle}>{t.title}</h4>
                <p className={s.desc}>{t.desc}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}

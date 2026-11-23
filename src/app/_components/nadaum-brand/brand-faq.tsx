"use client";

import { useState } from "react";
import { FAQ } from "./brand-copy";
import s from "./nadaum.module.css";

/** SECTION 06 FAQ: 5문 5답, 처음에는 모두 닫힘. 단추(aria-expanded·aria-controls)로 키보드에서도 열고 닫는다 */
export function FaqAccordion() {
  const [open, setOpen] = useState<boolean[]>(() => FAQ.items.map(() => false));
  return (
    <div className={s.faqList}>
      {FAQ.items.map((item, i) => {
        const id = `faq-${i + 1}`;
        const on = open[i];
        return (
          <div key={id} className={s.faqItem}>
            <h3 className={s.faqQ}>
              <button
                type="button"
                className={s.faqBtn}
                aria-expanded={on}
                aria-controls={`${id}-panel`}
                id={`${id}-btn`}
                onClick={() => setOpen((cur) => cur.map((v, j) => (j === i ? !v : v)))}
              >
                <span>{`Q${i + 1}. ${item.q}`}</span>
                <span aria-hidden="true" className={s.faqMark}>
                  {on ? "−" : "+"}
                </span>
              </button>
            </h3>
            <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-btn`} className={s.faqPanel} hidden={!on}>
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStrategyDraft } from "./build";
import { toStrategyView } from "./view";

/**
 * P2-STRATEGY-VIEWFIXTURE-05: 기존 fixture 입력 5개 → buildStrategyDraft → toStrategyView 결과를
 * `<사례>.view.json`(UI 참고용)으로 두고, 저장본이 실제 함수 결과와 바이트 단위로 같은지 확인한다.
 * 기본 실행은 비교만 한다. STRATEGY_VIEW_FIXTURE_WRITE=1 일 때만 view.json 을 다시 쓴다(입력·expected 는 건드리지 않음).
 */
const DIR = join(__dirname, "fixtures");
const WRITE = process.env.STRATEGY_VIEW_FIXTURE_WRITE === "1";
const CASES = readdirSync(DIR)
  .filter((n) => n.endsWith(".input.json"))
  .map((n) => n.replace(".input.json", ""))
  .sort();
const render = (c: string) =>
  JSON.stringify(toStrategyView(buildStrategyDraft(JSON.parse(readFileSync(join(DIR, `${c}.input.json`), "utf8")))), null, 2) + "\n";

describe("화면 출력 fixture(view.json)", () => {
  it("입력 5개마다 view.json 이 있다", () => {
    expect(CASES).toHaveLength(5);
    if (WRITE) for (const c of CASES) writeFileSync(join(DIR, `${c}.view.json`), render(c));
    for (const c of CASES) expect(existsSync(join(DIR, `${c}.view.json`)), c).toBe(true);
  });

  it.each(CASES)("%s: 저장본 = 실제 toStrategyView 결과", (c) => {
    const saved = readFileSync(join(DIR, `${c}.view.json`), "utf8").replace(/\r\n/g, "\n");
    expect(saved).toBe(render(c));
  });
});

import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isState,
  isTerminal,
  MACHINES,
  type MachineName,
} from "./transitions";

describe("상태 전이표 무결성", () => {
  it.each(Object.keys(MACHINES) as MachineName[])("%s: 모든 목적지가 정의된 상태다", (m) => {
    const table = MACHINES[m] as Record<string, readonly string[]>;
    for (const targets of Object.values(table)) {
      for (const t of targets) expect(isState(m, t)).toBe(true);
    }
  });

  it.each(Object.keys(MACHINES) as MachineName[])("%s: 자기 자신으로 가는 전이는 없다", (m) => {
    const table = MACHINES[m] as Record<string, readonly string[]>;
    for (const [from, targets] of Object.entries(table)) expect(targets).not.toContain(from);
  });
});

describe("작업 상태", () => {
  it("정상 흐름: draft → ready → running → review → completed", () => {
    expect(() => {
      assertTransition("task", "draft", "ready");
      assertTransition("task", "ready", "running");
      assertTransition("task", "running", "review");
      assertTransition("task", "review", "completed");
    }).not.toThrow();
  });

  it("생성 없이 바로 완료로 갈 수 없다", () => {
    expect(canTransition("task", "draft", "completed")).toBe(false);
    expect(canTransition("task", "ready", "completed")).toBe(false);
    expect(canTransition("task", "running", "completed")).toBe(false);
  });

  it("완료·취소는 끝 상태", () => {
    expect(isTerminal("task", "completed")).toBe(true);
    expect(isTerminal("task", "cancelled")).toBe(true);
    expect(isTerminal("task", "review")).toBe(false);
  });

  it("실패 후 재시도 가능", () => {
    expect(canTransition("task", "failed", "running")).toBe(true);
  });

  it("허용되지 않은 전이는 오류", () => {
    expect(() => assertTransition("task", "completed", "running")).toThrow(InvalidTransitionError);
  });
});

describe("PDF 내보내기 상태", () => {
  it("실패 후 다시 대기로 돌아가 재시도", () => {
    expect(canTransition("export", "failed", "pending")).toBe(true);
    expect(canTransition("export", "ready", "rendering")).toBe(false);
  });
});

describe("자료 추출 상태", () => {
  it("업로드만으로 추출 완료가 될 수 없다 (T05)", () => {
    expect(canTransition("extraction", "uploaded", "extracted")).toBe(false);
  });
});

describe("프로젝트 상태", () => {
  it("보관된 프로젝트는 다시 활성화할 수 있다", () => {
    expect(canTransition("project", "archived", "active")).toBe(true);
  });
  it("검토 없이 납품할 수 없다", () => {
    expect(canTransition("project", "active", "delivered")).toBe(false);
  });
});

/**
 * 상태 전이 규칙 (Codex 04 §3).
 * 허용표에 없는 전이는 모두 거부한다. DB 저장 직전에 서버에서 다시 검사한다.
 */

export const PROJECT_TRANSITIONS = {
  received: ["waiting_material", "active", "archived"],
  waiting_material: ["active", "archived"],
  active: ["waiting_material", "review", "archived"],
  review: ["active", "delivered"],
  delivered: ["active", "completed"],
  completed: ["archived"],
  archived: ["active"],
} as const;

/**
 * 작업 상태. running은 실제 생성 요청이 시작됐을 때만 쓴다.
 * completed로 가려면 결과 버전 저장 + 검수 기준 통과가 필요하다(서버에서 별도 확인).
 */
export const TASK_TRANSITIONS = {
  draft: ["waiting_material", "ready", "cancelled"],
  waiting_material: ["ready", "cancelled"],
  ready: ["running", "review", "waiting_material", "cancelled"],
  running: ["review", "failed"],
  review: ["changes_requested", "completed"],
  changes_requested: ["ready", "running", "review", "cancelled"],
  failed: ["ready", "running", "cancelled"],
  completed: [],
  cancelled: [],
} as const;

/** 자료 본문 추출 상태. 자료 검토 상태(unverified/verified/approved)와는 별개다. */
export const EXTRACTION_TRANSITIONS = {
  uploaded: ["extraction_pending"],
  extraction_pending: ["extracted", "extraction_failed"],
  extraction_failed: ["extraction_pending"],
  extracted: [],
} as const;

/** PDF 등 내보내기 상태. 결과 버전과 독립적이다. */
export const EXPORT_TRANSITIONS = {
  pending: ["rendering", "failed"],
  rendering: ["ready", "failed"],
  failed: ["pending"],
  ready: [],
} as const;

export const MACHINES = {
  project: PROJECT_TRANSITIONS,
  task: TASK_TRANSITIONS,
  extraction: EXTRACTION_TRANSITIONS,
  export: EXPORT_TRANSITIONS,
} as const;

export type MachineName = keyof typeof MACHINES;
export type StateOf<M extends MachineName> = keyof (typeof MACHINES)[M] & string;

export type ProjectStatus = StateOf<"project">;
export type TaskStatus = StateOf<"task">;
export type ExtractionStatus = StateOf<"extraction">;
export type ExportStatus = StateOf<"export">;

export function isState<M extends MachineName>(machine: M, value: string): value is StateOf<M> {
  return Object.prototype.hasOwnProperty.call(MACHINES[machine], value);
}

export function canTransition<M extends MachineName>(machine: M, from: StateOf<M>, to: StateOf<M>): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return (table[from] ?? []).includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: MachineName,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: '${from}' → '${to}' 전이는 허용되지 않습니다.`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition<M extends MachineName>(machine: M, from: StateOf<M>, to: StateOf<M>): void {
  if (!canTransition(machine, from, to)) throw new InvalidTransitionError(machine, from, to);
}

export function isTerminal<M extends MachineName>(machine: M, state: StateOf<M>): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return (table[state] ?? []).length === 0;
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BUNDLE-D-FRONT-01 ③ · BUNDLE-D-SERVER-REVIEW-01 S1: 브라우저 묶음에 zod 가 다시 실리지 않게 자동으로 막는다.
 *
 * 모든 "use client" 파일에서 시작해 **값 import**(import type 은 빌드에서 지워지므로 제외)를 끝까지 따라가,
 * zod 를 가져오는 파일에 닿으면 실패한다. 화면은 상수 파일(constants.ts, *-constants.ts, labels.ts)만 값으로 가져오고,
 * 최종 검증은 서버 동작의 zod 가 한다. "use server" 파일은 브라우저로 코드가 가지 않고 참조만 가므로 따라가지 않는다.
 * (예: funnel-form.ts 의 `import type` 이 값 import 로 바뀌면 이 시험이 실패한다)
 */
const SRC = resolve(__dirname, "../..");
const EXT = [".ts", ".tsx"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return EXT.some((e) => p.endsWith(e)) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => join(base, "index" + e))]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** 값으로 가져오는 모듈 이름들(import type·export type, 이름이 모두 type 인 import 는 뺀다) */
function valueImports(code: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const m of code.matchAll(re)) {
    if (m[5]) {
      out.push(m[5]); // 부수 효과 import
      continue;
    }
    if (m[2]) continue; // import type / export type
    const clause = m[3];
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    const names = braces ? braces[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (!outside && names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    out.push(m[4]);
  }
  return out;
}

const isDirective = (code: string, d: string) => new RegExp(`^\\s*(?:/\\*[\\s\\S]*?\\*/\\s*|//[^\\n]*\\n\\s*)*["']${d}["']`).test(code);

describe("브라우저 묶음 import 경계", () => {
  it("값 import 해석: import type·이름이 모두 type 인 import 는 빼고, 하나라도 값이면 넣는다", () => {
    expect(valueImports(`import type { A } from "a";\nimport { type B, type C } from "b";\nimport { type D, E } from "c";\nimport F from "d";\nexport { G } from "e";\nexport type { H } from "f";\nimport "g.css";`)).toEqual([
      "c",
      "d",
      "e",
      "g.css",
    ]);
  });

  it('"use client" 파일에서 값 import 로 닿는 파일 중 zod 를 가져오는 것이 없다', () => {
    const files = walk(SRC);
    const roots = files.filter((f) => isDirective(readFileSync(f, "utf8"), "use client"));
    expect(roots.length).toBeGreaterThan(10);
    const seen = new Map<string, string>(); // 파일 → 처음 닿은 경로
    const queue = roots.map((r) => [r, relative(SRC, r)] as const);
    const hits: string[] = [];
    while (queue.length) {
      const [file, via] = queue.shift()!;
      if (seen.has(file)) continue;
      seen.set(file, via);
      const code = readFileSync(file, "utf8");
      if (!roots.includes(file) && isDirective(code, "use server")) continue;
      for (const spec of valueImports(code)) {
        if (spec === "zod" || spec.startsWith("zod/")) hits.push(via);
        const next = resolveLocal(file, spec);
        if (next && !seen.has(next)) queue.push([next, `${via} → ${relative(SRC, next)}`]);
      }
    }
    expect(hits).toEqual([]);
  });
});

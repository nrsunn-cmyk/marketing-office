import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearCaches, parseAndGenerateServices } from "@typescript-eslint/typescript-estree";

describe("수정된 glob 의존성과 TypeScript 파서의 호환성", () => {
  let folder: string;
  const code = "const value: number = 1;";

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), "codex-parser-compat-"));
    mkdirSync(join(folder, "src"));
    writeFileSync(join(folder, "src", "included.ts"), "export {};");
    writeFileSync(join(folder, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true }, include: ["src/**/*.ts"],
    }));
  });
  afterEach(() => clearCaches());
  afterAll(() => {
    if (!folder.startsWith(join(tmpdir(), "codex-parser-compat-"))) throw new Error("시험 폴더 경로 확인 실패");
    rmSync(folder, { recursive: true, force: true });
  });

  // 파서가 실제로 minimatch를 호출하는 allowDefaultProject 경로를 검사한다.
  for (const name of ["config.ts", ".config.ts"]) {
    it(`${name}: 허용한 기본 프로젝트 파일의 타입 정보를 제공한다`, () => {
      const filePath = join(folder, name);
      writeFileSync(filePath, code);
      const parsed = parseAndGenerateServices(code, {
        filePath, tsconfigRootDir: folder,
        projectService: { allowDefaultProject: ["*.ts"], defaultProject: "tsconfig.json" },
      });
      expect(parsed.ast.type).toBe("Program");
      expect(parsed.services.program?.getSourceFile(filePath)).toBeDefined();
    });
  }

  it("허용 패턴에 맞지 않는 하위 폴더 파일을 기본 프로젝트에 넣지 않는다", () => {
    const filePath = join(folder, "outside", "config.ts");
    expect(() => parseAndGenerateServices(code, {
      filePath, tsconfigRootDir: folder,
      projectService: { allowDefaultProject: ["*.ts"], defaultProject: "tsconfig.json" },
    })).toThrow(/not found by the project service/);
  });
});

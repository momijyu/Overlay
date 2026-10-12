import { registerHooks } from "node:module";
import { extname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

// Nodeでテストするときだけ、Next.jsの @/* と拡張子なしのimportを解決する。
// アプリや本番ビルドの読み込み方は変更しない。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const path = new URL(specifier.slice(2), sourceRoot);
      const extension = existsSync(new URL(`${path.href}.ts`)) ? ".ts" : ".tsx";
      return nextResolve(`${path.href}${extension}`, context);
    }
    if (
      context.parentURL?.startsWith(sourceRoot.href) &&
      specifier.startsWith(".") && !extname(specifier)
    ) {
      const path = new URL(specifier, context.parentURL);
      const extension = existsSync(new URL(`${path.href}.ts`)) ? ".ts" : ".tsx";
      return nextResolve(`${specifier}${extension}`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // JSXのHTML生成・イベント接続を、追加ライブラリなしでテストする。
    if (url.startsWith(sourceRoot.href) && url.endsWith(".tsx")) {
      const result = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: result.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

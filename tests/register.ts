import { registerHooks } from "node:module";
import { extname } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url);

// Nodeでテストするときだけ、Next.jsの @/* と拡張子なしのimportを解決する。
// アプリや本番ビルドの読み込み方は変更しない。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    if (
      context.parentURL?.startsWith(sourceRoot.href) &&
      specifier.startsWith(".") && !extname(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

import { getStoredDriveIdentity } from "./driveLibraryLocal";
import { getLocalLibrarySelector, LEGACY_LIBRARY_DATABASE } from "./localLibrary";

export function createDriveAccountLibraries(
  getScope: () => Promise<{ accountId: string; rootId: string } | null>,
  getSelector: typeof getLocalLibrarySelector,
) {
  return {
    async check(account: string, root: string | null): Promise<"connect" | "switch"> {
      const selector = getSelector();
      const scope = await getScope();
      // 既存DBの所有者は実際の連携記録から確定する。選択した新アカウントで上書きしない。
      if (scope && selector.getDatabaseName() === LEGACY_LIBRARY_DATABASE) selector.rememberLegacyOwner(scope.accountId);
      const expected = selector.getExpectedAccount();
      if (scope && expected && expected !== scope.accountId) throw new Error("保存先のアカウント情報が一致しません。切り替えを中止しました。");
      if (expected && expected !== account) return "switch";
      if (scope && scope.rootId !== root) throw new Error("連携済みのOverlayフォルダが見つかりません。元の保存先を確認してください。");
      if (!expected && selector.getDatabaseName() === LEGACY_LIBRARY_DATABASE) selector.rememberLegacyOwner(account);
      return "connect";
    },
    select(account: string) { getSelector().selectAccount(account); },
  };
}

export const driveAccountLibraries = createDriveAccountLibraries(getStoredDriveIdentity, getLocalLibrarySelector);

// 接続先の変更は次の画面読み込みから適用する。開いているタブの保存先は変えない。
export const LEGACY_LIBRARY_DATABASE = "overlay-local-notes";
const ACTIVE_KEY = "overlay-active-library-v1";
const LEGACY_OWNER_KEY = "overlay-legacy-library-owner-v1";
const TAB_KEY = "overlay-tab-library-v1";
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new Error("保存先の情報を確認できません。この画面を閉じて開き直してください。");
  }
  return value;
}

function selection(value: string | null): string | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("accountId" in parsed)) throw new Error("保存先の情報が壊れています。");
  return parsed.accountId === null ? null : accountId(parsed.accountId);
}

export function createLocalLibrarySelector(local: StorageAccess, tab: StorageAccess) {
  const pinned = tab.getItem(TAB_KEY);
  const selected = selection(pinned ?? local.getItem(ACTIVE_KEY));
  const legacyOwner = local.getItem(LEGACY_OWNER_KEY);
  if (legacyOwner !== null) accountId(legacyOwner);
  const databaseName = selected === null || selected === legacyOwner
    ? LEGACY_LIBRARY_DATABASE : `overlay-account-${encodeURIComponent(selected)}`;
  if (pinned === null) tab.setItem(TAB_KEY, JSON.stringify({ accountId: selected }));
  return {
    getDatabaseName: () => databaseName,
    getExpectedAccount: () => selected ?? local.getItem(LEGACY_OWNER_KEY),
    rememberLegacyOwner(id: string) {
      accountId(id);
      const previous = local.getItem(LEGACY_OWNER_KEY);
      if (previous !== null && previous !== id) throw new Error("元のアカウントの保存先を確認できません。");
      local.setItem(LEGACY_OWNER_KEY, id);
    },
    selectAccount(id: string) {
      accountId(id);
      const previousLocal = local.getItem(ACTIVE_KEY);
      const previousTab = tab.getItem(TAB_KEY);
      const next = JSON.stringify({ accountId: id });
      try {
        local.setItem(ACTIVE_KEY, next);
        tab.setItem(TAB_KEY, next);
      } catch (error) {
        // 保存先が半端に切り替わった状態で再読み込みしない。
        if (previousLocal === null) local.removeItem(ACTIVE_KEY); else local.setItem(ACTIVE_KEY, previousLocal);
        if (previousTab === null) tab.removeItem(TAB_KEY); else tab.setItem(TAB_KEY, previousTab);
        throw error;
      }
    },
  };
}

type Selector = ReturnType<typeof createLocalLibrarySelector>;
const SELECTOR = Symbol.for("overlay.localLibrary.v1");
const RELOADING = Symbol.for("overlay.localLibrary.reloading.v1");
type LibraryWindow = Window & { [SELECTOR]?: Selector; [RELOADING]?: boolean };

export function getLocalLibrarySelector(): Selector {
  if (typeof window === "undefined") throw new Error("ブラウザで保存先を選択してください。");
  const host = window as LibraryWindow;
  return host[SELECTOR] ??= createLocalLibrarySelector(window.localStorage, window.sessionStorage);
}

export function getLocalDatabaseName(): string {
  return typeof window === "undefined" ? LEGACY_LIBRARY_DATABASE : getLocalLibrarySelector().getDatabaseName();
}

export function isAccountSwitchReload(): boolean {
  return typeof window !== "undefined" && !!(window as LibraryWindow)[RELOADING];
}

export function reloadForAccountSwitch() {
  const host = window as LibraryWindow;
  host[RELOADING] = true;
  try { window.location.reload(); }
  catch (error) { host[RELOADING] = false; throw error; }
}

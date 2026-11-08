import { LibraryRetry } from "./driveLibraryData";
import { DriveStickyIndexError } from "./driveStickyIndexData";
import { DriveHttpError } from "./driveHttpError";
import { createBrowserDriveAutosave } from "./driveAutosave";
import { enableDriveLibrary, getLibraryScope, readLibraryPending } from "./driveLibraryLocal";
import { syncDriveLibrary, syncDriveStickyIndexes } from "./driveLibraryRemote";
import { checkQueuedDriveCaches, hasDriveCacheChecks } from "./driveCacheChecks";
import { pruneDriveCache } from "./driveLibraryCache";
import { createGoogleDriveClient } from "./googleDriveClient";
import { getGoogleDriveSession } from "./googleDriveSession";
import { measureSpeed } from "./speedMeasurements";

export function createBrowserDriveLibrary() {
  const autosave = createBrowserDriveAutosave();
  const session = getGoogleDriveSession(); const client = createGoogleDriveClient(session.auth);
  let verifiedToken: string | null = null;
  let nextPrune = 0;
  let stickyFailure: DriveStickyIndexError | null = null;
  let stickyRunning = false;
  let running = false; let disposed = false; let nextRefresh = 0; let retryAfter = 0; let paused = false; let incompleteAttempts = 0; let connectionToken: string | null = null; let queuedForce = false;
  return {
    async tick(force = false) {
      if (disposed) return false;
      if (running) { queuedForce ||= force; return false; }
      force ||= queuedForce; queuedForce = false;
      const live = session.getConnection();
      if (!live?.root || !navigator.locks) return false;
      const token = session.auth.getAccessToken();
      if (token && token !== connectionToken) { connectionToken = token; paused = false; retryAfter = 0; }
      if (!force && (paused || Date.now() < retryAfter)) return false;
      if (force) { paused = false; retryAfter = 0; }
      running = true; let completed = false;
      try {
        let scope = await getLibraryScope(); const connection = session.getConnection();
        if (!navigator.locks || !connection?.root) return false;
        if (scope && (connection.account.id !== scope.accountId || connection.root.id !== scope.rootId)) {
          throw new Error("連携済みのGoogleアカウント・Overlayフォルダへ再接続してください。");
        }
        const root = connection.root;
        await navigator.locks.request(`overlay-library-${root.id}`, { ifAvailable: true }, async (lock) => {
          if (!lock || disposed) return;
          const token = session.auth.getAccessToken();
          if (verifiedToken !== token) {
            if ((await client.getAccount()).id !== connection.account.id) throw new Error("連携先のアカウントが変わりました。");
            verifiedToken = token;
          }
          const latest = session.getConnection();
          if (disposed || !latest?.root || latest.account.id !== connection.account.id || latest.root.id !== root.id || session.auth.getAccessToken() !== token) return;
          if (!scope) {
            await enableDriveLibrary(connection.account.id, root.id);
            scope = await getLibraryScope();
          }
          if (!scope || disposed) return;
          const state = await readLibraryPending();
          if (force || Date.now() >= nextRefresh || state.pending) {
            nextRefresh = Date.now() + 30000;
            const access = await client.autosaveAccess(scope.accountId, scope.rootId);
            if (disposed) return;
            await measureSpeed("drive.library", () => syncDriveLibrary(access, scope!, { stickyIndexes: false }));
            // 大きな旧JSONの初回索引生成も本文の送信・次のハートビートを待たせない。
            // 別タブの索引更新だけを専用ロックで排他し、通常の階層・本文ロックと分ける。
            if (!stickyRunning && !disposed) {
              stickyRunning = true;
              const indexScope = scope;
              const current = () => {
                const live = session.getConnection();
                return !disposed && live?.account.id === indexScope.accountId && live.root?.id === indexScope.rootId && session.auth.getAccessToken() === token;
              };
              void navigator.locks.request(`overlay-sticky-index-${root.id}`, { ifAvailable: true }, async (lock) => {
                if (!lock || !current()) return;
                try { await measureSpeed("drive.index", () => syncDriveStickyIndexes(access, indexScope, current)); if (current()) stickyFailure = null; }
                catch (error) { if (current()) stickyFailure = error instanceof DriveStickyIndexError ? error : new DriveStickyIndexError(error); }
              }).catch((error: unknown) => { if (current()) stickyFailure = new DriveStickyIndexError(error); })
                .finally(() => { stickyRunning = false; });
            }
            incompleteAttempts = 0;
          }
          if (!disposed) await autosave.tick();
          if (!disposed && hasDriveCacheChecks()) {
            const access = await client.autosaveAccess(scope.accountId, scope.rootId);
            await checkQueuedDriveCaches(access, scope, () => {
              const live = session.getConnection();
              return !disposed && live?.account.id === scope!.accountId && live.root?.id === scope!.rootId && session.auth.getAccessToken() === token;
            });
          }
          if (!disposed) {
            if (Date.now() >= nextPrune) { nextPrune = Date.now() + 30000; await pruneDriveCache(); }
            completed = true;
          }
          // 派生索引の失敗で本文の待ち行列を止めない。案内は次の索引成功まで保持する。
          if (stickyFailure) throw stickyFailure;
        });
        return completed;
      } catch (error) {
        if (error instanceof DriveStickyIndexError) throw error;
        if (error instanceof LibraryRetry) { retryAfter = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(incompleteAttempts++, 5)); return false; }
        if (error instanceof DriveHttpError && (error.status === 0 || error.status === 429 || error.status >= 500)) retryAfter = Date.now() + 5000;
        else paused = true;
        throw error;
      } finally { running = false; }
    },
    dispose() { disposed = true; autosave.dispose(); client.dispose(); },
  };
}

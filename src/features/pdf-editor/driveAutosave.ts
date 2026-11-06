import { captureDriveJob, driveJobDue, getDriveBinding, listDriveBindings, updateDriveBinding } from "./driveOutbox";
import { reserveDriveIds, sendDriveAutosave, sha256 } from "./driveAutosaveRemote";
import { registerLibrarySource } from "./driveLibraryLocal";
import { markUploadedCache } from "./driveLibraryCache";
import { DriveHttpError } from "./driveHttpError";
import { createGoogleDriveClient } from "./googleDriveClient";
import { getGoogleDriveSession } from "./googleDriveSession";
import type { DriveNoteAccess } from "./googleDriveNotes";

type Connection = { accountId: string; rootId: string };
export type DriveAutosaveOptions = {
  connection: () => Connection | null;
  access: (connection: Connection) => Promise<DriveNoteAccess>;
  lock: (name: string, work: () => Promise<void>) => Promise<void>;
  now?: () => number;
};

// タイマー・React・Google認証とは分離。DBには本文の複製でなく送信番号・固定IDだけを残す。
export function createDriveAutosave(options: DriveAutosaveOptions) {
  let running = false;
  let disposed = false;
  const now = options.now ?? Date.now;
  return {
    async tick() {
      if (running || disposed) return;
      const connection = options.connection();
      if (!connection) return;
      running = true;
      try {
        for (const candidate of await listDriveBindings()) {
          if (disposed || !driveJobDue(candidate, now()) || candidate.accountId !== connection.accountId || candidate.rootId !== connection.rootId) continue;
          // 同じブラウザの別タブも含めて直列化。ロック未対応環境で危険な代替処理はしない。
          await options.lock(`overlay-drive-${candidate.key}`, async () => {
            try {
              let job = await captureDriveJob(candidate.id, candidate.key);
              if (!job || !driveJobDue(job.binding, now()) || disposed) return;
              const current = options.connection();
              if (!current || current.accountId !== connection.accountId || current.rootId !== connection.rootId) return;
              const access = await options.access(connection);
              if (disposed) return;
              if (!job.binding.ids) {
                const ids = await reserveDriveIds(access);
                const updated = await updateDriveBinding(candidate.id, candidate.key, (row) => ({ ...row, ids }));
                if (!updated || disposed) return;
                job = await captureDriveJob(candidate.id, candidate.key);
                if (!job || disposed) return;
              }
              const hash = job.binding.pdfHash ?? await sha256(job.backup.notes[0].pdf);
              if (!job.binding.pdfHash) {
                if (!await updateDriveBinding(candidate.id, candidate.key, (row) => ({ ...row, pdfHash: hash })) || disposed) return;
                // 初回準備中の追記を含め直す。通常更新では本文を何度も読み直さない。
                job = await captureDriveJob(candidate.id, candidate.key);
                if (!job || disposed) return;
              }
              const latest = await getDriveBinding(candidate.id);
              if (!latest?.enabled || latest.key !== candidate.key || disposed) return;
              const uploaded = await sendDriveAutosave(access, { ...job.binding, pdfHash: hash }, job.backup);
              const sentGeneration = job.binding.generation;
              await updateDriveBinding(candidate.id, candidate.key, (row) => ({ ...row,
                uploadedGeneration: Math.max(row.uploadedGeneration, sentGeneration),
                uploadedHash: row.uploadedGeneration > sentGeneration ? row.uploadedHash : uploaded.hash,
                uploadedChecksum: row.uploadedGeneration > sentGeneration ? row.uploadedChecksum : uploaded.checksum,
                uploadedJsonBytes: row.uploadedGeneration > sentGeneration ? row.uploadedJsonBytes : uploaded.bytes,
                error: undefined, retryAt: undefined, failures: 0 }));
              await registerLibrarySource(job.binding, job.backup.notes[0].fileName);
              await markUploadedCache(job.binding, job.backup, uploaded.version);
              // 送信中の新しい編集は番号が大きいまま残る。現在画面の内容を古い応答で戻さない。
            } catch (error) {
              if (disposed) return;
              // 認証切れは本文も待ち行列も変更せず、明示的な再接続後に再開する。
              const live = options.connection();
              if (!live || live.accountId !== connection.accountId || live.rootId !== connection.rootId) return;
              const transient = error instanceof DriveHttpError && (error.status === 0 || error.status === 429 || error.status >= 500);
              await updateDriveBinding(candidate.id, candidate.key, (row) => ({ ...row, failures: (row.failures ?? 0) + 1,
                ...(transient ? { retryAt: now() + Math.min(60000, 2000 * 2 ** Math.min(row.failures ?? 0, 5)) }
                  : { error: error instanceof Error ? error.message : "Driveへ保存できませんでした。" }) }));
            }
          });
        }
      } finally { running = false; }
    },
    dispose() { disposed = true; },
  };
}

export function createBrowserDriveAutosave() {
  const session = getGoogleDriveSession();
  const client = createGoogleDriveClient(session.auth); // 手動画面のclose/cancelから独立。
  let verifiedToken: string | null = null;
  const runner = createDriveAutosave({
    connection: () => {
      const value = session.getConnection();
      return value?.root ? { accountId: value.account.id, rootId: value.root.id } : null;
    },
    access: async ({ accountId, rootId }) => {
      const token = session.auth.getAccessToken();
      if (verifiedToken !== token) {
        if ((await client.getAccount()).id !== accountId) throw new Error("連携先のGoogleアカウントが変わりました。");
        verifiedToken = token;
      }
      return client.autosaveAccess(accountId, rootId);
    },
    lock: async (name, work) => {
      if (!navigator.locks) throw new Error("この環境ではDrive自動保存を利用できません。HTTPSのChromeで開いてください。");
      await navigator.locks.request(name, { ifAvailable: true }, async (lock) => { if (lock) await work(); });
    },
  });
  return { tick: runner.tick, dispose() { runner.dispose(); client.dispose(); } };
}

import { readRequest, withLocalTransaction } from "./localDatabase";
import { notifyDriveQueue } from "./driveQueueEvents";

export const DEFAULT_DRIVE_CACHE_MB = 250;
export const MIN_DRIVE_CACHE_MB = 100;
export const MAX_DRIVE_CACHE_MB = 1000;
const SETTING_ID = "cache-limit-mb";

export async function readDriveCacheLimit(tx: IDBTransaction): Promise<number> {
  const row = await readRequest<{ value: unknown } | undefined>(tx.objectStore("driveSettings").get(SETTING_ID));
  return typeof row?.value === "number" && Number.isInteger(row.value)
    && row.value >= MIN_DRIVE_CACHE_MB && row.value <= MAX_DRIVE_CACHE_MB ? row.value : DEFAULT_DRIVE_CACHE_MB;
}

// アカウントやDriveへ送らず、このブラウザの設定だけを変更する。
export async function saveDriveCacheLimit(megabytes: number) {
  if (!Number.isInteger(megabytes) || megabytes < MIN_DRIVE_CACHE_MB || megabytes > MAX_DRIVE_CACHE_MB) {
    throw new Error(`キャッシュ容量は${MIN_DRIVE_CACHE_MB}〜${MAX_DRIVE_CACHE_MB}MBの整数で指定してください。`);
  }
  await withLocalTransaction(["driveSettings"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveSettings").put({ id: SETTING_ID, value: megabytes }));
  }, false);
  notifyDriveQueue();
}

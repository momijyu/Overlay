const DATABASE_NAME = "overlay-local-notes";
const STORES = ["notes", "pdfs", "folders"] as const;
type StoreName = typeof STORES[number];
type Connection = { factory: IDBFactory; database: IDBDatabase | null; opening: Promise<IDBDatabase> };
let connection: Connection | null = null;

function releaseConnection(database: IDBDatabase) {
  if (connection?.database === database) connection = null;
  database.close();
}

function storageError(error: unknown): Error {
  if (error instanceof Error && error.name === "QuotaExceededError") {
    return new Error("このブラウザの保存容量が不足しています。未保存の内容はPDFをダウンロードして残してください。", { cause: error });
  }
  if (error instanceof Error && error.name === "UnknownError") {
    return new Error("ブラウザ内の保存場所へアクセスできません。ブラウザの設定と空き容量を確認してください。", { cause: error });
  }
  return error instanceof Error ? error : new Error("このブラウザへ保存できませんでした。", { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("この環境ではブラウザ内保存を使用できません。"));
  if (connection?.factory === indexedDB) return connection.opening;
  // 接続中のPromiseも共有し、同時の一覧取得・保存でもopenを重複させない。
  connection?.database?.close();
  const current: Connection = { factory: indexedDB, database: null, opening: null! };
  connection = current;
  current.opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("保存場所を準備できません。他のOverlayのタブを閉じて再試行してください。"));
    };
    request.onsuccess = () => {
      const database = request.result;
      // 将来の形式更新時に、古いタブが更新を止め続けないようにする。
      database.onversionchange = () => releaseConnection(database);
      database.onclose = () => { if (connection === current) connection = null; };
      if (blocked || connection !== current) {
        database.close();
        reject(new Error("保存場所への接続が変更されました。再試行してください。"));
      } else {
        current.database = database;
        resolve(database);
      }
    };
  }).catch((error: unknown) => {
    if (connection === current) connection = null;
    throw storageError(error);
  });
  return current.opening;
}

export function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// work内ではIndexedDBの要求だけを待つ。PDF解析や通信はトランザクションの外で行う。
// 個々のput成功ではなく、全体のcommit完了を待ってから画面へ成功を返す。
export async function withLocalTransaction<T>(
  stores: StoreName[], mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  let database = await openDatabase();
  let transaction: IDBTransaction;
  try { transaction = database.transaction(stores, mode); }
  catch (error) {
    // 閉じた接続を掴んだ場合だけ、処理開始前に1回接続し直す。
    // 書き込み開始後の失敗を自動再実行して二重更新することはしない。
    if (!(error instanceof Error) || error.name !== "InvalidStateError") {
      if (error instanceof Error && error.name === "UnknownError") releaseConnection(database);
      throw storageError(error);
    }
    releaseConnection(database);
    database = await openDatabase();
    transaction = database.transaction(stores, mode);
  }
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let failure: unknown;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => {
      const error = failure ?? transaction.error;
      if (error instanceof Error && error.name === "UnknownError") releaseConnection(database);
      reject(storageError(error));
    };
    transaction.onerror = () => { /* 要求の失敗はonabortでまとめて扱う。 */ };
    void work(transaction).then((value) => { result = value; }, (error: unknown) => {
      failure = error;
      try { transaction.abort(); } catch { reject(storageError(error)); }
    });
  });
}

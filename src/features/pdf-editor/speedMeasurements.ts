// 計測は明示的な開始中だけ。PDF本文・名前・ID・URL・認証情報・例外本文は受け取らない。
export const SPEED_PHASES = {
  "note.open": "ノートを開く（描画準備完了まで）",
  "note.flush": "切替前の端末保存待ち",
  "note.read": "ノート取得・検証・端末読み込み",
  "pdf.prepare": "PDF.js準備・PDFバイト取得",
  "pdf.parse": "PDF解析・Worker準備",
  "pdf.render": "ページ描画・Canvas反映",
  "local.save": "端末への確定保存",
  "drive.save": "Drive自動保存（準備から端末への結果反映まで）",
  "drive.transfer": "Drive本文送信・検証",
  "drive.library": "Drive一覧・階層同期",
  "drive.index": "付箋索引の背景同期",
  "drive.http": "Drive HTTP応答・受信",
  "drive.pdf": "Drive元PDFの照合・取得",
  "drive.connection": "Drive接続確認の再利用判定",
} as const;
export type SpeedPhase = keyof typeof SPEED_PHASES;
export type SpeedOutcome = "ok" | "error" | "cancelled" | "choice" | "incomplete";
type RequestKind = "account" | "list" | "metadata" | "download" | "upload";
type Method = "GET" | "POST" | "PUT" | "PATCH";
const connectionChecks = ["account-hit", "account-expired", "account-missing", "account-explicit",
  "root-hit", "root-expired", "root-missing", "root-mismatch", "root-explicit"] as const;
export type ConnectionCheck = typeof connectionChecks[number];
export type SpeedInfo = {
  pdfBytes?: number; pageCount?: number; width?: number; height?: number;
  queueWaitMs?: number; sinceLastChangeMs?: number; pendingMs?: number;
  headersMs?: number; bodyMs?: number; httpStatus?: number;
  firstUpload?: boolean; pdfReused?: boolean; requestKind?: RequestKind; method?: Method;
  connectionCheck?: ConnectionCheck;
};
export type SpeedRecord = {
  id: number; parentId?: number; phase: SpeedPhase; startMs: number; durationMs: number;
  outcome: SpeedOutcome; info: SpeedInfo;
};
export type SpeedSpan = { id?: number; finish: (outcome?: SpeedOutcome, info?: SpeedInfo) => void; elapsedMs: () => number };
const NO_SPAN: SpeedSpan = Object.freeze({ finish() {}, elapsedMs: () => 0 });
const MAX_RECORDS = 1000;
const MAX_ACTIVE = 100;
const numericFields = ["pdfBytes", "pageCount", "width", "height", "queueWaitMs", "sinceLastChangeMs", "pendingMs", "headersMs", "bodyMs", "httpStatus"] as const;
function numeric(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(Math.min(value, Number.MAX_SAFE_INTEGER / 100) * 100) / 100 : undefined; }
function safeInfo(input: SpeedInfo = {}): SpeedInfo {
  const info: SpeedInfo = {};
  for (const key of numericFields) { const value = numeric(input[key]); if (value !== undefined) info[key] = value; }
  if (typeof input.firstUpload === "boolean") info.firstUpload = input.firstUpload;
  if (typeof input.pdfReused === "boolean") info.pdfReused = input.pdfReused;
  if (connectionChecks.includes(input.connectionCheck as ConnectionCheck)) info.connectionCheck = input.connectionCheck;
  if (["account", "list", "metadata", "download", "upload"].includes(input.requestKind ?? "")) info.requestKind = input.requestKind;
  if (["GET", "POST", "PUT", "PATCH"].includes(input.method ?? "")) info.method = input.method;
  return info;
}

export function createSpeedMeasurements(clock: () => number = () => performance.now()) {
  let recording = false, session = 0, nextId = 0, started = 0, ended = 0, dropped = 0;
  let records: SpeedRecord[] = [];
  const active = new Map<number, { phase: SpeedPhase; start: number; info: SpeedInfo; parentId?: number }>();
  const now = () => { try { return numeric(clock()) ?? 0; } catch { return 0; } };
  function append(record: SpeedRecord) {
    if (records.length >= MAX_RECORDS) { records.shift(); dropped++; }
    records.push(record);
  }
  function snapshot() {
    return { formatVersion: 1, recording, elapsedMs: Math.max(0, (recording ? now() : ended) - started),
      dropped, active: active.size, records: records.map((row) => ({ ...row, info: { ...row.info } })) };
  }
  function begin(phase: SpeedPhase, info?: SpeedInfo, parentId?: number): SpeedSpan {
    if (!recording || !Object.hasOwn(SPEED_PHASES, phase)) return NO_SPAN;
    if (active.size >= MAX_ACTIVE) { dropped++; return NO_SPAN; }
    const id = ++nextId, epoch = session, start = now();
    active.set(id, { phase, start, info: safeInfo(info), ...(active.has(parentId ?? -1) ? { parentId } : {}) });
    return {
      id,
      elapsedMs: () => recording && session === epoch ? Math.max(0, now() - start) : 0,
      finish(outcome = "ok", details) {
        const pending = active.get(id);
        if (!recording || session !== epoch || !pending) return;
        active.delete(id);
        append({ id, phase, ...(pending.parentId === undefined ? {} : { parentId: pending.parentId }),
          startMs: Math.max(0, start - started), durationMs: Math.max(0, now() - start),
          outcome: ["ok", "error", "cancelled", "choice", "incomplete"].includes(outcome) ? outcome : "error",
          info: { ...pending.info, ...safeInfo(details) } });
      },
    };
  }
  return {
    begin, snapshot,
    // IDをセッション間で再使用せず、古い画面から渡された親IDを次の処理へ結び付けない。
    start() { session++; recording = true; dropped = 0; records = []; active.clear(); started = ended = now(); return snapshot(); },
    stop() {
      if (recording) {
        ended = now();
        for (const [id, pending] of active) append({ id, phase: pending.phase, parentId: pending.parentId,
          startMs: Math.max(0, pending.start - started), durationMs: Math.max(0, ended - pending.start), outcome: "incomplete", info: pending.info });
        active.clear(); recording = false; session++;
      }
      return snapshot();
    },
    clear() { recording = false; session++; dropped = started = ended = 0; records = []; active.clear(); return snapshot(); },
  };
}

export const speedMeasurements = createSpeedMeasurements();
export async function measureSpeed<T>(phase: SpeedPhase, work: () => Promise<T>, info?: SpeedInfo, parentId?: number): Promise<T> {
  const span = speedMeasurements.begin(phase, info, parentId);
  try { const result = await work(); span.finish(); return result; }
  catch (error) { span.finish("error"); throw error; }
}

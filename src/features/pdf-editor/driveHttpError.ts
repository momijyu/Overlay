// 生のGoogle応答・URL・トークンを外へ出さず、再試行判定に必要なHTTP状態だけ保持する。
export class DriveHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// トランザクションの完了後だけ通知する。本文や認証情報はイベントへ載せない。
const listeners = new Set<() => void>();
export function notifyDriveQueue() { for (const listener of listeners) listener(); }
export function subscribeDriveQueue(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

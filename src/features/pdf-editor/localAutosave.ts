import type { PenStroke, TextNotesByPage } from "./types";

type Strokes = Record<number, PenStroke[]>;
export type LocalSaveInput = {
  file: File;
  strokesByPage: Strokes;
  textsByPage?: TextNotesByPage;
  noteId: string | null;
  expectedRevision: number;
};
export type LocalSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  noteId: string | null;
  savedStrokes: Strokes | null;
  savedTexts: TextNotesByPage;
  error: string | null;
};

// 1つのPDFにつき1つ作る保存係。Reactから分け、保存順と失敗時の動作をテストする。
export function createLocalAutosave(options: {
  file: File;
  noteId: string | null;
  strokesByPage: Strokes;
  textsByPage?: TextNotesByPage;
  revision?: number;
  persist: (input: LocalSaveInput) => Promise<string>;
  onChange: (state: LocalSaveState) => void;
}) {
  let latest = options.strokesByPage;
  let latestTexts = options.textsByPage ?? {};
  let savedTexts = latestTexts;
  // 新規PDFを選んだだけではDirtyにしない。最初のupdate（描画完了）で保存する。
  let saved = latest;
  let noteId = options.noteId;
  let revision = options.revision ?? 0;
  let status: LocalSaveState["status"] = options.noteId ? "saved" : "idle";
  let error: string | null = null;
  let running: Promise<boolean> | null = null;
  let disposed = false;

  function getState(): LocalSaveState {
    return { status, noteId, savedStrokes: saved, savedTexts, error };
  }

  function notify() {
    if (!disposed) options.onChange(getState());
  }

  function hasPendingChanges() {
    return latest !== saved || latestTexts !== savedTexts;
  }

  function flush(retry = false): Promise<boolean> {
    // 手動保存・自動保存が重なっても、実行中の同じ処理を待つ。
    if (running) return running;
    if (disposed) return Promise.resolve(!hasPendingChanges());
    if (error && !retry) return Promise.resolve(false);
    if (!hasPendingChanges()) return Promise.resolve(true);

    error = null;
    status = "saving";
    running = Promise.resolve().then(async () => {
      try {
        while (hasPendingChanges()) {
          const snapshot = latest;
          const textSnapshot = latestTexts;
          noteId = await options.persist({
            file: options.file, strokesByPage: snapshot, textsByPage: textSnapshot, noteId, expectedRevision: revision,
          });
          revision += 1;
          saved = snapshot;
          savedTexts = textSnapshot;
          // 保存中に追加された線は保存済みにせず、最新の状態を続けて保存する。
          notify();
        }
        status = "saved";
        notify();
        return true;
      } catch (saveError) {
        status = "error";
        error = saveError instanceof Error ? saveError.message : "ノートを保存できませんでした。";
        notify();
        return false;
      }
    }).finally(() => {
      running = null;
      if (!disposed && !error && hasPendingChanges()) void flush();
    });
    notify();
    return running;
  }

  return {
    getState,
    hasPendingChanges,
    flush,
    update(strokesByPage: Strokes, textsByPage = latestTexts) {
      if (disposed) return;
      latest = strokesByPage;
      latestTexts = textsByPage;
      // 失敗後は勝手な連続再試行をせず、最新の線を保持して手動の再試行を待つ。
      if (error) notify();
      else void flush();
    },
    dispose() {
      // 開始済みの保存は取り消さない。切り替え後の画面への通知だけを止める。
      disposed = true;
    },
  };
}

export type LocalAutosave = ReturnType<typeof createLocalAutosave>;

// 終了時だけに頼らず、普段の描画完了時に保存する。これらのイベントは補助。
export function attachLocalAutosaveLifecycle(
  view: Window, page: Document, getAutosave: () => LocalAutosave | null,
): () => void {
  function warnBeforeLeaving(event: BeforeUnloadEvent) {
    const autosave = getAutosave();
    if (!autosave?.hasPendingChanges()) return;
    void autosave.flush();
    event.preventDefault();
    event.returnValue = "";
  }
  function saveWhenHidden() {
    if (page.visibilityState === "hidden") void getAutosave()?.flush();
  }
  function saveWhenLeaving() {
    void getAutosave()?.flush();
  }
  view.addEventListener("beforeunload", warnBeforeLeaving);
  page.addEventListener("visibilitychange", saveWhenHidden);
  view.addEventListener("pagehide", saveWhenLeaving);
  return () => {
    view.removeEventListener("beforeunload", warnBeforeLeaving);
    page.removeEventListener("visibilitychange", saveWhenHidden);
    view.removeEventListener("pagehide", saveWhenLeaving);
  };
}

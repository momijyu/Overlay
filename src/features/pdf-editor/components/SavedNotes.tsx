"use client";

import { useEffect, useState } from "react";

import { listSavedNotes } from "../loadNotes";
import type { SavedNoteSummary } from "../types";

type SavedNotesProps = {
  refreshVersion: number;
  currentNoteId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
};

export function SavedNotes({
  refreshVersion,
  currentNoteId,
  disabled,
  onOpen,
}: SavedNotesProps) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${refreshVersion}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    notes: SavedNoteSummary[];
    error: string | null;
  }>({ key: "", notes: [], error: null });
  const isLoading = result.key !== requestKey;

  useEffect(() => {
    let active = true;
    listSavedNotes().then(
      (notes) => {
        if (active) setResult({ key: requestKey, notes, error: null });
      },
      (error: unknown) => {
        if (active) {
          setResult({
            key: requestKey,
            notes: [],
            error: error instanceof Error
              ? error.message
              : "ノート一覧を読み込めませんでした。",
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [requestKey]);

  return (
    <section
      aria-labelledby="saved-notes-heading"
      className="border-b border-base-300 pb-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="saved-notes-heading" className="text-lg font-semibold">
          保存済みノート
        </h2>
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled || isLoading}
          onClick={() => setRetry((value) => value + 1)}
        >
          一覧を更新
        </button>
      </div>
      {isLoading ? (
        <p role="status">一覧を読み込んでいます…</p>
      ) : result.error ? (
        <div className="alert alert-error" role="alert">{result.error}</div>
      ) : result.notes.length === 0 ? (
        <p>このブラウザで保存したノートはありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">ファイル名</th>
                <th scope="col">更新日時</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {result.notes.map((note) => (
                <tr key={note.id}>
                  <td className="break-all">{note.fileName}</td>
                  <td className="whitespace-nowrap">
                    <time dateTime={note.updatedAt}>
                      {new Date(note.updatedAt).toLocaleString("ja-JP")}
                    </time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={disabled || note.id === currentNoteId}
                      onClick={() => onOpen(note.id)}
                      aria-label={`${note.fileName}を開く`}
                    >
                      {note.id === currentNoteId ? "編集中" : "開く"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

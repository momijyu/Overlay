import { EditorIcon } from "./EditorIcon";

type HistoryControlsProps = {
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

export function HistoryControls({ canUndo, canRedo, disabled, onUndo, onRedo }: HistoryControlsProps) {
  return (
    <div className="join" role="group" aria-label="編集履歴">
      <button type="button" className="btn btn-square btn-ghost join-item" aria-label="元に戻す" title="元に戻す"
        disabled={disabled || !canUndo} onClick={() => { if (!disabled && canUndo) onUndo(); }}>
        <EditorIcon name="undo" />
      </button>
      <button type="button" className="btn btn-square btn-ghost join-item" aria-label="やり直す" title="やり直す"
        disabled={disabled || !canRedo} onClick={() => { if (!disabled && canRedo) onRedo(); }}>
        <EditorIcon name="redo" />
      </button>
    </div>
  );
}

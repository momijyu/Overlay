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
      <button type="button" className="btn btn-sm join-item" disabled={disabled || !canUndo}
        onClick={() => { if (!disabled && canUndo) onUndo(); }}>元に戻す</button>
      <button type="button" className="btn btn-sm join-item" disabled={disabled || !canRedo}
        onClick={() => { if (!disabled && canRedo) onRedo(); }}>やり直す</button>
    </div>
  );
}

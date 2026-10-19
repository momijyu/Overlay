type EraserSizeControlProps = {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export function EraserSizeControl({ value, disabled, onChange }: EraserSizeControlProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="label" htmlFor="eraser-width">消しゴムサイズ</label>
      <input
        id="eraser-width"
        type="range"
        className="range range-sm w-32"
        min={4}
        max={64}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!disabled && Number.isInteger(next) && next >= 4 && next <= 64) onChange(next);
        }}
      />
      <output htmlFor="eraser-width" className="w-6 text-right tabular-nums">{value}</output>
    </div>
  );
}

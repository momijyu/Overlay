import { PEN_WIDTH_OPTIONS } from "../penStyle";

type PenWidthControlProps = {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export function PenWidthControl({ value, disabled, onChange }: PenWidthControlProps) {
  const index = PEN_WIDTH_OPTIONS.findIndex((option) => option.width === value);
  const selectedIndex = index < 0 ? 2 : index;
  const selected = PEN_WIDTH_OPTIONS[selectedIndex];

  return (
    <div className="flex items-center gap-2">
      <label className="label" htmlFor="pen-width">ペンの太さ</label>
      <input
        id="pen-width"
        type="range"
        className="range range-sm w-32"
        min={0}
        max={PEN_WIDTH_OPTIONS.length - 1}
        step={1}
        value={selectedIndex}
        aria-valuetext={`${selected.label}（${selectedIndex + 1}/5）`}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!disabled && event.target.value !== "" && Number.isInteger(next)
            && next >= 0 && next < PEN_WIDTH_OPTIONS.length) {
            onChange(PEN_WIDTH_OPTIONS[next].width);
          }
        }}
      />
      <output htmlFor="pen-width" className="w-8 text-center text-sm">{selected.label}</output>
    </div>
  );
}

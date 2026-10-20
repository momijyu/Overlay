import { MARKER_WIDTH_OPTIONS, PEN_WIDTH_OPTIONS } from "../penStyle";

type PenWidthControlProps = {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  tool?: "pen" | "marker";
};

export function PenWidthControl({ value, disabled, onChange, tool = "pen" }: PenWidthControlProps) {
  const options = tool === "marker" ? MARKER_WIDTH_OPTIONS : PEN_WIDTH_OPTIONS;
  const id = tool === "marker" ? "marker-width" : "pen-width";
  const index = options.findIndex((option) => option.width === value);
  const selectedIndex = index < 0 ? 2 : index;
  const selected = options[selectedIndex];

  return (
    <div className="flex items-center gap-2">
      <label className="label" htmlFor={id}>{tool === "marker" ? "マーカーの太さ" : "ペンの太さ"}</label>
      <input
        id={id}
        type="range"
        className="range range-sm w-32"
        min={0}
        max={options.length - 1}
        step={1}
        value={selectedIndex}
        aria-valuetext={`${selected.label}（${selectedIndex + 1}/5）`}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!disabled && event.target.value !== "" && Number.isInteger(next)
            && next >= 0 && next < options.length) {
            onChange(options[next].width);
          }
        }}
      />
      <output htmlFor={id} className="w-8 text-center text-sm">{selected.label}</output>
    </div>
  );
}

import { MAX_PAGE_ZOOM, MIN_PAGE_ZOOM } from "../pageZoom";

export function ZoomControl({ value, disabled, onChange }: {
  value: number;
  disabled: boolean;
  onChange: (zoom: number) => void;
}) {
  return <div className="flex items-center gap-2">
    <label className="label" htmlFor="pdf-zoom">表示倍率</label>
    <input id="pdf-zoom" type="range" className="range range-sm w-28"
      min={MIN_PAGE_ZOOM * 100} max={MAX_PAGE_ZOOM * 100} step={1}
      value={Math.round(value * 100)} disabled={disabled}
      aria-valuetext={`${Math.round(value * 100)}%`}
      title="Ctrl／Command＋ホイールで拡大・縮小"
      onChange={(event) => {
        const percent = Number(event.target.value);
        if (!disabled && event.target.value.trim() && Number.isInteger(percent)
          && percent >= MIN_PAGE_ZOOM * 100 && percent <= MAX_PAGE_ZOOM * 100) onChange(percent / 100);
      }} />
    <output htmlFor="pdf-zoom" className="w-12 text-right text-sm tabular-nums">{Math.round(value * 100)}%</output>
  </div>;
}

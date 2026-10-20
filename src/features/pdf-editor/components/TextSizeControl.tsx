import { useState } from "react";
import { MAX_NOTE_FONT_SIZE, MIN_NOTE_FONT_SIZE } from "../textData";

export function TextSizeControl({ value, onChange, disabled = false }: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  // 数字を一旦空にして打ち直せるようにする。範囲外は文章へ渡さず、欄を離れたら元に戻す。
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  function change(raw: string) {
    const size = Number(raw);
    if (!disabled && raw.trim() && Number.isInteger(size) && size >= MIN_NOTE_FONT_SIZE && size <= MAX_NOTE_FONT_SIZE) onChange(size);
  }
  return <div className="flex flex-wrap items-center gap-2">
    <label className="label text-sm" htmlFor="text-font-size">文字サイズ</label>
    <span className="text-xs" aria-hidden="true">小</span>
    <input id="text-font-size" type="range" className="range range-sm w-28"
      min={MIN_NOTE_FONT_SIZE} max={MAX_NOTE_FONT_SIZE} step={1} value={value} disabled={disabled}
      onChange={(event) => { setNumberDraft(null); change(event.target.value); }} />
    <span className="text-xs" aria-hidden="true">大</span>
    <input type="number" aria-label="文字サイズを数値で指定" className="input input-xs w-16"
      min={MIN_NOTE_FONT_SIZE} max={MAX_NOTE_FONT_SIZE} step={1} value={numberDraft ?? value} disabled={disabled}
      onChange={(event) => { setNumberDraft(event.target.value); change(event.target.value); }}
      onBlur={() => setNumberDraft(null)} />
  </div>;
}

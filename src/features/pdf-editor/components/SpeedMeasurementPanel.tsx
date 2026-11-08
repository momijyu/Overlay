"use client";

import { useState } from "react";
import { SPEED_PHASES, speedMeasurements } from "../speedMeasurements";

export function SpeedMeasurementPanel() {
  const [snapshot, setSnapshot] = useState(() => speedMeasurements.snapshot());
  const [error, setError] = useState<string | null>(null);
  function download() {
    try {
      const result = speedMeasurements.snapshot();
      const agent = navigator.userAgent;
      const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox"
        : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other";
      const report = { ...result, environment: { browser, build: process.env.NODE_ENV,
        width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio }, phases: SPEED_PHASES };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      try {
        const link = document.createElement("a"); link.href = url; link.download = "overlay-speed.json";
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setError(null);
    } catch { setError("計測結果を書き出せませんでした。もう一度お試しください。"); }
  }
  return <details className="border-t border-base-300 pt-3" onToggle={(event) => {
    if (event.currentTarget.open) setSnapshot(speedMeasurements.snapshot());
  }}>
    <summary className="cursor-pointer py-2 text-sm">速度計測</summary>
    <div className="space-y-3 pt-2 text-sm">
      <p className="text-xs">開始後にノートを開き、編集してください。内容・名前・認証情報は記録しません。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" disabled={snapshot.recording} onClick={() => { setError(null); setSnapshot(speedMeasurements.start()); }}>計測を開始</button>
        <button type="button" className="btn btn-sm" disabled={!snapshot.recording} onClick={() => setSnapshot(speedMeasurements.stop())}>計測を停止</button>
        <button type="button" className="btn btn-sm" disabled={snapshot.recording || !snapshot.records.length} onClick={download}>結果を保存</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={snapshot.recording || !snapshot.records.length}
          onClick={() => { setError(null); setSnapshot(speedMeasurements.clear()); }}>結果を消去</button>
      </div>
      <p role="status" className="text-xs">{snapshot.recording ? "計測中。画面を閉じても継続します。" : `${snapshot.records.length}件の計測結果`}</p>
      {snapshot.dropped > 0 && <p className="text-xs">記録上限により一部を省略しました。操作を分けて再計測してください。</p>}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  </details>;
}

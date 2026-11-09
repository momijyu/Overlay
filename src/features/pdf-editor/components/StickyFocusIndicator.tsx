import { useEffect, useRef } from "react";
import { revealStickyElement } from "../stickyNavigation";

export function StickyFocusIndicator({ textId, request, x, y, width, height }: {
  textId: string; request: number; x: number; y: number; width: number; height: number;
}) {
  const ref = useRef<SVGRectElement>(null);
  useEffect(() => {
    if (ref.current) revealStickyElement(ref.current);
  }, [request]);
  return <rect ref={ref} data-sticky-focus={textId} className="sticky-jump-highlight"
    x={x} y={y} width={width} height={height} fill="none" stroke="var(--color-primary)"
    strokeWidth="3" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
}

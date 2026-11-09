import assert from "node:assert/strict";
import test from "node:test";
import { revealStickyElement } from "@/features/pdf-editor/stickyNavigation";

function fixture(target: { left: number; top: number; width: number; height: number }) {
  let revealed = 0;
  const viewport = { scrollLeft: 20, scrollTop: 40, clientWidth: 400, clientHeight: 300,
    scrollWidth: 1000, scrollHeight: 2000, clientLeft: 2, clientTop: 2,
    getBoundingClientRect: () => ({ left: 10, top: 100 }),
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      assert.deepEqual(options, { block: "nearest", inline: "nearest" }); revealed++;
    } };
  const element = { closest: (selector: string) => selector === ".pdf-viewport" ? viewport : null,
    getBoundingClientRect: () => ({ ...target, x: target.left, y: target.top }) } as unknown as Element;
  return { viewport, element, revealed: () => revealed };
}

test("付箋の実表示座標からPDF内の中央へ移動し、PDF領域も見える位置へ戻す", () => {
  const f = fixture({ left: 612, top: 1302, width: 100, height: 60 });
  revealStickyElement(f.element);
  assert.equal(f.viewport.scrollLeft, 470);
  assert.equal(f.viewport.scrollTop, 1120);
  assert.equal(f.revealed(), 1);
});

test("拡大された付箋も表示上の大きさで移動し、座標や倍率へ書き込まない", () => {
  const f = fixture({ left: 212, top: 602, width: 200, height: 120 });
  revealStickyElement(f.element);
  assert.equal(f.viewport.scrollLeft, 120);
  assert.equal(f.viewport.scrollTop, 450);
});

test("スクロール上限と下限を超えず、大きな付箋は先頭を見える位置に置く", () => {
  const small = fixture({ left: -100, top: -100, width: 100, height: 60 });
  revealStickyElement(small.element);
  assert.equal(small.viewport.scrollLeft, 0); assert.equal(small.viewport.scrollTop, 0);
  const large = fixture({ left: 900, top: 1900, width: 500, height: 400 });
  revealStickyElement(large.element);
  assert.equal(large.viewport.scrollLeft, 600); assert.equal(large.viewport.scrollTop, 1700);
  const oversized = fixture({ left: 112, top: 302, width: 500, height: 400 });
  revealStickyElement(oversized.element);
  assert.equal(oversized.viewport.scrollLeft, 108); assert.equal(oversized.viewport.scrollTop, 228);
});

test("まだ配置できていない付箋やPDF領域外ではスクロールしない", () => {
  const f = fixture({ left: 10, top: 10, width: 0, height: 10 });
  revealStickyElement(f.element); assert.equal(f.revealed(), 0);
  revealStickyElement({ closest: () => null } as unknown as Element);
});

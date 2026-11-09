import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";
import type { LibraryConflictItem } from "@/features/pdf-editor/driveLibraryData";
import { DriveVersionRequired } from "@/features/pdf-editor/driveLibraryCache";

mock.module("react", { exports: { ...React, useEffect: () => {}, useRef: () => ({ current: null }) } });
const { DrivePlacementDialog } = await import("@/features/pdf-editor/components/DrivePlacementDialog");
const { DriveVersionDialog } = await import("@/features/pdf-editor/components/DriveVersionDialog");

function entries(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...entries(child.props.children as React.ReactNode)] : []);
}

const versions: LibraryConflictItem = { key: "note:item", versions: [
  { head: "first", deviceId: "browser-a", entry: { id: "item", kind: "note", name: "資料".repeat(60), parentId: null } },
  { head: "second", deviceId: "browser-b", entry: { id: "item", kind: "note", name: "変更後の資料", parentId: null } },
] };

test("本文・配置の競合候補が長くても、キャンセルはスクロール領域の外に残す", () => {
  const choice = new DriveVersionRequired("item", "資料".repeat(60), Array.from({ length: 30 }, (_, index) => ({
    logicalId: "item", noteId: `source-${index}`, noteKey: `key-${index}`, containerId: `container-${index}`,
    deviceId: `browser-${index}`, fileName: "資料.pdf",
  })));
  for (const node of [
    DriveVersionDialog({ choice, onChoose() {}, onClose() {} }),
    DrivePlacementDialog({ conflict: versions, entities: [], busy: false, onChoose() {}, onClose() {} }),
  ]) {
    const all = entries(node);
    const scroll = all.find((entry) => "data-conflict-scroll" in entry.props)!;
    assert.ok(scroll);
    assert.match(String(scroll.props.className), /min-h-0.*overflow-y-auto/);
    assert.ok(all.some((entry) => entry.type === "button" && entry.props.children === "キャンセル"));
    assert.equal(entries(scroll).find((entry) => entry.props.children === "キャンセル"), undefined);
    const box = all.find((entry) => String(entry.props.className).startsWith("modal-box"))!;
    assert.match(String(box.props.className), /max-h-\[calc\(100dvh-2rem\)\].*overflow-hidden/);
  }
});

test("配置の採用先・取消の操作を維持し、処理中や削除競合では誤採用を防ぐ", () => {
  for (const busy of [false, true]) {
    let chosen = "", closed = 0;
    const node = DrivePlacementDialog({ conflict: versions, entities: [], busy,
      onChoose: (head) => { chosen = head; }, onClose: () => { closed++; } });
    const all = entries(node);
    const scroll = all.find((entry) => "data-conflict-scroll" in entry.props)!;
    const candidates = entries(scroll).filter((entry) => entry.type === "button");
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((entry) => entry.props.disabled === busy));
    assert.ok(candidates.every((entry) => String(entry.props.className).includes("whitespace-normal")));
    if (!busy) (candidates[1].props.onClick as () => void)();
    assert.equal(chosen, busy ? "" : "second");
    const modal = all.find((entry) => entry.type === "dialog")!;
    (modal.props.onCancel as (event: unknown) => void)({ preventDefault() {}, stopPropagation() {} });
    assert.equal(closed, busy ? 0 : 1);
  }
  const deletion = { ...versions, versions: versions.versions.map((version) => ({ ...version, entry: { ...version.entry, deleted: true } })) };
  const node = DrivePlacementDialog({ conflict: deletion, entities: [], busy: false, onChoose() {}, onClose() {} });
  const scroll = entries(node).find((entry) => "data-conflict-scroll" in entry.props)!;
  assert.ok(entries(scroll).filter((entry) => entry.type === "button").every((entry) => entry.props.disabled));
});

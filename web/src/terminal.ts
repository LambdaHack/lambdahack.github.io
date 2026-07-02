// Renderer wiring: a DOM grid of <span> cells, repainted from the engine's
// Word32 frame buffer via the pure styledCell logic. Per-cell diffing skips
// unchanged cells (the engine sends full frames). Not unit-tested (DOM wiring);
// all the decisions live in terminal-core.

import { styledCell } from "./terminal-core.js";

export interface Terminal {
  paint(addr: number, w: number, h: number): void;
}

export type KeyHandler = (
  key: string,
  ctrl: boolean,
  shift: boolean,
  alt: boolean,
  meta: boolean,
) => void;

// col/row are 0-based screen-cell coordinates, matching Dom.hs's per-cell
// mouse handlers (Point{px,py} derived from the cell, not sub-cell offset).
export type WheelHandler = (
  col: number,
  row: number,
  deltaY: number,
  ctrl: boolean,
  shift: boolean,
  alt: boolean,
  meta: boolean,
) => void;

export type MouseHandler = (
  col: number,
  row: number,
  button: number,
  ctrl: boolean,
  shift: boolean,
  alt: boolean,
  meta: boolean,
) => void;

export function mountTerminal(
  container: HTMLElement,
  getMemory: () => WebAssembly.Memory,
  onKey: KeyHandler,
  onWheel: WheelHandler,
  onMouseUp: MouseHandler,
): Terminal {
  let cols = 0;
  let rows = 0;
  let spans: HTMLSpanElement[] = [];
  let prev = new Uint32Array(0);

  function buildGrid(w: number, h: number): void {
    cols = w;
    rows = h;
    container.textContent = "";
    container.style.display = "grid";
    container.style.gridTemplateColumns = `repeat(${w}, 1ch)`;
    container.style.gridAutoRows = "1em";
    container.style.fontFamily = "monospace";
    container.style.lineHeight = "1em";
    container.style.whiteSpace = "pre";
    spans = new Array(w * h);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < w * h; i++) {
      const el = document.createElement("span");
      el.style.textAlign = "center";
      const col = i % w;
      const row = (i / w) | 0;
      // { passive: false } is required to preventDefault() a wheel listener.
      el.addEventListener(
        "wheel",
        (e) => {
          onWheel(col, row, e.deltaY, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey);
          e.preventDefault();
          e.stopPropagation();
        },
        { passive: false },
      );
      el.addEventListener("contextmenu", (e) => {
        // Right-click is delivered via mouseup below, same as Dom.hs.
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener("mouseup", (e) => {
        onMouseUp(col, row, e.button, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey);
        e.preventDefault();
        e.stopPropagation();
      });
      spans[i] = el;
      frag.appendChild(el);
    }
    container.appendChild(frag);
    // Force a full repaint of the new grid.
    prev = new Uint32Array(w * h).fill(0xffffffff);
  }

  let pendingFrame: Uint32Array | null = null;
  let rafHandle: number | null = null;

  // Apply one already-snapshotted frame's cell diffs to the DOM. Deferred
  // to requestAnimationFrame by paint() below, batching same-tick calls
  // into a single browser paint, mirroring Dom.hs's
  // requestAnimationFrame_/newRequestAnimationFrameCallbackSync.
  function applyFrame(buf: Uint32Array): void {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === prev[i]) continue;
      prev[i] = buf[i];
      const s = styledCell(buf[i], (i / cols) | 0);
      const el = spans[i];
      el.textContent = s.char;
      el.style.color = s.color;
      el.style.backgroundColor = s.background;
      // Highlight square as an inset outline: invisible when it equals the bg.
      el.style.boxShadow = `inset 0 0 0 1px ${s.border}`;
    }
  }

  function paint(addr: number, w: number, h: number): void {
    if (w !== cols || h !== rows) buildGrid(w, h);
    // Snapshot synchronously: the wasm buffer at `addr` is only valid for
    // the duration of this call (Wasm.hs's display uses an `unsafe` FFI
    // import specifically so the GC can't move/reuse it mid-call). Reading
    // it from a later rAF callback would risk reading stale/reused memory,
    // so only the DOM-mutation work in applyFrame is deferred, not the read.
    pendingFrame = new Uint32Array(getMemory().buffer, addr, w * h).slice();
    if (rafHandle === null) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        const frame = pendingFrame;
        pendingFrame = null;
        if (frame) applyFrame(frame);
      });
    }
  }

  // Keys a Ctrl-only chord should still pass to the browser for, mirroring
  // Dom.hs's `browserKeys = "+-0tTnNdxcv"` allowlist: zoom, tab/window
  // management, bookmark, clipboard. Both cases of t/n are listed there (and
  // ported here) to also cover Caps Lock, not Shift -- the modifier check
  // below requires a bare Ctrl chord, so Ctrl+Shift+T doesn't qualify.
  const CTRL_PASSTHROUGH_KEYS = new Set([
    "+", "-", "0", "t", "T", "n", "N", "d", "x", "c", "v",
  ]);

  // Verified against Key.hs's keyTranslateWeb: every KeyboardEvent.key value
  // its DeadKey clauses cover -- chiefly, any modifier key pressed by itself
  // (Shift, Control, Alt/AltGraph, Meta, CapsLock, NumLock, Win,
  // Menu/ContextMenu) plus the literal "Dead" compose-key event.
  const DEAD_KEYS = new Set([
    "Dead", "Shift", "Control", "Meta", "Menu", "ContextMenu",
    "Alt", "AltGraph", "Num_Lock", "NumLock", "Caps_Lock", "CapsLock", "Win",
  ]);

  window.addEventListener("keydown", (e) => {
    onKey(e.key, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey);

    const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
    const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    const isDeadKey = DEAD_KEYS.has(e.key);

    const passThrough =
      altOnly || (ctrlOnly && CTRL_PASSTHROUGH_KEYS.has(e.key)) || isDeadKey;

    if (!passThrough) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  return { paint };
}

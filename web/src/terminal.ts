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

  function paint(addr: number, w: number, h: number): void {
    if (w !== cols || h !== rows) buildGrid(w, h);
    const buf = new Uint32Array(getMemory().buffer, addr, w * h);
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === prev[i]) continue;
      prev[i] = buf[i];
      const s = styledCell(buf[i], (i / w) | 0);
      const el = spans[i];
      el.textContent = s.char;
      el.style.color = s.color;
      el.style.backgroundColor = s.background;
      // Highlight square as an inset outline: invisible when it equals the bg.
      el.style.boxShadow = `inset 0 0 0 1px ${s.border}`;
    }
  }

  window.addEventListener("keydown", (e) => {
    onKey(e.key, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey);
    // Let browser shortcuts through; capture plain game keys.
    if (!e.ctrlKey && !e.metaKey) e.preventDefault();
  });

  return { paint };
}

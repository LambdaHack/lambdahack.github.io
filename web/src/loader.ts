// Browser loader wiring: instantiate the LambdaHack wasm reactor with an
// in-memory WASI shim and the generated JSFFI glue, hook up paint + keyboard,
// then start the game. Mirrors web/harness.mjs (the node integration harness),
// but renders to the DOM instead of capturing frames. Not unit-tested.

import { WASI, OpenFile, File, ConsoleStdout, PreopenDirectory } from "@bjorn3/browser_wasi_shim";
import { mountTerminal } from "./terminal.js";

interface LhExports {
  memory: WebAssembly.Memory;
  lhStart: () => Promise<void>;
  lhKey: (key: string, ctrl: boolean, shift: boolean, alt: boolean, meta: boolean) => Promise<void>;
  lhWheel: (
    col: number,
    row: number,
    deltaY: number,
    ctrl: boolean,
    shift: boolean,
    alt: boolean,
    meta: boolean,
  ) => Promise<void>;
  lhMouseUp: (
    col: number,
    row: number,
    button: number,
    ctrl: boolean,
    shift: boolean,
    alt: boolean,
    meta: boolean,
  ) => Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var lhPaint: ((addr: number, w: number, h: number) => void) | undefined;
}

async function main(): Promise<void> {
  const screen = document.getElementById("screen");
  if (!screen) throw new Error("missing #screen element");

  // In-memory filesystem: stdin, console stdout/stderr, and a writable root for
  // the game's data dir (/LambdaHack); persistence is not retained across loads.
  const fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered((line) => console.log("[lh]", line)),
    ConsoleStdout.lineBuffered((line) => console.warn("[lh]", line)),
    new PreopenDirectory("/", new Map()),
  ];
  const wasi = new WASI(["LambdaHack"], [], fds);

  // Plain compile (not compileStreaming) so it works on static servers that
  // don't serve .wasm with the application/wasm MIME type.
  const wasmBytes = await (await fetch("./LambdaHack.wasm")).arrayBuffer();
  const mod = await WebAssembly.compile(wasmBytes);
  // @ts-expect-error generated at build time by post-link.mjs, served alongside.
  const jsffiFactory = (await import("./ghc_wasm_jsffi.mjs")).default;
  const importExports: Record<string, unknown> = {};
  const inst = await WebAssembly.instantiate(mod, {
    wasi_snapshot_preview1: wasi.wasiImport,
    ghc_wasm_jsffi: jsffiFactory(importExports),
  });
  Object.assign(importExports, inst.exports);

  const exports = inst.exports as unknown as LhExports;
  const term = mountTerminal(
    screen,
    () => exports.memory,
    (k, c, s, a, m) => {
      void exports.lhKey(k, c, s, a, m);
    },
    (col, row, deltaY, c, s, a, m) => {
      void exports.lhWheel(col, row, deltaY, c, s, a, m);
    },
    (col, row, button, c, s, a, m) => {
      void exports.lhMouseUp(col, row, button, c, s, a, m);
    },
  );
  globalThis.lhPaint = (addr, w, h) => term.paint(addr, w, h);

  wasi.initialize(inst as unknown as { exports: { memory: WebAssembly.Memory; _initialize?: () => unknown } });
  void exports.lhStart();
}

main().catch((e) => console.error(e));

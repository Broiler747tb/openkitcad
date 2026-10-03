# Geometry benchmarks

Run `npm run benchmark`. It records results in `docs/performance-results.json`.
Set `OKC_TEST_BROWSER` to a Chromium executable if Playwright's browser is unavailable.

The fixtures contain 100 and 300 operations: either separate rectangular bodies, or a plate
with sequential through-hole cuts. Each run starts in a fresh browser context. OpenCascade
is loaded before timing begins.

The script measures first construction, an unchanged rebuild, an early and late dimension
edit, undo and redo of the late edit, and ten live preview updates. It checks that every
evaluation succeeds and records prefix-cache hits and misses. Preview updates are sequential;
the numbers include worker communication, but exclude viewport rendering and UI debounce.
Undo and redo replay the documents at the kernel boundary; UI undo and redo are covered by
`scripts/workbench-smoke.mjs`.

Measured on 3 October 2026, Ryzen 5 3600, Windows 11, Chromium 153, Vite development build:

| Model | First build | Early edit | Last edit | Undo / redo |
| --- | ---: | ---: | ---: | ---: |
| 100 separate blocks | 355 ms | 231 ms | 11 ms | 3 / 4 ms |
| 300 separate blocks | 777 ms | 608 ms | 37 ms | 6 / 6 ms |
| Plate, 99 holes | 4,764 ms | 4,104 ms | 324 ms | 9 / 2 ms |
| Plate, 299 holes | 32,217 ms | 31,154 ms | 1,689 ms | 25 / 4 ms |

These are individual measurements, not guaranteed limits. An early edit invalidates the
history prefix. The large drilled plate is the expensive case: its preview updates take
roughly 1.5–1.7 seconds after the first cached update. Cached undo and redo remain fast.
This gives us a baseline for work on boolean operations and tessellation; it does not show
that a complex 300-operation part is already fast.

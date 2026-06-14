# Multi-Workspace Manual QA Checklist (Tauri)

Runtime confirmation for the multi-workspace feature (v0.4.2+). The pure logic
(namespacing, merge, save routing) is unit-tested in `frontend/src/workspace-ns.test.ts`;
this checklist confirms the live desktop app end to end. Browser mode (`runtime: offline`)
is single-workspace by design and does NOT exercise this — you must run the Tauri app.

## Fixtures (already created on disk)

Two workspaces that deliberately share identical bare ids (`root`, `pipelines`,
`connections`, …) so the namespace-collision path is exercised:

| Workspace | Path | Pipeline (bare id) | Canvas |
|-----------|------|--------------------|--------|
| WS1 | `~/quilt-samples`   | `user_rfm_segmentation` | large RFM graph |
| WS2 | `~/quilt-samples-2` | `j1` (hello_world)      | CSV → Parquet (2 nodes) |

If you want a true same-bare-id-collision test, both also carry `root`/`pipelines`/etc.
WS2's pipeline id is literally `j1` (the scaffold default) to maximise overlap.

## Launch

```bash
cd ~/Public/ProjectResearch/duckle
cargo tauri dev     # or: cargo run -p quilt-desktop
```

Wait for the window. If a workspace picker appears, pick `~/quilt-samples` first.

---

## A. Open a second workspace (core feature)

- [ ] **A1** WS1 (`~/quilt-samples`) is open; sidebar root reads **quilt-samples**, Pipelines shows `user_rfm_segmentation`.
- [ ] **A2** Click **New Workspace** → pick `~/quilt-samples-2`.
- [ ] **A3** BOTH roots now show in the Project tree: **quilt-samples** AND **quilt-samples-2** (not replaced).
- [ ] **A4** WS2's Pipelines shows `hello_world`. Expanding both roots shows each one's own folders/pipelines, no duplication or missing items.
- [ ] **A5** No error toast; the canvas still shows the previously-active pipeline.

## B. Edit pipelines from both at the same time

- [ ] **B1** Open `user_rfm_segmentation` (WS1) → it loads on canvas.
- [ ] **B2** Open `hello_world` (WS2) in a second tab → it loads (CSV → Parquet), distinct from WS1's graph.
- [ ] **B3** Switch tabs back and forth — each shows its own graph, no cross-bleed.
- [ ] **B4** Move a node in `hello_world`, then Ctrl/Cmd+S.

### Verify B4 wrote to the RIGHT folder (run in a terminal)
```bash
# hello_world lives in WS2 — its file must change, WS1 must NOT.
git -C ~/quilt-samples-2 status 2>/dev/null || ls -l ~/quilt-samples-2/pipelines/j1.json
# Inspect the saved file uses the BARE id on disk (no "ws...__" prefix):
python3 -c "import json;d=json.load(open('$HOME/quilt-samples-2/pipelines/j1.json'));print('nodes:',[n['id'] for n in d['nodes']])"
```
- [ ] **B5** `~/quilt-samples-2/pipelines/j1.json` reflects the move; `~/quilt-samples/**` is untouched.
- [ ] **B6** No file named with a `ws<hash>__` prefix appears anywhere (ids on disk stay bare):
```bash
find ~/quilt-samples ~/quilt-samples-2 -name 'ws*__*' -print    # expect: no output
```

## C. Create items target the clicked workspace

- [ ] **C1** Click the **⋮ kebab** on the **quilt-samples-2** root → **New pipeline…**. In the modal the Folder dropdown pre-selects a **quilt-samples-2** folder (not WS1).
- [ ] **C2** Name it `probe_ws2`, Create. It appears under WS2's Pipelines, NOT WS1's.
```bash
python3 -c "import json;print([i['name'] for i in json.load(open('$HOME/quilt-samples-2/repository.json')) if i['type']=='pipeline'])"
# expect: ['hello_world', 'probe_ws2']
ls ~/quilt-samples/pipelines/          # expect: NO probe_ws2.json here
```
- [ ] **C3** Right-click WS1's Pipelines folder → context menu shows **New pipeline…** (scope detection works under namespacing). Right-click WS1's Connections folder → shows **New connection…** (correct scope, not "New pipeline").

## D. Close one workspace

- [ ] **D1** Kebab on **quilt-samples-2** root → **Close workspace**.
- [ ] **D2** quilt-samples-2 disappears from the tree; **quilt-samples stays** with all its items intact.
- [ ] **D3** quilt-samples-2 files on disk are NOT deleted (close only detaches):
```bash
ls ~/quilt-samples-2/pipelines/    # j1.json + probe_ws2.json still present
```
- [ ] **D4** Closing the workspace that owns the active tab: the canvas switches to a remaining pipeline (or empty), no crash.

## E. Persistence across restart

- [ ] **E1** With both workspaces open, fully quit the app (Cmd+Q) and relaunch.
- [ ] **E2** Both **quilt-samples** and **quilt-samples-2** are restored in the tree (the open set is persisted).
- [ ] **E3** Previously-open editor tabs are restored per workspace; a deleted pipeline does not reopen as a ghost tab.

## F. Run a pipeline (engine, single active workspace)

- [ ] **F1** Focus `hello_world` (WS2), click **Run**. It runs against WS2's folder (engine `workspacePath` = WS2). Output/logs land under `~/quilt-samples-2`, not WS1.
- [ ] **F2** Connection/context refs (if any) resolve — run does not fail with "unknown connectionRef" (de-namespaced repo slice is handed to the resolver).

---

## Known limitation to confirm, not a bug

- **Scheduler is global single-path.** It points at the *active* workspace. A
  schedule saved in a non-focused workspace may target the wrong folder. This is
  documented, not yet fixed (needs a Rust-side change). Note any surprising
  behaviour here for a follow-up.

## Reset fixtures

```bash
rm -rf ~/quilt-samples-2          # delete the second fixture entirely
# or just remove the probe pipeline created in C2:
rm -f ~/quilt-samples-2/pipelines/probe_ws2.json
```

## If anything fails

Capture: which step, what you saw vs expected, and the relevant file contents
(`repository.json` / `quilt.json` of the affected workspace). The namespacing
core is in `frontend/src/workspace-ns.ts`; the save routing is in the three
`useEffect`s near the top of `frontend/src/App.tsx` (they delegate to
`planMetadataSaves` / `planRepoSaves` / `planPipelineSaves`).

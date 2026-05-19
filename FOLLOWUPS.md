# Follow-ups

Polish items and deferred features called out during phased delivery. Each entry
links the phase that originated it so we know roughly when it was set aside.

## Canvas / placement

- **Rotation can feel jumpy when the rotated footprint won't fit** *(Phase 3e)* —
  the clamp shoves the pedal back onto the board, which jumps it noticeably.
  Could animate, or refuse the rotation when it doesn't fit and surface a hint.

## Add Pedal wizard

- **Edit an existing port** *(Phase 4f)* — rename, change side, swap connector.
  Today the only edit is remove + re-add.
- **Reorder ports along their side** *(Phase 4f)* — drag handles, or up/down
  arrows in the port row.
- **Explicit side selection when adding a port** *(Phase 4f)* — currently the
  custom-port picker auto-picks the first jack-marked side. A third picker step
  would let users choose.
- **Mark required vs optional on new ports** *(Phase 4f)* — new ports default
  to optional; the user can't currently flip a port to required during the
  wizard.

## Pedal library / collection

- **"Add new pedal" position** *(Phase 4e)* — currently the first row of the
  library sheet list. Alternative: sticky footer button or a separate header
  section.
- **Pedal library as a side drawer on desktop** *(Phase 4e)* — today it's a
  centered bottom-sheet on mobile / centered modal on desktop. Confirm whether
  desktop should slide in from the side instead.
- **"Or seed 6 sample pedals" affordance** *(Phase 4e)* — kept as a small ghost
  button in the empty state for dev convenience. Decide whether to remove
  entirely once real seeded data ships.
- **Auto-add new pedal to rig on submit** *(Phase 4e)* — current default puts
  the newly-created pedal on the current rig at center. Some users might want
  to batch-create pedals first; option to disable could help.

## Signal-chain overlay

- **No UI to add FX Send / FX Return endpoints** *(Phase 6d)* — `signalChainStore.addEndpoint`
  works and the chips render correctly when they exist, but there's no
  affordance to create them. Likely a chain-mode settings sheet or "+ FX loop"
  button.
- **Editing an existing connection** *(Phase 6c)* — today you can only delete
  a cable and redraw. Could allow rerouting one end.
- **Stereo cables draw as a single line** *(Phase 6e)* — fine for v1, but the
  signal type warrants visual treatment (two parallel strands or a thicker
  stroke).
- **Routing isn't aware of pedal obstacles** *(Phase 6e)* — the 3-segment
  manhattan path can cross through other pedals if endpoints geometrically line
  it up that way. A proper router would detour around them.

## Image upload / background removal

- **Storage quota** *(Phase 5)* — pedal photos are stored as data: URLs in
  `pedals.image_path`. In browser dev mode that's localStorage, which is
  ~5MB per origin. At ~200KB per 1024px transparent PNG, we hit the quota
  around 20–25 pedals and `createPedal` will start throwing
  `QuotaExceededError`. Tauri's SQLite has no practical limit. Worth
  surfacing as a user-visible warning when localStorage gets close to
  full, or moving to OPFS/IndexedDB for browser dev.

## Board presets

- **Real board photography + expanded preset list** *(Phase 2)* — today the
  Pedaltrain and Temple Audio presets render as procedural rail/hole textures
  with hand-entered dimensions. Pull real product photos (or accurate
  top-down renders) for the existing six presets, then broaden the catalogue
  (Pedaltrain JR, Novo 24, Duo 17, Trio 28, Templeboard 43, Templeboard 65,
  plus competitors like Schmidt Array, Vertex Hinge, RockBoard). Each preset
  should declare an `imagePath` rendered behind the procedural overlay (or
  replacing it), so users see a recognizable board when they pick it.

## Mobile / native

- **Tauri iOS + Android dev loop** *(Phase 7)* — never run, prereqs documented
  in README. First `pnpm tauri:ios:init` / `pnpm tauri:android:init` will need
  Xcode / Android Studio installed.
- **Pedal library on mobile as a true side panel** *(Original spec)* — Zach's
  original ask suggested the collection might live "on the side" on mobile.
  Today it's a bottom-sheet. Worth re-evaluating once we test on real devices.

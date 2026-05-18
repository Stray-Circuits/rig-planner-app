# Follow-ups

Polish items and deferred features called out during phased delivery. Each entry
links the phase that originated it so we know roughly when it was set aside.

## Canvas / placement

- **Clamp pedals on rig resize** *(Phase 3g)* — when the user shrinks a rig via
  Settings → Change board, placed pedals can end up hanging off the new edge.
  They can still be dragged back, but a clamp-on-resize pass would be friendlier.
- **Rotation can feel jumpy when the rotated footprint won't fit** *(Phase 3e)* —
  the clamp shoves the pedal back onto the board, which jumps it noticeably.
  Could animate, or refuse the rotation when it doesn't fit and surface a hint.
- **Delete-rig from the rig screen** *(Phase 4e)* — currently only available
  from the rig list. A Delete item in Settings would be more discoverable.

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

## Phase 5 — not yet started

- **Real photo upload + background removal** — the wizard image step is
  currently a color picker. rembg-webgpu integration replaces it (~176MB model,
  lazy-downloaded on first use). Color placeholders remain a fallback when the
  user doesn't have / doesn't want a photo.

## Mobile / native

- **Tauri iOS + Android dev loop** *(Phase 7)* — never run, prereqs documented
  in README. First `pnpm tauri:ios:init` / `pnpm tauri:android:init` will need
  Xcode / Android Studio installed.
- **Pedal library on mobile as a true side panel** *(Original spec)* — Zach's
  original ask suggested the collection might live "on the side" on mobile.
  Today it's a bottom-sheet. Worth re-evaluating once we test on real devices.

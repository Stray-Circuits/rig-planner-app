# Follow-ups

Polish items and deferred features called out during phased delivery. Each entry
links the phase that originated it so we know roughly when it was set aside.

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
- **Colinear cables can't fully detour** *(Phase 6e)* — routeCablePath now
  tries multiple elbow positions and avoids obstacles in the general case,
  but two ports at near-identical y (or x) can't escape a pedal in their
  line of sight with only 3 Manhattan segments. A 5-segment "swerve" path
  (go up/down past the obstacle, across, then back) would close this gap.
- **Drag-to-connect on mobile** *(Follow-up feedback)* — tap-then-drag from
  an armed port to a target port would feel more natural than tap-tap on
  small phones. Tap targets have been widened to 44px already, but the
  full pointerDown→pointerMove→pointerUp gesture with a ghost cable still
  needs to be wired up in `BoardCanvas` / `ChainOverlay`.

## Board presets

- **Expanded preset list with our own top-down renders** *(Phase 2 / 2026-05
  feedback)* — the current six PedalTrain / Temple Audio presets are
  procedural rail/hole textures with hand-entered dimensions. To grow the
  catalogue (Pedaltrain JR, Novo 24, Duo 17, Trio 28, Templeboard 43,
  Templeboard 65, plus competitors like Schmidt Array, Vertex Hinge,
  RockBoard) we need *our own* parameterized renders — not photos.
  Manufacturer / retailer (Sweetwater, Reverb) product photography is
  copyrighted and can't be bundled, regardless of the app's AGPLv3 license.
  Brand *names* are fine to reference (nominative trademark use). Generate
  the renders from the existing `BOARD_DRAWERS` / boardStyles pipeline,
  parameterized by rail count + hole spacing per model.

## Pedal seed (deferred indefinitely)

- **Top ~200 pedals via agent** *(other_todos.txt / 2026-05 feedback)* — same
  copyright bind as boards: we can't ship third-party pedal photos no matter
  who shot them. Wikimedia Commons coverage isn't dense or consistent enough
  to be useful. Shelved until either (a) we get explicit licensing from
  manufacturers / retailers, or (b) we decide to seed with placeholder
  colors + names only and accept that users will upload their own photos
  per pedal.

## Branding

- **Tauri app icons** *(Follow-up feedback)* — the browser favicon is in
  `public/favicon.svg` and renders the new pedal mark. The native app
  icons in `src-tauri/icons/` are still the placeholder ones. Regenerate
  them from a 1024×1024 PNG export of the same SVG with
  `pnpm tauri icon path/to/icon.png` once we're ready to ship a build.

## Mobile / native

- **Tauri Android live-reload dev loop** *(Phase 7)* — only the containerized
  debug-APK build is wired up (`pnpm android:container:build`). The
  emulator/device dev loop (`tauri android dev`) still needs a host-side
  Android SDK / Studio setup, since the container has no GUI / adb bridge.
- **Tauri iOS init + dev loop** *(Phase 7)* — never run, prereqs documented in
  README. First `pnpm tauri:ios:init` will need Xcode installed.
- **Signed Android release builds** *(Phase 7)* — the container wrapper only
  covers debug APKs. Release signing needs a keystore + release-key.properties
  wired into `src-tauri/gen/android/app/build.gradle.kts`.
- **Pedal library on mobile as a true side panel** *(Original spec)* — Zach's
  original ask suggested the collection might live "on the side" on mobile.
  Today it's a bottom-sheet. Worth re-evaluating once we test on real devices.

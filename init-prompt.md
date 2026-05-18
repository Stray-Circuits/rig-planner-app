Great. I think we have enough to take to Claude Code now. Let me summarize what we've designed so you have a solid handoff document.

---

**App:** Pedalboard planner — TypeScript + Tauri (desktop + mobile)

**Core concept:** Physical layout canvas (primary feature) with an optional signal chain overlay. The layout view is the same as existing apps; the signal chain layer is the differentiator.

---

### Data model

**Pedal:**
```typescript
{
  id, brand, name,
  width_in, depth_in,
  image: string,              // transparent PNG, top-down
  jack_sides: {               // for keep-out bounding box
    top, bottom, left, right: boolean,
    midi_top, midi_bottom, midi_left, midi_right: boolean
  },
  power_side: 'top'|'bottom'|'left'|'right'|null,
  ports: Port[]               // mandatory on submission
}
```

**Port:**
```typescript
{
  id, label,
  role: 'input'|'output'|'input_l'|'input_r'|'stereo_input'|
        'output_l'|'output_r'|'stereo_output'|
        'fx_send'|'fx_return'|'midi_in'|'midi_out'|
        'expression'|'remote'|'cv',
  signal_type: 'instrument'|'line'|'line_balanced'|'stereo'|
               'amp_level'|'midi'|'cv'|'expression'|'remote',
  connector: 'ts'|'trs'|'xlr'|'midi_din'|'midi_trs',
  optional: boolean
}
```

**Rig:**
```typescript
{
  id, name,
  width_in, depth_in,
  style: 'rail'|'plain'|'wood'|'holes',
  pedals: PlacedPedal[],
  connections: Connection[]
}

PlacedPedal: { pedalId, x, y, rotation }
Connection: { fromNodeId, fromPortId, toNodeId, toPortId }
```

External nodes (Guitar, Amp, FX Loop Send/Return) are first-class graph nodes, not pedals.

---

### Board presets

| Name | Width | Depth | Style |
|---|---|---|---|
| Pedaltrain Nano+ | 18" | 5" | Rail |
| Pedaltrain Metro 24 | 24" | 8" | Rail |
| Pedaltrain Classic Pro | 32" | 16" | Rail |
| Temple Audio Solo 18 | 16.7" | 8.5" | Holes |
| Temple Audio Duo 24 | 23.2" | 12.5" | Holes |
| Temple Audio Trio 21 | 19.7" | 16.5" | Holes |

---

### Board styles

- **Rail** — transparent canvas, 4 matte black horizontal bars + two vertical end bars spanning first-to-last rail, rendered on medium grey (#888) canvas background. `drop-shadow` on wrapper div, not canvas element.
- **Plain** — flat black (#1A1A1A) with silver metal border (double-line inset)
- **Wood** — horizontal planks with grain texture, dark gaps between planks
- **Holes** — flat black (#1A1A1A) with evenly spaced circular cutouts

---

### Signal chain

- Overlay toggle in toolbar, not a separate view
- Orthogonal (manhattan) routing — right-angle bends, no bezier curves
- Signal flows right-to-left (guitar input on right, amp output on left)
- Input jack = right edge center of pedal; output jack = left edge center
- Adjacent same-height pedals = purely horizontal cable
- Height differences = 3-segment path (horizontal → vertical in gap → horizontal)
- Cable color by signal type; green for instrument audio
- Unconnected ports shown as yellow warning dots
- Side panel shows linear chain list with warnings for disconnected ports
- Guitar/Amp/FX Loop are virtual endpoint nodes, not board pedals

---

### Key UX flows

**New rig wizard (full-screen on mobile):**
1. Name the rig (text input + quick-pick chips)
2. Pick a board (preset cards grouped by brand, or custom with dimension inputs + style picker)

**Add pedal (full-screen, 5 steps):**
1. Image — tap to upload, automatic background removal via `rembg-webgpu` (176MB model, cached after first download), re-process option
2. Name & size — brand, model, width × depth in inches with Look up link
3. Jack Placement — separate Audio jacks and MIDI jacks toggles per side (top/bottom/left/right), power jack side dropdown, live preview box with colored dots
4. Connections — preset chips (Mono in/out, Dual mono stereo, TRS stereo, + FX loop, + MIDI), individual add via two-step inline picker (role → connector type)
5. Review → submit (adds to local DB immediately, queues for community sync)

---

### Tech stack recommendations

- **React + React Flow** for the canvas and graph engine
- **Zustand** for state
- **SQLite via tauri-plugin-sql** for local pedal DB
- **rembg-webgpu** for client-side background removal (WebGPU → WASM fallback)
- **`drop-shadow` CSS filter** on board wrapper div (not box-shadow on canvas) for correct transparent canvas rendering
- Navigation buttons always at bottom on mobile (Back left, Continue/Submit right)

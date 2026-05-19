import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type {
  JackSides,
  Pedal,
  Port,
  Side,
  PortRole,
  SignalType,
  Connector,
} from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { createPedal } from '../../data/pedalsRepo';
import {
  blobToDataURL,
  cropToContent,
  prefetchBgRemoval,
  removeBackground,
  shrinkImage,
  type BgRemovalProgress,
} from '../../lib/bgRemoval';
import { Button, TextField, WizardShell } from '../../ui';
import styles from './AddPedalWizard.module.css';

interface AddPedalWizardProps {
  onCreated: (pedal: Pedal) => void;
  onCancel: () => void;
}

type DraftPort = Omit<Port, 'id' | 'pedalId'>;

interface WizardDraft {
  color: string;
  /** Data-URL of a background-removed photo. When set, takes precedence over `color`. */
  photoDataUrl: string | null;
  /** Raw user upload kept across step navigation so "Re-process" can retry. */
  photoSource: Blob | null;
  brand: string;
  name: string;
  widthIn: string;
  depthIn: string;
  jackSides: JackSides;
  powerSide: Side | null;
  ports: DraftPort[];
}

const DEFAULT_COLOR = '#666666';

const DEFAULT_JACKS: JackSides = {
  top: true,
  bottom: false,
  left: false,
  right: false,
  midi_top: false,
  midi_bottom: false,
  midi_left: false,
  midi_right: false,
};

const DEFAULT_PORTS: DraftPort[] = [
  {
    label: 'In',
    role: 'input' satisfies PortRole,
    signalType: 'instrument' satisfies SignalType,
    connector: 'ts' satisfies Connector,
    side: 'top',
    sideOrder: 1,
    optional: false,
  },
  {
    label: 'Out',
    role: 'output' satisfies PortRole,
    signalType: 'instrument' satisfies SignalType,
    connector: 'ts' satisfies Connector,
    side: 'top',
    sideOrder: 0,
    optional: false,
  },
];

const STEPS = ['Image', 'Name & size', 'Jacks', 'Connections', 'Review'];

function initialDraft(): WizardDraft {
  return {
    color: DEFAULT_COLOR,
    photoDataUrl: null,
    photoSource: null,
    brand: '',
    name: '',
    widthIn: '',
    depthIn: '',
    jackSides: { ...DEFAULT_JACKS },
    powerSide: 'top',
    ports: DEFAULT_PORTS.map((p) => ({ ...p })),
  };
}

export function AddPedalWizard({ onCreated, onCancel }: AddPedalWizardProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<WizardDraft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pedals store needs to know about the newly-created row.
  const reloadPedals = usePedalsStore((s) => s.loadPedals);

  const widthNum = Number(draft.widthIn);
  const depthNum = Number(draft.depthIn);
  const trimmedName = draft.name.trim();
  const trimmedBrand = draft.brand.trim();

  const canAdvanceFromCurrent = (() => {
    if (step === 0) {
      // A photo overrides the color picker; only validate the color when no
      // photo is staged.
      if (!draft.photoDataUrl && !isValidHex(draft.color)) return false;
    }
    if (step === 1) {
      if (!trimmedBrand) return false;
      if (!trimmedName) return false;
      if (!Number.isFinite(widthNum) || widthNum <= 0) return false;
      if (!Number.isFinite(depthNum) || depthNum <= 0) return false;
    }
    return true;
  })();

  const isLastStep = step === STEPS.length - 1;

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleContinue = () => {
    if (!canAdvanceFromCurrent) return;
    if (!isLastStep) setStep(step + 1);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!trimmedName || !trimmedBrand) {
      setError('Brand and name are required.');
      setStep(1);
      return;
    }
    if (
      !Number.isFinite(widthNum) ||
      widthNum <= 0 ||
      !Number.isFinite(depthNum) ||
      depthNum <= 0
    ) {
      setError('Width and depth must be positive numbers.');
      setStep(1);
      return;
    }
    setSubmitting(true);
    try {
      const created = await createPedal({
        brand: trimmedBrand,
        name: trimmedName,
        widthIn: widthNum,
        depthIn: depthNum,
        imagePath: draft.photoDataUrl ?? `color:${draft.color}`,
        jackSides: draft.jackSides,
        powerSide: draft.powerSide,
        ports: draft.ports,
      });
      await reloadPedals();
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={step}
      totalSteps={STEPS.length}
      title={titleForStep(step)}
      subtitle={subtitleForStep(step)}
      onClose={onCancel}
      {...(step > 0 ? { onBack: handleBack } : {})}
      footerAction={
        <Button
          size="lg"
          fullWidth
          disabled={!canAdvanceFromCurrent || submitting}
          onClick={() => {
            if (isLastStep) void handleSubmit();
            else handleContinue();
          }}
        >
          {isLastStep
            ? submitting
              ? 'Saving…'
              : 'Add to library'
            : 'Continue'}
        </Button>
      }
    >
      {step === 0 && <ImageStep draft={draft} setDraft={setDraft} />}
      {step === 1 && <NameSizeStep draft={draft} setDraft={setDraft} />}
      {step === 2 && <JacksStep draft={draft} setDraft={setDraft} />}
      {step === 3 && <ConnectionsStep draft={draft} setDraft={setDraft} />}
      {step === 4 && <ReviewStep draft={draft} />}
      {error ? (
        <div className={styles.errorBox} role="alert">
          <i className="ti ti-alert-triangle" aria-hidden /> {error}
        </div>
      ) : null}
    </WizardShell>
  );
}

function titleForStep(step: number): string {
  switch (step) {
    case 0:
      return 'Pedal image';
    case 1:
      return 'Name & size';
    case 2:
      return 'Jack placement';
    case 3:
      return 'Connections';
    case 4:
      return 'Review';
    default:
      return STEPS[step] ?? '';
  }
}

function subtitleForStep(step: number): string {
  switch (step) {
    case 0:
      return 'Pick a placeholder color for now. Upload + background removal lands in phase 5.';
    case 1:
      return 'Tell us what the pedal is and how big it is.';
    case 2:
      return 'Which sides have audio and MIDI jacks?';
    case 3:
      return 'What ports does the pedal expose?';
    case 4:
      return 'Looks right? Submit to add it to your library.';
    default:
      return '';
  }
}

interface StepProps {
  draft: WizardDraft;
  setDraft: (
    update: WizardDraft | ((prev: WizardDraft) => WizardDraft),
  ) => void;
}

const SWATCHES = [
  '#C62828', // red
  '#E65100', // orange
  '#F9A825', // amber
  '#2E7D32', // green
  '#1565C0', // blue
  '#4A148C', // purple
  '#D4537E', // pink
  '#37474F', // slate
  '#212121', // black
  '#9E9E9E', // grey
];

function isValidHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s.trim());
}

const PHASE_LABELS: Record<BgRemovalProgress['phase'], string> = {
  'preparing-image': 'Preparing image…',
  'loading-library': 'Loading background remover…',
  'initializing-runtime': 'Warming up the engine…',
  'fetching-model': 'Downloading model (one-time, ~176 MB)…',
  processing: 'Removing background…',
  finalizing: 'Cropping silhouette…',
};

const PHASE_SUBS: Record<BgRemovalProgress['phase'], string | null> = {
  'preparing-image': 'Downsizing your photo to 512px.',
  'loading-library': 'Fetching the JS chunk (~110 KB gzipped).',
  'initializing-runtime':
    'Spinning up the WebGPU / WASM backend — this is the slow first-run step.',
  'fetching-model': 'Cached after this. Subsequent uploads are instant.',
  processing: 'Should only take a few seconds.',
  finalizing: 'Trimming transparent margins.',
};

function ImageStep({ draft, setDraft }: StepProps) {
  const setColor = (color: string) => setDraft((d) => ({ ...d, color }));
  const customValid = isValidHex(draft.color);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<BgRemovalProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Warm the bg-removal chunk so it's ready by the time the user clicks
  // "Use a photo". Best-effort, no UI feedback for the prefetch itself.
  useEffect(() => {
    prefetchBgRemoval();
  }, []);

  /**
   * Run the full pipeline (shrink → bg removal → crop → dataURL) when
   * `removeBg` is true. Skip the bg-removal step when false — used for
   * already-transparent PNGs the user prepared elsewhere, OR as an escape
   * hatch when the model fails (e.g. white pedal on white background).
   */
  const processFile = async (file: Blob, removeBg: boolean) => {
    setError(null);
    setDraft((d) => ({ ...d, photoSource: file }));
    try {
      setProgress({ phase: 'preparing-image', fraction: null });
      // 1024 matches imgly's default ISNet input resolution — going lower
      // throws away detail the model could otherwise use and leaves the
      // saved transparent PNG looking grainy when the canvas zooms in.
      const shrunk = await shrinkImage(file, 1024);
      const processed = removeBg
        ? await removeBackground(shrunk, { onProgress: setProgress })
        : shrunk;
      setProgress({ phase: 'finalizing', fraction: null });
      const cropped = await cropToContent(processed);
      const dataUrl = await blobToDataURL(cropped);
      setDraft((d) => ({ ...d, photoDataUrl: dataUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void processFile(file, true);
  };

  const handleReprocess = () => {
    if (draft.photoSource) void processFile(draft.photoSource, true);
  };

  const handleUseOriginal = () => {
    if (draft.photoSource) void processFile(draft.photoSource, false);
  };

  const handleUseColor = () => {
    setDraft((d) => ({ ...d, photoDataUrl: null, photoSource: null }));
    setError(null);
  };

  // ---------- Photo present: show transparent preview + actions ----------
  if (draft.photoDataUrl && !progress) {
    return (
      <div className={styles.imageStep}>
        <div className={styles.pedalPreview}>
          <div
            className={styles.pedalPhotoPreview}
            style={{ background: draft.color }}
          >
            <img
              src={draft.photoDataUrl}
              alt="Background-removed pedal preview"
              className={styles.pedalPhoto}
            />
          </div>
        </div>
        <div className={styles.photoActions}>
          <Button variant="secondary" onClick={handleReprocess}>
            <i className="ti ti-refresh" aria-hidden /> Re-process
          </Button>
          <Button variant="secondary" onClick={handleUseOriginal}>
            Use as-is
          </Button>
          <Button variant="ghost" onClick={handleUseColor}>
            Color instead
          </Button>
        </div>
        <p className={styles.helpMuted}>
          Background removal failed on a white pedal? Tap{' '}
          <strong>Use as-is</strong> to skip it — works best if your photo
          already has a transparent background.
        </p>
      </div>
    );
  }

  // ---------- Processing: progress bar + cancel-by-replacing-source ----------
  if (progress) {
    const phaseLabel = PHASE_LABELS[progress.phase];
    const phaseSub = PHASE_SUBS[progress.phase];
    return (
      <div className={styles.imageStep}>
        <div className={styles.pedalPreview}>
          <div
            className={styles.pedalPreviewBox}
            style={{ background: draft.color, opacity: 0.6 }}
          >
            <span className={styles.pedalPreviewLabel}>Working…</span>
          </div>
        </div>
        <div className={styles.progressWrap}>
          <div className={styles.progressLabel}>{phaseLabel}</div>
          {phaseSub ? (
            <div className={styles.progressSub}>{phaseSub}</div>
          ) : null}
          <div
            className={`${styles.progressBar} ${
              progress.fraction === null ? styles.progressBarIndeterminate : ''
            }`}
          >
            <div
              className={styles.progressFill}
              style={
                progress.fraction === null
                  ? undefined
                  : {
                      width: `${Math.round(progress.fraction * 100)}%`,
                    }
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // ---------- Default: file picker + color picker ----------
  return (
    <div className={styles.imageStep}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className={styles.hiddenFileInput}
      />
      <button
        type="button"
        className={styles.uploadCta}
        onClick={() => fileInputRef.current?.click()}
      >
        <i className="ti ti-camera-plus" aria-hidden />
        <span className={styles.uploadCtaTitle}>Use a photo</span>
        <span className={styles.uploadCtaSub}>
          Background removed automatically
        </span>
      </button>

      {error ? (
        <div className={styles.errorBox} role="alert">
          <i className="ti ti-alert-triangle" aria-hidden /> {error}
        </div>
      ) : null}

      <div className={styles.colorSectionLabel}>
        Or pick a placeholder color
      </div>
      <div className={styles.pedalPreview}>
        <div
          className={styles.pedalPreviewBox}
          style={{ background: draft.color }}
          aria-label="Pedal color preview"
        >
          <span className={styles.pedalPreviewLabel}>
            {draft.name.trim() || 'Pedal'}
          </span>
        </div>
      </div>
      <div className={styles.swatchGrid} role="radiogroup" aria-label="Color">
        {SWATCHES.map((s) => {
          const selected = draft.color.toLowerCase() === s.toLowerCase();
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Color ${s}`}
              className={
                styles.swatch + (selected ? ' ' + styles.swatchSelected : '')
              }
              style={{ background: s }}
              onClick={() => setColor(s)}
            />
          );
        })}
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Custom hex</span>
        <TextField
          inputSize="md"
          placeholder="#RRGGBB"
          maxLength={7}
          value={draft.color}
          invalid={!customValid}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
    </div>
  );
}

function NameSizeStep({ draft, setDraft }: StepProps) {
  const update =
    <K extends keyof WizardDraft>(key: K) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setDraft((d) => ({ ...d, [key]: value }));
    };

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.label}>Brand</span>
        <TextField
          inputSize="md"
          placeholder="Boss"
          maxLength={40}
          value={draft.brand}
          autoFocus
          onChange={update('brand')}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Model</span>
        <TextField
          inputSize="md"
          placeholder="DS-1"
          maxLength={60}
          value={draft.name}
          onChange={update('name')}
        />
      </label>
      <div className={styles.dimsRow}>
        <label className={styles.field}>
          <span className={styles.label}>Width (in)</span>
          <TextField
            inputSize="md"
            type="number"
            min={0.5}
            max={48}
            step={0.05}
            placeholder="2.85"
            value={draft.widthIn}
            onChange={update('widthIn')}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Depth (in)</span>
          <TextField
            inputSize="md"
            type="number"
            min={0.5}
            max={48}
            step={0.05}
            placeholder="4.75"
            value={draft.depthIn}
            onChange={update('depthIn')}
          />
        </label>
      </div>
    </div>
  );
}

const SIDES_IN_ORDER: { side: Side; label: string }[] = [
  { side: 'top', label: 'Top' },
  { side: 'bottom', label: 'Bottom' },
  { side: 'left', label: 'Left' },
  { side: 'right', label: 'Right' },
];

const AUDIO_SIDE_KEY: Record<Side, keyof JackSides> = {
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
};

const MIDI_SIDE_KEY: Record<Side, keyof JackSides> = {
  top: 'midi_top',
  bottom: 'midi_bottom',
  left: 'midi_left',
  right: 'midi_right',
};

function JacksStep({ draft, setDraft }: StepProps) {
  const toggle = (key: keyof JackSides) =>
    setDraft((d) => ({
      ...d,
      jackSides: { ...d.jackSides, [key]: !d.jackSides[key] },
    }));

  return (
    <div className={styles.jacksStep}>
      <JackPreview draft={draft} />

      <div className={styles.jackSectionLabel}>Audio jacks</div>
      <div className={styles.jackGrid}>
        {SIDES_IN_ORDER.map(({ side, label }) => {
          const active = draft.jackSides[AUDIO_SIDE_KEY[side]];
          return (
            <button
              key={`audio-${side}`}
              type="button"
              className={`${styles.jackChip} ${active ? styles.jackChipActive : ''}`}
              aria-pressed={active}
              onClick={() => toggle(AUDIO_SIDE_KEY[side])}
            >
              <span
                className={styles.jackDotAudio}
                aria-hidden
                style={{ opacity: active ? 1 : 0.3 }}
              />
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.jackSectionLabel}>MIDI jacks</div>
      <div className={styles.jackGrid}>
        {SIDES_IN_ORDER.map(({ side, label }) => {
          const active = draft.jackSides[MIDI_SIDE_KEY[side]];
          return (
            <button
              key={`midi-${side}`}
              type="button"
              className={`${styles.jackChip} ${active ? styles.jackChipActiveMidi : ''}`}
              aria-pressed={active}
              onClick={() => toggle(MIDI_SIDE_KEY[side])}
            >
              <span
                className={styles.jackDotMidi}
                aria-hidden
                style={{ opacity: active ? 1 : 0.3 }}
              />
              {label}
            </button>
          );
        })}
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Power side</span>
        <select
          className={styles.select}
          value={draft.powerSide ?? ''}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              powerSide: (e.target.value || null) as Side | null,
            }))
          }
        >
          <option value="">No external power</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
    </div>
  );
}

function JackPreview({ draft }: { draft: WizardDraft }) {
  const renderDot = (
    side: Side,
    position: 'audio' | 'midi',
    offset: number,
  ) => {
    const className =
      position === 'audio' ? styles.jackDotAudio : styles.jackDotMidi;
    const style: Record<string, string> = { position: 'absolute' };
    // 8px from the relevant edge, offset along the perpendicular axis.
    if (side === 'top') {
      style.top = '-4px';
      style.left = position === 'audio' ? `${30 + offset}%` : `${60 + offset}%`;
    } else if (side === 'bottom') {
      style.bottom = '-4px';
      style.left = position === 'audio' ? `${30 + offset}%` : `${60 + offset}%`;
    } else if (side === 'left') {
      style.left = '-4px';
      style.top = position === 'audio' ? `${30 + offset}%` : `${60 + offset}%`;
    } else {
      style.right = '-4px';
      style.top = position === 'audio' ? `${30 + offset}%` : `${60 + offset}%`;
    }
    return <span className={className} style={style} aria-hidden />;
  };

  return (
    <div className={styles.jackPreviewWrap}>
      <div
        className={styles.jackPreviewBox}
        style={{ background: draft.color }}
      >
        {SIDES_IN_ORDER.map(({ side }) => (
          <span key={side}>
            {draft.jackSides[AUDIO_SIDE_KEY[side]]
              ? renderDot(side, 'audio', 0)
              : null}
            {draft.jackSides[MIDI_SIDE_KEY[side]]
              ? renderDot(side, 'midi', 0)
              : null}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ConnectionPreset {
  id: string;
  label: string;
  /** Replaces the current port list (true) or appends to it (false). */
  replaces: boolean;
  build: () => DraftPort[];
}

function mkPort(spec: DraftPort): DraftPort {
  return { ...spec };
}

const CONNECTION_PRESETS: ConnectionPreset[] = [
  {
    id: 'mono',
    label: 'Mono in/out',
    replaces: true,
    build: () => [
      mkPort({
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: false,
      }),
      mkPort({
        label: 'Out',
        role: 'output',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      }),
    ],
  },
  {
    id: 'dual-mono-stereo',
    label: 'Dual mono stereo',
    replaces: true,
    build: () => [
      mkPort({
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 2,
        optional: false,
      }),
      mkPort({
        label: 'Out L',
        role: 'output_l',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      }),
      mkPort({
        label: 'Out R',
        role: 'output_r',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: true,
      }),
    ],
  },
  {
    id: 'trs-stereo',
    label: 'TRS stereo',
    replaces: true,
    build: () => [
      mkPort({
        label: 'Stereo In',
        role: 'stereo_input',
        signalType: 'stereo',
        connector: 'trs',
        side: 'top',
        sideOrder: 1,
        optional: false,
      }),
      mkPort({
        label: 'Stereo Out',
        role: 'stereo_output',
        signalType: 'stereo',
        connector: 'trs',
        side: 'top',
        sideOrder: 0,
        optional: false,
      }),
    ],
  },
  {
    id: 'fx-loop',
    label: '+ FX loop',
    replaces: false,
    build: () => [
      mkPort({
        label: 'FX Send',
        role: 'fx_send',
        signalType: 'instrument',
        connector: 'ts',
        side: 'right',
        sideOrder: 0,
        optional: true,
      }),
      mkPort({
        label: 'FX Return',
        role: 'fx_return',
        signalType: 'instrument',
        connector: 'ts',
        side: 'right',
        sideOrder: 1,
        optional: true,
      }),
    ],
  },
  {
    id: 'midi',
    label: '+ MIDI',
    replaces: false,
    build: () => [
      mkPort({
        label: 'MIDI In',
        role: 'midi_in',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'bottom',
        sideOrder: 0,
        optional: true,
      }),
      mkPort({
        label: 'MIDI Out',
        role: 'midi_out',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'bottom',
        sideOrder: 1,
        optional: true,
      }),
    ],
  },
];

interface RoleOption {
  role: PortRole;
  label: string;
  signalType: SignalType;
  /** Connectors offered for this role on the next picker step. */
  connectors: Connector[];
}

const ROLE_GROUPS: { heading: string; options: RoleOption[] }[] = [
  {
    heading: 'Audio',
    options: [
      {
        role: 'input',
        label: 'In',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'output',
        label: 'Out',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'input_l',
        label: 'In L',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'input_r',
        label: 'In R',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'stereo_input',
        label: 'Stereo In',
        signalType: 'stereo',
        connectors: ['trs', 'ts'],
      },
      {
        role: 'output_l',
        label: 'Out L',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'output_r',
        label: 'Out R',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'stereo_output',
        label: 'Stereo Out',
        signalType: 'stereo',
        connectors: ['trs', 'ts'],
      },
      {
        role: 'fx_send',
        label: 'FX Send',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'fx_return',
        label: 'FX Return',
        signalType: 'instrument',
        connectors: ['ts', 'trs'],
      },
    ],
  },
  {
    heading: 'MIDI',
    options: [
      {
        role: 'midi_in',
        label: 'MIDI In',
        signalType: 'midi',
        connectors: ['midi_trs', 'midi_din'],
      },
      {
        role: 'midi_out',
        label: 'MIDI Out',
        signalType: 'midi',
        connectors: ['midi_trs', 'midi_din'],
      },
    ],
  },
  {
    heading: 'Control',
    options: [
      {
        role: 'expression',
        label: 'Expression',
        signalType: 'expression',
        connectors: ['trs', 'ts'],
      },
      {
        role: 'remote',
        label: 'Remote',
        signalType: 'remote',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'cv',
        label: 'CV',
        signalType: 'cv',
        connectors: ['ts', 'trs'],
      },
    ],
  },
];

const CONNECTOR_LABELS: Record<Connector, string> = {
  ts: '1/4" TS (mono)',
  trs: '1/4" TRS (stereo / balanced)',
  xlr: 'XLR',
  midi_din: '5-pin DIN',
  midi_trs: 'TRS MIDI',
};

function pickDefaultSide(draft: WizardDraft): Side {
  // Land new ports on the first declared jack side, falling back to top.
  const sides: Side[] = ['top', 'bottom', 'left', 'right'];
  for (const s of sides) {
    if (draft.jackSides[AUDIO_SIDE_KEY[s]]) return s;
  }
  return 'top';
}

function ConnectionsStep({ draft, setDraft }: StepProps) {
  const [pickerStep, setPickerStep] = useState<'closed' | 'role' | 'connector'>(
    'closed',
  );
  const [pickedRole, setPickedRole] = useState<RoleOption | null>(null);

  const applyPreset = (preset: ConnectionPreset) => {
    const built = preset.build();
    setDraft((d) => ({
      ...d,
      ports: preset.replaces
        ? built
        : [
            ...d.ports.filter((p) => !built.some((b) => b.role === p.role)),
            ...built,
          ],
    }));
  };

  const removePort = (idx: number) =>
    setDraft((d) => ({
      ...d,
      ports: d.ports.filter((_, i) => i !== idx),
    }));

  const addCustomPort = (role: RoleOption, connector: Connector) => {
    setDraft((d) => {
      const side = pickDefaultSide(d);
      const maxOrderOnSide = d.ports
        .filter((p) => p.side === side)
        .reduce((m, p) => Math.max(m, p.sideOrder), -1);
      const nextPort: DraftPort = {
        label: role.label,
        role: role.role,
        signalType: role.signalType,
        connector,
        side,
        sideOrder: maxOrderOnSide + 1,
        optional: true,
      };
      return { ...d, ports: [...d.ports, nextPort] };
    });
    setPickerStep('closed');
    setPickedRole(null);
  };

  return (
    <div className={styles.connectionsStep}>
      <div className={styles.jackSectionLabel}>Quick presets</div>
      <div className={styles.presetChips}>
        {CONNECTION_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.presetChip}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.jackSectionLabel}>
        Ports ({draft.ports.length})
      </div>
      {draft.ports.length === 0 ? (
        <p className={styles.helpMuted}>
          No ports yet. Pick a preset above or add one below.
        </p>
      ) : (
        <ul className={styles.portList}>
          {draft.ports.map((p, idx) => (
            <li key={`${p.role}-${p.label}-${idx}`} className={styles.portRow}>
              <span
                className={
                  p.signalType === 'midi'
                    ? styles.jackDotMidi
                    : styles.jackDotAudio
                }
                aria-hidden
              />
              <span className={styles.portName}>{p.label}</span>
              <span className={styles.portMeta}>
                {p.side} · {p.connector.toUpperCase()}
              </span>
              <button
                type="button"
                className={styles.portRemoveBtn}
                aria-label={`Remove ${p.label}`}
                onClick={() => removePort(idx)}
              >
                <i className="ti ti-x" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pickerStep === 'closed' ? (
        <button
          type="button"
          className={styles.addPortBtn}
          onClick={() => setPickerStep('role')}
        >
          <i className="ti ti-plus" aria-hidden /> Add port
        </button>
      ) : (
        <PortPicker
          step={pickerStep}
          pickedRole={pickedRole}
          onPickRole={(role) => {
            setPickedRole(role);
            setPickerStep('connector');
          }}
          onPickConnector={(connector) => {
            if (pickedRole) addCustomPort(pickedRole, connector);
          }}
          onBack={() => {
            if (pickerStep === 'connector') {
              setPickerStep('role');
              setPickedRole(null);
            } else {
              setPickerStep('closed');
            }
          }}
        />
      )}
    </div>
  );
}

interface PortPickerProps {
  step: 'role' | 'connector';
  pickedRole: RoleOption | null;
  onPickRole: (role: RoleOption) => void;
  onPickConnector: (connector: Connector) => void;
  onBack: () => void;
}

function PortPicker({
  step,
  pickedRole,
  onPickRole,
  onPickConnector,
  onBack,
}: PortPickerProps) {
  return (
    <div className={styles.portPicker}>
      <div className={styles.portPickerHeader}>
        <button
          type="button"
          className={styles.portPickerBack}
          aria-label="Back"
          onClick={onBack}
        >
          <i className="ti ti-chevron-left" aria-hidden /> Back
        </button>
        <span className={styles.portPickerTitle}>
          {step === 'role'
            ? 'Choose port type'
            : `Choose connector · ${pickedRole?.label ?? ''}`}
        </span>
      </div>
      {step === 'role'
        ? ROLE_GROUPS.map((group) => (
            <div key={group.heading}>
              <div className={styles.portPickerSection}>{group.heading}</div>
              {group.options.map((opt) => (
                <button
                  key={opt.role}
                  type="button"
                  className={styles.portPickerOpt}
                  onClick={() => onPickRole(opt)}
                >
                  <span
                    className={
                      opt.signalType === 'midi'
                        ? styles.jackDotMidi
                        : styles.jackDotAudio
                    }
                    aria-hidden
                  />
                  <span className={styles.portPickerOptName}>{opt.label}</span>
                </button>
              ))}
            </div>
          ))
        : pickedRole?.connectors.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.portPickerOpt}
              onClick={() => onPickConnector(c)}
            >
              <span className={styles.portPickerOptName}>
                {CONNECTOR_LABELS[c]}
              </span>
            </button>
          ))}
    </div>
  );
}

function ReviewStep({ draft }: { draft: WizardDraft }) {
  const w = Number(draft.widthIn);
  const d = Number(draft.depthIn);
  return (
    <div className={styles.review}>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Brand</span>
        <span className={styles.reviewVal}>{draft.brand || '—'}</span>
      </div>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Model</span>
        <span className={styles.reviewVal}>{draft.name || '—'}</span>
      </div>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Size</span>
        <span className={styles.reviewVal}>
          {Number.isFinite(w) && w > 0 && Number.isFinite(d) && d > 0
            ? `${w}" × ${d}"`
            : '—'}
        </span>
      </div>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Color</span>
        <span className={styles.reviewVal}>
          <span
            className={styles.colorSwatch}
            style={{ background: draft.color }}
            aria-hidden
          />
          {draft.color}
        </span>
      </div>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Ports</span>
        <span className={styles.reviewVal}>
          {draft.ports.map((p) => p.label).join(', ') || '—'}
        </span>
      </div>
    </div>
  );
}

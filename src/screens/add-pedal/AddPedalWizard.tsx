import { useState, type ChangeEvent } from 'react';
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
import { Button, TextField, WizardShell } from '../../ui';
import styles from './AddPedalWizard.module.css';

interface AddPedalWizardProps {
  onCreated: (pedal: Pedal) => void;
  onCancel: () => void;
}

type DraftPort = Omit<Port, 'id' | 'pedalId'>;

interface WizardDraft {
  color: string;
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
    brand: '',
    name: '',
    widthIn: '',
    depthIn: '',
    jackSides: { ...DEFAULT_JACKS },
    powerSide: 'bottom',
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
      if (!isValidHex(draft.color)) return false;
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
        imagePath: `color:${draft.color}`,
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
      {step === 2 && <JacksStep />}
      {step === 3 && <ConnectionsStep />}
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

function ImageStep({ draft, setDraft }: StepProps) {
  const setColor = (color: string) => setDraft((d) => ({ ...d, color }));
  const customValid = isValidHex(draft.color);

  return (
    <div className={styles.imageStep}>
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
      <p className={styles.helpMuted}>
        Real photo upload + background removal lands in phase 5.
      </p>
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

function JacksStep() {
  return (
    <div className={styles.stub}>
      <p>Per-side audio + MIDI toggles land in phase 4c.</p>
      <p>Default: audio jacks on top, power on the bottom.</p>
    </div>
  );
}

function ConnectionsStep() {
  return (
    <div className={styles.stub}>
      <p>Preset connection chips land in phase 4d.</p>
      <p>Default: mono input + mono output.</p>
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

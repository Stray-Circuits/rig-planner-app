import { useMemo, useState, type ChangeEvent } from 'react';
import { Button, Chip, TextField, WizardShell } from '../../ui';
import { BoardThumb } from '../../canvas/BoardThumb';
import {
  BOARD_PRESETS,
  presetsByBrand,
  type BoardPreset,
} from '../../data/boardPresets';
import type { BoardStyle, Rig } from '../../data/schema';
import { useRigsStore } from '../../stores/rigsStore';
import styles from './NewRigWizard.module.css';

interface NewRigWizardProps {
  onCreated: (rig: Rig) => void;
  onCancel?: () => void;
  /** When provided, used to seed a suggested rig name. */
  rigCount?: number;
}

type Selection = string;
const CUSTOM: Selection = 'custom';

const NAME_SUGGESTIONS = ['Main board', 'Fly rig', 'Studio board', 'Mini rig'];

export function NewRigWizard({
  onCreated,
  onCancel,
  rigCount = 0,
}: NewRigWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(rigCount === 0 ? 'Main board' : '');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [customW, setCustomW] = useState('');
  const [customD, setCustomD] = useState('');
  const [customStyle, setCustomStyle] = useState<BoardStyle>('plain');
  const [submitting, setSubmitting] = useState(false);

  const createRig = useRigsStore((s) => s.createRig);

  const trimmedName = name.trim();
  const customWNum = Number(customW);
  const customDNum = Number(customD);
  const customValid =
    Number.isFinite(customWNum) &&
    Number.isFinite(customDNum) &&
    customWNum > 0 &&
    customDNum > 0;

  const canContinue = step === 0 ? trimmedName.length > 0 : Boolean(selection);
  const canSubmit =
    step === 1 &&
    selection !== null &&
    (selection !== CUSTOM || customValid) &&
    !submitting;

  const handleContinue = () => {
    if (step === 0 && trimmedName) setStep(1);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let widthIn: number;
      let depthIn: number;
      let style: BoardStyle;
      if (selection === CUSTOM) {
        widthIn = customWNum;
        depthIn = customDNum;
        style = customStyle;
      } else {
        const preset = BOARD_PRESETS.find((p) => p.id === selection);
        if (!preset) throw new Error('Preset not found');
        widthIn = preset.widthIn;
        depthIn = preset.depthIn;
        style = preset.style;
      }
      const rig = await createRig({
        name: trimmedName,
        widthIn,
        depthIn,
        style,
      });
      onCreated(rig);
    } catch (err) {
      console.error('Failed to create rig', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 0) {
    return (
      <WizardShell
        step={0}
        totalSteps={2}
        title="Name your rig"
        subtitle="Give this board a name you'll recognize."
        {...(onCancel ? { onClose: onCancel } : {})}
        footerAction={
          <Button
            size="lg"
            fullWidth
            disabled={!canContinue}
            onClick={handleContinue}
          >
            Continue
          </Button>
        }
      >
        <TextField
          inputSize="lg"
          placeholder="e.g. Main board"
          maxLength={40}
          value={name}
          autoFocus
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
        />
        <div className={styles.suggestionsLabel}>Suggestions</div>
        <div className={styles.suggestions}>
          {NAME_SUGGESTIONS.map((s) => (
            <Chip key={s} onClick={() => setName(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step={1}
      totalSteps={2}
      title="Choose your board"
      subtitle="Pick a preset or enter custom dimensions."
      onBack={() => setStep(0)}
      {...(onCancel ? { onClose: onCancel } : {})}
      footerAction={
        <Button
          size="lg"
          fullWidth
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Creating…' : 'Create rig'}
        </Button>
      }
    >
      <BoardPicker
        selection={selection}
        onSelect={setSelection}
        customW={customW}
        customD={customD}
        customStyle={customStyle}
        onCustomW={setCustomW}
        onCustomD={setCustomD}
        onCustomStyle={setCustomStyle}
      />
    </WizardShell>
  );
}

interface BoardPickerProps {
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  customW: string;
  customD: string;
  customStyle: BoardStyle;
  onCustomW: (s: string) => void;
  onCustomD: (s: string) => void;
  onCustomStyle: (s: BoardStyle) => void;
}

function BoardPicker({
  selection,
  onSelect,
  customW,
  customD,
  customStyle,
  onCustomW,
  onCustomD,
  onCustomStyle,
}: BoardPickerProps) {
  const grouped = useMemo(() => presetsByBrand(), []);

  return (
    <>
      {Array.from(grouped.entries()).map(([brand, presets]) => (
        <div key={brand} className={styles.brandSection}>
          <div className={styles.brandLabel}>{brand}</div>
          <div className={styles.presetGrid}>
            {presets.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                selected={selection === p.id}
                onClick={() => onSelect(p.id)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className={styles.brandSection}>
        <div className={styles.brandLabel}>Custom</div>
        <button
          type="button"
          className={[
            styles.customCard,
            selection === CUSTOM ? styles.customCardSelected : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(CUSTOM)}
        >
          <div className={styles.customIcon}>
            <i className="ti ti-ruler-measure" aria-hidden />
          </div>
          <div className={styles.presetInfo}>
            <div className={styles.presetName}>Custom size</div>
            <div className={styles.presetDims}>
              Enter your board&apos;s dimensions
            </div>
          </div>
        </button>
        {selection === CUSTOM ? (
          <div className={styles.customExtras}>
            <div className={styles.dimsRow}>
              <label htmlFor="cw">Width</label>
              <input
                id="cw"
                className={styles.dimInput}
                type="number"
                min={1}
                max={72}
                placeholder="24"
                value={customW}
                onChange={(e) => onCustomW(e.target.value)}
              />
              <label htmlFor="cd">Depth</label>
              <input
                id="cd"
                className={styles.dimInput}
                type="number"
                min={1}
                max={48}
                placeholder="12"
                value={customD}
                onChange={(e) => onCustomD(e.target.value)}
              />
              <span className={styles.dimUnit}>in</span>
            </div>
            <div className={styles.styleLabel}>Board style</div>
            <div className={styles.styleRow}>
              {(['rail', 'plain', 'wood', 'holes'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={[
                    styles.styleChip,
                    customStyle === s ? styles.styleChipSelected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onCustomStyle(s)}
                >
                  <BoardThumb
                    style={s}
                    width={36}
                    height={20}
                    scale={0.2}
                    title={`${s} preview`}
                  />
                  <span className={styles.styleChipLabel}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

interface PresetCardProps {
  preset: BoardPreset;
  selected: boolean;
  onClick: () => void;
}

function PresetCard({ preset, selected, onClick }: PresetCardProps) {
  return (
    <button
      type="button"
      className={[styles.presetCard, selected ? styles.presetCardSelected : '']
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      <BoardThumb
        style={preset.style}
        width={52}
        height={30}
        scale={0.2}
        title={`${preset.brand} ${preset.name}`}
      />
      <div className={styles.presetInfo}>
        <div className={styles.presetName}>{preset.name}</div>
        <div className={styles.presetDims}>
          {preset.widthIn}&quot; × {preset.depthIn}&quot;
        </div>
      </div>
      <span className={styles.presetTag}>
        {preset.style.charAt(0).toUpperCase() + preset.style.slice(1)}
      </span>
    </button>
  );
}

import { useState, type ChangeEvent } from 'react';
import { Button, Chip, TextField, WizardShell } from '../../ui';
import { BoardPicker } from '../../components/BoardPicker';
import {
  resolveBoardChoice,
  useBoardPicker,
} from '../../components/boardPickerHelpers';
import type { Rig } from '../../data/schema';
import {
  DEFAULT_EXTERNAL_IO,
  endpointsForConfig,
  type AmpMode,
  type ExternalIoConfig,
} from '../../lib/externalIo';
import { useRigsStore } from '../../stores/rigsStore';
import { useSignalChainStore } from '../../stores/signalChainStore';
import styles from './NewRigWizard.module.css';

interface NewRigWizardProps {
  onCreated: (rig: Rig) => void;
  onCancel?: () => void;
  /** When provided, used to seed a suggested rig name. */
  rigCount?: number;
}

const NAME_SUGGESTIONS = ['Main board', 'Fly rig', 'Studio board', 'Mini rig'];

export function NewRigWizard({
  onCreated,
  onCancel,
  rigCount = 0,
}: NewRigWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(rigCount === 0 ? 'Main board' : '');
  const [io, setIo] = useState<ExternalIoConfig>(DEFAULT_EXTERNAL_IO);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picker = useBoardPicker();
  const createRig = useRigsStore((s) => s.createRig);
  const addEndpoint = useSignalChainStore((s) => s.addEndpoint);

  const trimmedName = name.trim();
  const choice = resolveBoardChoice(picker.props);

  const canContinue =
    step === 0 ? trimmedName.length > 0 : step === 1 ? choice !== null : true;
  const canSubmit = step === 2 && choice !== null && !submitting;

  const handleContinue = () => {
    if (step === 0 && trimmedName) setStep(1);
    else if (step === 1 && choice) setStep(2);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !choice) return;
    setSubmitting(true);
    setError(null);
    try {
      const rig = await createRig({
        name: trimmedName,
        widthIn: choice.widthIn,
        depthIn: choice.depthIn,
        style: choice.style,
        presetId: choice.source === 'custom' ? null : choice.source,
      });
      // Seed the rig's external endpoints from the wizard choices. Done
      // here (before navigating) so ensureDefaultEndpoints on first
      // RigScreen mount is a no-op — the user gets exactly what they asked
      // for, not the generic Guitar + Amp pair.
      for (const e of endpointsForConfig(io)) {
        await addEndpoint(rig.id, e.kind, e.label);
      }
      onCreated(rig);
    } catch (err) {
      console.error('Failed to create rig', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 0) {
    return (
      <WizardShell
        step={0}
        totalSteps={3}
        title="Name Your Rig"
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

  if (step === 1) {
    return (
      <WizardShell
        step={1}
        totalSteps={3}
        title="Choose Your Board"
        subtitle="Pick a preset or enter custom dimensions."
        onBack={() => setStep(0)}
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
        <BoardPicker {...picker.props} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      step={2}
      totalSteps={3}
      title="What's Outside the Board?"
      subtitle="Tells the signal-chain view what to plug into."
      onBack={() => setStep(1)}
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
      <ExternalIoStep value={io} onChange={setIo} />
      {error ? (
        <div className={styles.errorBox} role="alert">
          <i className="ti ti-alert-triangle" aria-hidden /> {error}
        </div>
      ) : null}
    </WizardShell>
  );
}

interface ExternalIoStepProps {
  value: ExternalIoConfig;
  onChange: (next: ExternalIoConfig) => void;
}

function ExternalIoStep({ value, onChange }: ExternalIoStepProps) {
  const setGuitarCount = (n: number) =>
    onChange({ ...value, guitarCount: Math.max(1, Math.min(4, n)) });
  const setAmpMode = (m: AmpMode) => onChange({ ...value, ampMode: m });
  const toggleFx = () =>
    onChange({ ...value, ampHasFxLoop: !value.ampHasFxLoop });

  const ampModes: { id: AmpMode; label: string; sub: string }[] = [
    { id: 'mono', label: 'Mono', sub: '1 input' },
    { id: 'stereo_trs', label: 'Stereo (TRS)', sub: '1 TRS jack' },
    { id: 'dual_mono', label: 'Dual mono', sub: '2 inputs (L + R)' },
  ];

  return (
    <div className={styles.ioStep}>
      <div className={styles.ioField}>
        <div className={styles.ioFieldLabel}>Instrument outputs</div>
        <div className={styles.ioFieldHelp}>
          How many guitar / bass / synth sources will feed this board?
        </div>
        <div className={styles.counterRow}>
          <button
            type="button"
            className={styles.counterBtn}
            aria-label="Fewer instruments"
            onClick={() => setGuitarCount(value.guitarCount - 1)}
            disabled={value.guitarCount <= 1}
          >
            <i className="ti ti-minus" aria-hidden />
          </button>
          <span className={styles.counterValue}>{value.guitarCount}</span>
          <button
            type="button"
            className={styles.counterBtn}
            aria-label="More instruments"
            onClick={() => setGuitarCount(value.guitarCount + 1)}
            disabled={value.guitarCount >= 4}
          >
            <i className="ti ti-plus" aria-hidden />
          </button>
        </div>
      </div>

      <div className={styles.ioField}>
        <div className={styles.ioFieldLabel}>Amp input</div>
        <div className={styles.ioFieldHelp}>
          How do you plug into your amp / interface / mixer?
        </div>
        <div className={styles.radioGrid} role="radiogroup">
          {ampModes.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={value.ampMode === m.id}
              className={`${styles.radioCard} ${
                value.ampMode === m.id ? styles.radioCardActive : ''
              }`}
              onClick={() => setAmpMode(m.id)}
            >
              <div className={styles.radioCardLabel}>{m.label}</div>
              <div className={styles.radioCardSub}>{m.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={value.ampHasFxLoop}
          onChange={toggleFx}
        />
        <div>
          <div className={styles.checkRowLabel}>FX loop</div>
          <div className={styles.checkRowSub}>
            Adds FX Send + FX Return endpoints you can wire pedals into.
          </div>
        </div>
      </label>
    </div>
  );
}

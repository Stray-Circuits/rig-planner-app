import { useState, type ChangeEvent } from 'react';
import { Button, Chip, TextField, WizardShell } from '../../ui';
import { BoardPicker } from '../../components/BoardPicker';
import {
  resolveBoardChoice,
  useBoardPicker,
} from '../../components/boardPickerHelpers';
import type { Rig } from '../../data/schema';
import { useRigsStore } from '../../stores/rigsStore';
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picker = useBoardPicker();
  const createRig = useRigsStore((s) => s.createRig);

  const trimmedName = name.trim();
  const choice = resolveBoardChoice(picker.props);

  const canContinue = step === 0 ? trimmedName.length > 0 : choice !== null;
  const canSubmit = step === 1 && choice !== null && !submitting;

  const handleContinue = () => {
    if (step === 0 && trimmedName) setStep(1);
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
      });
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
      <BoardPicker {...picker.props} />
      {error ? (
        <div className={styles.errorBox} role="alert">
          <i className="ti ti-alert-triangle" aria-hidden /> {error}
        </div>
      ) : null}
    </WizardShell>
  );
}

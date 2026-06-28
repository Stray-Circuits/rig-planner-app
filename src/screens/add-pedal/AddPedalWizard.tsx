import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type {
  JackSides,
  Pedal,
  Side,
  PortRole,
  SignalType,
  Connector,
} from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useSignalChainStore } from '../../stores/signalChainStore';
import { createPedal, updatePedal } from '../../data/pedalsRepo';
import { isQuotaExceededError } from '../../data/memoryAdapter';
import {
  blobToDataURL,
  createChromaKeySession,
  cropToContent,
  describeImageError,
  hasDownloadedModel,
  isMeteredConnection,
  markModelDownloaded,
  prefetchBgRemoval,
  removeBackground,
  sampleDominantImageColor,
  shrinkImage,
  type BgRemovalProgress,
  type ChromaKeySession,
} from '../../lib/bgRemoval';
import { ImageEditor } from './ImageEditor';
import {
  fetchImageAsBlob,
  isBraveSearchConfigured,
  searchPedalImages,
  type BraveImageResult,
  type BraveSearchOutcome,
} from '../../lib/braveSearch';
import {
  extractPedalMetadata,
  findPedalDimensionsByQuery,
  type ExtractedPedalMetadata,
} from '../../lib/pedalMetadata';
import { findPedalInCatalog } from '../../data/pedalCatalog';
import { useBackHandler } from '../../lib/useBackHandler';
import { portLayoutGroup } from '../../lib/geometry';
import { Button, TextField, WizardShell } from '../../ui';
import styles from './AddPedalWizard.module.css';

interface AddPedalWizardProps {
  onCreated: (pedal: Pedal) => void;
  onCancel: () => void;
  /**
   * When provided, the wizard opens pre-populated with this pedal's data
   * and the final Submit calls updatePedal() instead of createPedal().
   * onCreated still fires with the fresh pedal so the parent can react
   * the same way for both flows.
   */
  initialPedal?: Pedal;
}

import {
  applySameSideMove,
  newDraftPortId,
  renumberFxLoops,
  type DraftPort,
} from './portReorder';

type DraftPortFields = Omit<DraftPort, '_draftId'>;

interface WizardDraft {
  color: string;
  /** Data-URL of a background-removed photo. When set, takes precedence over `color`. */
  photoDataUrl: string | null;
  /** Raw user upload kept across step navigation so "Re-process" can retry. */
  photoSource: Blob | null;
  /**
   * Where the current `photoDataUrl` came from when it was fetched from the
   * web (Brave Search result). Null for color placeholders and for photos
   * uploaded directly from the device.
   */
  photoSourceUrl: string | null;
  brand: string;
  name: string;
  widthIn: string;
  depthIn: string;
  powerSide: Side | null;
  ports: DraftPort[];
}

const DEFAULT_COLOR = '#666666';

const EMPTY_JACKS: JackSides = {
  top: false,
  bottom: false,
  left: false,
  right: false,
  midi_top: false,
  midi_bottom: false,
  midi_left: false,
  midi_right: false,
};

// Modern pedals (Stray Circuits and most boutique builds) put jacks on
// the top edge by default, so fresh ports land there. The inline editor
// lets the user move them to a side edge for older / side-jack pedals.
// Out comes first (sideOrder 0) so that on a top-mounted row the order
// reads Out, In from left to right — matching the right-to-left signal
// flow convention used everywhere else in the app.
const DEFAULT_PORTS: DraftPortFields[] = [
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

const STEPS = ['Image', 'Name & size', 'Connections', 'Review'];

function initialDraft(): WizardDraft {
  return {
    color: DEFAULT_COLOR,
    photoDataUrl: null,
    photoSource: null,
    photoSourceUrl: null,
    brand: '',
    name: '',
    widthIn: '',
    depthIn: '',
    powerSide: 'top',
    ports: DEFAULT_PORTS.map((p) => ({ ...p, _draftId: newDraftPortId() })),
  };
}

/**
 * Hydrate a wizard draft from an existing pedal. Used by the Edit flow
 * so the user starts with everything pre-filled.
 *
 * imagePath strings starting with `color:` are placeholder records — we
 * convert them back into the color picker's state. Anything else is
 * treated as a data URL.
 */
function draftFromPedal(pedal: Pedal): WizardDraft {
  const isColorPlaceholder =
    typeof pedal.imagePath === 'string' && pedal.imagePath.startsWith('color:');
  return {
    color: isColorPlaceholder
      ? pedal.imagePath!.slice('color:'.length)
      : DEFAULT_COLOR,
    photoDataUrl: isColorPlaceholder ? null : (pedal.imagePath ?? null),
    photoSource: null,
    photoSourceUrl: pedal.imageSourceUrl ?? null,
    brand: pedal.brand,
    name: pedal.name,
    widthIn: String(pedal.widthIn),
    depthIn: String(pedal.depthIn),
    powerSide: pedal.powerSide,
    ports: renumberFxLoops(
      pedal.ports.map(({ pedalId: _pedalId, ...rest }) => ({
        ...rest,
        _draftId: newDraftPortId(),
      })),
    ),
  };
}

export function AddPedalWizard({
  onCreated,
  onCancel,
  initialPedal,
}: AddPedalWizardProps) {
  const isEdit = !!initialPedal;
  // Edit flow opens straight at Name & size — the user already has an
  // image they don't want to re-process. They can still scroll back to
  // step 0 (Image) if they want to swap the photo.
  const [step, setStep] = useState(isEdit ? 1 : 0);
  const [draft, setDraft] = useState<WizardDraft>(() =>
    initialPedal ? draftFromPedal(initialPedal) : initialDraft(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while ImageStep is running bg-removal. Surfaces a banner on
  // every subsequent step so the user knows it's still going, and
  // disables Submit on the Review step until the photo lands.
  const [imageProcessing, setImageProcessing] = useState(false);
  // True while the brand/name/dim metadata pipeline is still resolving
  // after a Brave image pick (extractPedalMetadata on the source page
  // + findPedalDimensionsByQuery against the spec-host result set).
  // Surfaces a banner on Name & Size so the user understands why the
  // fields are still empty — and so they don't get spooked when the
  // fields pop in 5-10 seconds later.
  const [metadataProcessing, setMetadataProcessing] = useState(false);
  // True while ImageStep is in a sub-mode (web search panel open or
  // threshold tuning open). Combined with the dirty checks below to
  // decide whether a backdrop click can dismiss the wizard.
  const [imageStepEngaged, setImageStepEngaged] = useState(false);

  // The pedals store needs to know about the newly-created row.
  const reloadPedals = usePedalsStore((s) => s.loadPedals);
  const reloadPlaced = usePlacedPedalsStore((s) => s.loadForRig);
  const reloadChain = useSignalChainStore((s) => s.loadForRig);

  const widthNum = Number(draft.widthIn);
  const depthNum = Number(draft.depthIn);
  const trimmedName = draft.name.trim();
  const trimmedBrand = draft.brand.trim();

  // Backdrop click dismisses only when the user hasn't invested any work
  // in this wizard session — initial Image step, no photo, no typed fields,
  // no sub-mode open. The X button stays available regardless so the user
  // always has a deliberate way out.
  const isDirty =
    step > 0 ||
    draft.photoSource !== null ||
    draft.photoDataUrl !== null ||
    trimmedBrand !== '' ||
    trimmedName !== '' ||
    draft.widthIn.trim() !== '' ||
    draft.depthIn.trim() !== '' ||
    imageProcessing ||
    imageStepEngaged;

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

  // Hardware/browser back walks the wizard backwards a step at a time,
  // then closes on step 0 — matches the in-wizard Back button so the
  // user's work doesn't vanish on a single Android-back tap.
  useBackHandler(true, () => {
    if (step > 0) setStep(step - 1);
    else onCancel();
  });

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
      const payload = {
        brand: trimmedBrand,
        name: trimmedName,
        widthIn: widthNum,
        depthIn: depthNum,
        imagePath: draft.photoDataUrl ?? `color:${draft.color}`,
        // Only persist a source URL when we actually have a photo to point
        // back at. Color placeholders drop the URL.
        imageSourceUrl: draft.photoDataUrl ? draft.photoSourceUrl : null,
        // jackSides is derived from the port list — the dedicated Jacks
        // step was retired in #52 in favor of a live preview alongside
        // the port list. Persist what the ports actually say.
        jackSides: derivedJackSides(draft.ports),
        powerSide: draft.powerSide,
        ports: draft.ports.map(({ _draftId: _id, ...rest }) => rest),
      };
      let result: Pedal;
      if (initialPedal) {
        const { pedal, removedPortIds } = await updatePedal(
          initialPedal.id,
          payload,
        );
        result = pedal;
        // If we removed ports, refresh every rig that had this pedal
        // placed so the canvas drops the now-orphan cables.
        if (removedPortIds.length > 0) {
          const usage = await usePedalsStore.getState().usage(initialPedal.id);
          await Promise.all(
            usage.flatMap((rigId) => [reloadPlaced(rigId), reloadChain(rigId)]),
          );
        }
      } else {
        result = await createPedal(payload);
      }
      await reloadPedals();
      onCreated(result);
    } catch (err) {
      if (isQuotaExceededError(err)) {
        setError(
          'Browser storage is full. Pedal photos take a few hundred KB each — pick a placeholder color instead, or delete unused pedals first. Tauri/desktop builds have no such limit.',
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
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
      dismissOnBackdrop={!isDirty}
      {...(step > 0 ? { onBack: handleBack } : {})}
      footerAction={
        <Button
          size="lg"
          fullWidth
          disabled={
            !canAdvanceFromCurrent ||
            submitting ||
            (isLastStep && imageProcessing)
          }
          onClick={() => {
            if (isLastStep) void handleSubmit();
            else handleContinue();
          }}
        >
          {isLastStep
            ? submitting
              ? 'Saving…'
              : imageProcessing
                ? 'Waiting for photo…'
                : isEdit
                  ? 'Save changes'
                  : 'Add to library'
            : 'Continue'}
        </Button>
      }
    >
      {step > 0 && imageProcessing ? (
        <div className={styles.bgProcessingBanner} role="status">
          <i className="ti ti-loader" aria-hidden /> Removing background…
          we&apos;ll attach the photo as soon as it&apos;s ready.
        </div>
      ) : null}
      {step > 0 && metadataProcessing ? (
        <div className={styles.bgProcessingBanner} role="status">
          <i className="ti ti-loader" aria-hidden /> Looking up the brand,
          model, and dimensions… fields will fill in as soon as we find them.
        </div>
      ) : null}
      {step === 0 && (
        <ImageStep
          draft={draft}
          setDraft={setDraft}
          onProcessingChange={setImageProcessing}
          onMetadataProcessingChange={setMetadataProcessing}
          onEngagementChange={setImageStepEngaged}
        />
      )}
      {step === 1 && <NameSizeStep draft={draft} setDraft={setDraft} />}
      {step === 2 && <ConnectionsStep draft={draft} setDraft={setDraft} />}
      {step === 3 && <ReviewStep draft={draft} setDraft={setDraft} />}
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
      return 'Pedal Image';
    case 1:
      return 'Name & Size';
    case 2:
      return 'Connections';
    case 3:
      return 'Review';
    default:
      return STEPS[step] ?? '';
  }
}

function subtitleForStep(step: number): string {
  switch (step) {
    case 0:
      return 'Upload a photo (we’ll remove the background) or pick a placeholder color.';
    case 1:
      return 'Tell us what the pedal is and how big it is.';
    case 2:
      return 'What ports does the pedal have?';
    case 3:
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

/** Quick-pick chips next to the native color picker. */
const QUICK_PICKS = [
  '#C62828', // red
  '#E65100', // orange
  '#2E7D32', // green
  '#1565C0', // blue
  '#4A148C', // purple
  '#212121', // black
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

/**
 * Each phase maps to a [start, end] slice of the overall 0..100% bar so
 * progress always advances forward — never resets at phase boundaries —
 * and never reaches 100% before the very last step. Tuned so:
 *   • the early lightweight phases occupy a thin sliver,
 *   • inference (the slowest visible step) gets the biggest slice,
 *   • the bar caps at 96% until finalizing actually starts.
 */
const PHASE_RANGES: Record<BgRemovalProgress['phase'], [number, number]> = {
  'preparing-image': [0, 0.05],
  'loading-library': [0.05, 0.1],
  'initializing-runtime': [0.1, 0.25],
  'fetching-model': [0.1, 0.7],
  processing: [0.25, 0.96],
  finalizing: [0.96, 1],
};

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * Reject obviously unsupported uploads up front so the user sees a clear
 * message instead of an opaque createImageBitmap decode error. iOS HEIC
 * comes through as `image/heic` or `image/heif` (or no MIME with a `.heic`
 * extension); browsers can't decode it without a polyfill.
 */
function rejectUnsupportedImage(file: Blob): string | null {
  const mime = file.type.toLowerCase();
  const name = file instanceof File ? file.name.toLowerCase() : '';
  if (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  ) {
    return "HEIC photos from iOS aren't supported in the browser yet — please export as JPEG or PNG first.";
  }
  if (mime && !mime.startsWith('image/')) {
    return `That doesn't look like an image (${mime || 'unknown type'}). Try a JPEG or PNG.`;
  }
  return null;
}

// Playful subtext per phase. Don't reach for accuracy here — the bar
// already conveys progress. Avoid words like "slow"; the user knows.
const PHASE_SUBS: Record<BgRemovalProgress['phase'], string | null> = {
  'preparing-image': 'Politely asking your photo to sit still.',
  'loading-library': 'Unpacking the scissors.',
  'initializing-runtime': 'Stretching before the heavy lifting.',
  'fetching-model':
    'Fetching the AI brain (one-time). Future uploads will skip this.',
  processing: 'Carefully tracing the outline.',
  finalizing: 'Tidying the edges.',
};

interface ImageStepProps extends StepProps {
  /** Notifies the wizard when bg-removal is in flight so it can show a
   * banner on later steps and disable Submit on Review. */
  onProcessingChange: (active: boolean) => void;
  /**
   * Notifies the wizard when the brand/name/dim metadata pipeline is
   * still resolving after a Brave image pick. Fires `true` when both
   * promises are dispatched and `false` when they settle, so the
   * banner on later steps explains why the fields haven't filled yet.
   */
  onMetadataProcessingChange: (active: boolean) => void;
  /**
   * Notifies the wizard when the user is in an Image-step sub-mode — search
   * panel open, threshold tuning open. The wizard combines this with its
   * own dirty signals to lock backdrop dismissal so accidental clicks
   * outside the modal don't burn through search quota mid-flow.
   */
  onEngagementChange: (engaged: boolean) => void;
}

/**
 * Search sub-mode state. `idle` is the initial input-only view; `searching`
 * is in-flight; `ok` shows results (with optional `error` overlay if the
 * user picked a result that failed to download); `error` covers
 * key/quota/network problems we couldn't render results for.
 */
/**
 * How many result thumbnails to render at once. We always pull the API max
 * (100) in a single query and append SEARCH_PAGE_SIZE more on each "Show
 * more" tap — burning one quota token per search no matter how deep the
 * user scrolls.
 */
const SEARCH_PAGE_SIZE = 20;

interface SearchState {
  query: string;
  status: 'idle' | 'searching' | 'ok' | 'error' | 'fetching';
  results: BraveImageResult[];
  /** How many of `results` to render. Grows by SEARCH_PAGE_SIZE on "Show more". */
  visibleCount: number;
  error: string | null;
  /** Set while fetching the user-picked image so we can show a spinner over it. */
  pickedUrl?: string;
}

function outcomeToState(
  query: string,
  outcome: BraveSearchOutcome,
): SearchState {
  const base = { query, visibleCount: SEARCH_PAGE_SIZE };
  switch (outcome.kind) {
    case 'ok':
      return {
        ...base,
        status: 'ok',
        results: outcome.results,
        error:
          outcome.results.length === 0
            ? 'No results. Try a more specific query or upload a photo instead.'
            : null,
      };
    case 'rate_limited':
      return {
        ...base,
        status: 'error',
        results: [],
        error:
          'Search is temporarily unavailable (rate limit). Try again in a few minutes.',
      };
    case 'unauthorized':
      return {
        ...base,
        status: 'error',
        results: [],
        error:
          'Search is unavailable — the built-in API key is invalid. Upload a photo or pick a color for now.',
      };
    case 'server_error':
      return {
        ...base,
        status: 'error',
        results: [],
        error: `Search failed (status ${outcome.status}). Try again later.`,
      };
    case 'network_error':
      return {
        ...base,
        status: 'error',
        results: [],
        error:
          "Couldn't reach the search service. The browser dev build can't make cross-origin search requests — try the desktop or mobile build.",
      };
    case 'disabled':
      return {
        ...base,
        status: 'error',
        results: [],
        error: 'Search is disabled in this build.',
      };
    case 'empty_query':
      return { ...base, status: 'idle', results: [], error: null };
  }
}

interface SearchViewProps {
  search: SearchState;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  onPick: (result: BraveImageResult) => void;
  onShowMore: () => void;
  onCancel: () => void;
}

function SearchView({
  search,
  onQueryChange,
  onSubmit,
  onPick,
  onShowMore,
  onCancel,
}: SearchViewProps) {
  const busy = search.status === 'searching' || search.status === 'fetching';
  const shownResults = search.results.slice(0, search.visibleCount);
  const remaining = search.results.length - shownResults.length;
  return (
    <div className={styles.imageStep}>
      <form
        className={styles.searchForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <TextField
          inputSize="md"
          autoFocus
          placeholder="Boss DS-1"
          value={search.query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Pedal name to search for"
        />
        <Button
          type="submit"
          disabled={busy || search.query.trim().length === 0}
        >
          {search.status === 'searching' ? 'Searching…' : 'Search'}
        </Button>
      </form>

      <p className={styles.helpMuted}>
        Pick a top-down shot — pedal flat, knobs facing up, brand right-side up.
        Angled or 3/4-view shots will sit crooked on your board (we don&apos;t
        rotate the photo for you).
      </p>

      {search.error ? (
        <div className={styles.errorBox} role="alert">
          <i className="ti ti-alert-triangle" aria-hidden /> {search.error}
        </div>
      ) : null}

      {search.status === 'searching' ? (
        <div className={styles.searchPlaceholder} role="status">
          Searching the web…
        </div>
      ) : null}

      {shownResults.length > 0 ? (
        <ul className={styles.searchResults} aria-label="Search results">
          {shownResults.map((r) => {
            const isPicking =
              search.status === 'fetching' && search.pickedUrl === r.imageUrl;
            return (
              <li key={r.imageUrl}>
                <button
                  type="button"
                  className={styles.searchResultTile}
                  onClick={() => onPick(r)}
                  disabled={busy}
                  aria-label={r.title || 'Search result'}
                >
                  <img
                    src={r.thumbnailUrl}
                    alt=""
                    className={styles.searchResultThumb}
                    loading="lazy"
                  />
                  <span className={styles.searchResultMeta}>
                    {hostnameOf(r.sourceUrl)}
                    {r.width && r.height ? ` · ${r.width}×${r.height}` : ''}
                  </span>
                  {isPicking ? (
                    <span className={styles.searchResultOverlay}>
                      <i className="ti ti-loader" aria-hidden /> Downloading…
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <div className={styles.searchShowMore}>
          <Button variant="secondary" onClick={onShowMore} disabled={busy}>
            Show more ({remaining} left)
          </Button>
        </div>
      ) : search.results.length > SEARCH_PAGE_SIZE ? (
        <p className={styles.helpMuted}>
          You&apos;ve seen all {search.results.length} results.
        </p>
      ) : null}

      <p className={styles.helpMuted}>
        Tap a result and we&apos;ll download it, remove the background, and save
        where it came from so you can credit the source later. Photos are
        subject to their source&apos;s terms — make sure any photo you save is
        OK for your personal use.
      </p>

      <div className={styles.photoActions}>
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Apply two metadata sources to the draft, with the first source winning
 * per-field. Both promises run in parallel; only the writes are sequenced.
 * Each apply uses an "only fill empty" guard so the user's typed values
 * take precedence over everything, and the second source can only fill
 * fields the first source left null.
 */
async function applyMetadataInOrder(
  first: Promise<ExtractedPedalMetadata | null>,
  second: Promise<ExtractedPedalMetadata | null>,
  setDraft: (
    next: WizardDraft | ((current: WizardDraft) => WizardDraft),
  ) => void,
): Promise<void> {
  const apply = (m: ExtractedPedalMetadata | null): void => {
    if (!m) return;
    setDraft((d) => ({
      ...d,
      ...(d.brand.trim() === '' && m.brand ? { brand: m.brand } : {}),
      ...(d.name.trim() === '' && m.name ? { name: m.name } : {}),
      ...(d.widthIn.trim() === '' && m.widthIn !== null
        ? { widthIn: String(m.widthIn) }
        : {}),
      ...(d.depthIn.trim() === '' && m.depthIn !== null
        ? { depthIn: String(m.depthIn) }
        : {}),
    }));
  };
  try {
    apply(await first);
  } catch {
    // Best effort — both branches are purely additive.
  }
  try {
    apply(await second);
  } catch {
    // Same.
  }
}

function ImageStep({
  draft,
  setDraft,
  onProcessingChange,
  onMetadataProcessingChange,
  onEngagementChange,
}: ImageStepProps) {
  const setColor = (color: string) => setDraft((d) => ({ ...d, color }));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<BgRemovalProgress | null>(null);
  // Echo processing state up to the wizard so it can advertise the
  // background work on later steps and gate Submit on Review.
  useEffect(() => {
    onProcessingChange(progress !== null);
  }, [progress, onProcessingChange]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // When non-null, the wizard is asking the user to confirm a model download
  // over a metered connection. `pending` holds the file to process if they
  // accept.
  const [meteredPrompt, setMeteredPrompt] = useState<{ file: Blob } | null>(
    null,
  );
  // When non-null, the wizard is in "tune the threshold" sub-mode.
  // previewDataUrl is the live-updated transparent PNG that reflects the
  // current tolerance; the user can Apply it to draft.photoDataUrl or
  // Cancel back to whatever they had before.
  const [threshold, setThreshold] = useState<{
    tolerance: number;
    previewDataUrl: string | null;
    busy: boolean;
  } | null>(null);

  // When non-null, the wizard is in "search the web" sub-mode. status drives
  // which render branch we show (input vs. results vs. error). The Brave
  // search affordance is gated on a key being baked in — if not, hide it
  // entirely so the user doesn't see a button that always errors.
  const searchEnabled = isBraveSearchConfigured();
  const [search, setSearch] = useState<SearchState | null>(null);

  // When non-null, the wizard is in the rotate/straighten/crop editor
  // sub-mode on `file`. Apply runs the chosen edits and feeds the
  // result into the normal bg-removal pipeline.
  const [editor, setEditor] = useState<{ file: Blob } | null>(null);

  // Echo sub-mode engagement up to the wizard so it can lock backdrop
  // dismissal — a stray click outside the modal during search wastes a
  // Brave API call AND drops the user back to square one.
  useEffect(() => {
    onEngagementChange(
      search !== null || threshold !== null || editor !== null,
    );
  }, [search, threshold, editor, onEngagementChange]);

  // Warm the bg-removal chunk so it's ready by the time the user clicks
  // "Use a photo". Best-effort, no UI feedback for the prefetch itself.
  useEffect(() => {
    prefetchBgRemoval();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Run the full pipeline (shrink → bg removal → crop → dataURL) when
   * `removeBg` is true. Skip the bg-removal step when false — used for
   * already-transparent PNGs the user prepared elsewhere, OR as an escape
   * hatch when the model fails (e.g. white pedal on white background).
   */
  const processFile = async (file: Blob, removeBg: boolean) => {
    setError(null);
    const rejection = rejectUnsupportedImage(file);
    if (rejection) {
      setError(rejection);
      return;
    }
    // Cancel any in-flight run before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft((d) => ({ ...d, photoSource: file }));
    try {
      setProgress({ phase: 'preparing-image', fraction: null });
      // 1024 matches imgly's default ISNet input resolution — going lower
      // throws away detail the model could otherwise use and leaves the
      // saved transparent PNG looking grainy when the canvas zooms in.
      const shrunk = await shrinkImage(file, 1024);
      if (controller.signal.aborted) throw abortError();
      const processed = removeBg
        ? await removeBackground(shrunk, {
            onProgress: setProgress,
            signal: controller.signal,
          })
        : shrunk;
      if (controller.signal.aborted) throw abortError();
      setProgress({ phase: 'finalizing', fraction: null });
      const cropped = await cropToContent(processed);
      if (controller.signal.aborted) throw abortError();
      const dataUrl = await blobToDataURL(cropped);
      // Sample the dominant color of the bg-removed image so the rig
      // canvas has a sensible fallback tint behind the photo (and a
      // visible placeholder if the photo URL ever 404s). Best effort —
      // a null result means we keep the user's previous color.
      const sampled = await sampleDominantImageColor(cropped).catch(() => null);
      setDraft((d) => ({
        ...d,
        photoDataUrl: dataUrl,
        ...(sampled ? { color: sampled } : {}),
      }));
    } catch (err) {
      setError(describeImageError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
    }
  };

  const handleCancelProcessing = () => {
    abortRef.current?.abort();
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // A device upload has no source URL — clear any URL carried over from a
    // prior search-picked photo.
    setDraft((d) => ({ ...d, photoSourceUrl: null }));
    // Warn before kicking off the ~176MB model fetch on a metered connection.
    if (isMeteredConnection() && !hasDownloadedModel()) {
      setMeteredPrompt({ file });
      return;
    }
    void processFile(file, true).then(() => markModelDownloaded());
  };

  const handleEditorApply = async (
    edited: Blob,
    options: { hadExplicitCrop: boolean },
  ): Promise<void> => {
    // The editor operates on the bg-removed PNG, so the result keeps
    // its alpha channel. If the user only rotated/straightened (no
    // explicit crop), the alpha bbox now includes the transparent
    // wedges that rotation introduced — tighten via cropToContent so
    // we don't store padding. With an explicit crop, respect it
    // literally; the user already picked their framing.
    const tightened = options.hadExplicitCrop
      ? edited
      : await cropToContent(edited).catch(() => edited);
    const dataUrl = await blobToDataURL(tightened);
    const sampled = await sampleDominantImageColor(tightened).catch(() => null);
    setDraft((d) => ({
      ...d,
      photoDataUrl: dataUrl,
      ...(sampled ? { color: sampled } : {}),
    }));
    setEditor(null);
  };

  const handleEditorCancel = () => {
    setEditor(null);
  };

  const handleEditExisting = async (): Promise<void> => {
    if (!draft.photoDataUrl) return;
    // Bg-removed dataURL → Blob the editor can rasterize. fetch() is
    // the simplest cross-runtime way to do this — works under Tauri
    // and `pnpm dev` without a custom base64 decode path.
    try {
      const blob = await fetch(draft.photoDataUrl).then((r) => r.blob());
      setEditor({ file: blob });
    } catch {
      // Decode failed; leave the user where they were so they can pick
      // a fresh photo. Surfacing a banner here would be overkill — the
      // existing post-process row stays usable.
    }
  };

  const acceptMeteredDownload = () => {
    const file = meteredPrompt?.file;
    setMeteredPrompt(null);
    if (file) void processFile(file, true).then(() => markModelDownloaded());
  };

  const skipMeteredBgRemoval = () => {
    const file = meteredPrompt?.file;
    setMeteredPrompt(null);
    // Use-as-is path: still resize + crop but skip the model entirely so
    // no big download.
    if (file) void processFile(file, false);
  };

  const handleReprocess = () => {
    if (draft.photoSource) void processFile(draft.photoSource, true);
  };

  const handleUseOriginal = () => {
    if (draft.photoSource) void processFile(draft.photoSource, false);
  };

  const handleUseColor = () => {
    setDraft((d) => ({
      ...d,
      photoDataUrl: null,
      photoSource: null,
      photoSourceUrl: null,
    }));
    setError(null);
  };

  // Cached chroma-key context — decode the source ONCE, then each slider
  // tick reuses the in-memory pixel buffer instead of re-decoding through
  // createImageBitmap + canvas.toBlob (which was the per-tick bottleneck).
  const chromaSessionRef = useRef<ChromaKeySession | null>(null);
  // Flips true once the session is ready; included in the render effect's
  // deps so the initial preview fires the same way as later slider ticks.
  const [chromaSessionReady, setChromaSessionReady] = useState(false);
  // Generation counter so a slow createChromaKeySession from a previous
  // entry can't overwrite chromaSessionRef after the user has cancelled
  // and re-entered with a different source (or flash an error toast on a
  // flow they already abandoned).
  const enterGenRef = useRef(0);

  const enterThreshold = () => {
    if (!draft.photoSource) return;
    const source = draft.photoSource;
    chromaSessionRef.current = null;
    setChromaSessionReady(false);
    setThreshold({ tolerance: 0.12, previewDataUrl: null, busy: true });
    const gen = ++enterGenRef.current;
    void (async () => {
      try {
        const session = await createChromaKeySession(source);
        if (gen !== enterGenRef.current) return;
        chromaSessionRef.current = session;
        setChromaSessionReady(true);
      } catch (err) {
        if (gen !== enterGenRef.current) return;
        setError(describeImageError(err));
        setThreshold(null);
      }
    })();
  };

  // Re-run chroma-key whenever the slider settles OR the session becomes
  // ready (initial render). 50ms debounce — short enough that a stop-and-
  // -hold feels instant, long enough to batch out a drag's rapid onChange.
  // Generation counter guards against an older render finishing after a
  // newer one and clobbering the preview.
  const renderGenRef = useRef(0);
  useEffect(() => {
    const session = chromaSessionRef.current;
    if (!threshold || !session || !chromaSessionReady) return;
    const tolerance = threshold.tolerance;
    const gen = ++renderGenRef.current;
    const timeoutId = setTimeout(() => {
      void (async () => {
        try {
          const { dataUrl } = await session.render(tolerance);
          if (gen !== renderGenRef.current) return;
          setThreshold((t) =>
            t ? { ...t, previewDataUrl: dataUrl, busy: false } : null,
          );
        } catch (err) {
          if (gen !== renderGenRef.current) return;
          setError(describeImageError(err));
          setThreshold(null);
        }
      })();
    }, 50);
    return () => clearTimeout(timeoutId);
    // Re-run on tolerance / readiness changes; session is stable through
    // the flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold?.tolerance, chromaSessionReady]);

  const applyThreshold = () => {
    if (!threshold?.previewDataUrl) return;
    const url = threshold.previewDataUrl;
    setDraft((d) => ({ ...d, photoDataUrl: url }));
    enterGenRef.current++; // invalidate any pending session
    chromaSessionRef.current = null;
    setChromaSessionReady(false);
    setThreshold(null);
  };

  const cancelThreshold = () => {
    enterGenRef.current++; // invalidate any pending session
    chromaSessionRef.current = null;
    setChromaSessionReady(false);
    setThreshold(null);
  };

  // ---------- Search sub-mode ----------
  const openSearch = () => {
    const prefill = [draft.brand, draft.name]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(' ');
    setSearch({
      query: prefill,
      status: 'idle',
      results: [],
      visibleCount: SEARCH_PAGE_SIZE,
      error: null,
    });
  };

  const closeSearch = () => setSearch(null);

  const updateSearchQuery = (query: string) =>
    setSearch((s) => (s ? { ...s, query } : null));

  const showMoreSearchResults = () =>
    setSearch((s) =>
      s
        ? {
            ...s,
            visibleCount: Math.min(
              s.results.length,
              s.visibleCount + SEARCH_PAGE_SIZE,
            ),
          }
        : null,
    );

  const runSearch = async () => {
    if (!search) return;
    const query = search.query.trim();
    if (query.length === 0) return;
    setSearch({
      query,
      status: 'searching',
      results: [],
      visibleCount: SEARCH_PAGE_SIZE,
      error: null,
    });
    try {
      const outcome = await searchPedalImages(query);
      setSearch((current) => {
        // Bail if the user closed/changed the search since we kicked off.
        if (current?.query !== query) return current;
        return outcomeToState(query, outcome);
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSearch((current) =>
        current
          ? {
              ...current,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            }
          : null,
      );
    }
  };

  const pickResult = async (result: BraveImageResult) => {
    setSearch((s) =>
      s ? { ...s, status: 'fetching', pickedUrl: result.imageUrl } : null,
    );
    const blob = await fetchImageAsBlob(result.imageUrl).catch(() => null);
    if (!blob) {
      setSearch((s) =>
        s
          ? {
              ...s,
              status: 'ok',
              error:
                "Couldn't download that image — try a different result, or upload one yourself.",
            }
          : null,
      );
      return;
    }
    // Close the search panel and stamp the source URL on the draft. The
    // existing bg-removal pipeline will land the dataURL on draft.photoDataUrl.
    // Capture the query NOW — `setSearch(null)` below clears the state we'd
    // otherwise read from when firing the dimension search.
    const query = search?.query.trim() ?? '';
    setSearch(null);
    setDraft((d) => ({ ...d, photoSourceUrl: result.sourceUrl }));
    void processFile(blob, true).then(() => markModelDownloaded());
    // Two metadata branches, fired in parallel with bg-removal:
    //   1. The page that hosts the picked image — best signal for
    //      brand/name when it's a retailer / manufacturer page.
    //   2. A separate Brave web search for "{query} dimensions" that
    //      scrapes the top spec-host hits — necessary because most
    //      picked images come from eBay / Reddit / blogs whose source
    //      pages have no specs.
    // Writes are sequenced (source first, dim-search second) so the
    // user-picked page wins per-field. The "only fill empty" guard
    // preserves anything the user has typed in the meantime AND keeps
    // the dim-search from clobbering source-page values.
    onMetadataProcessingChange(true);
    void applyMetadataInOrder(
      extractPedalMetadata(result.sourceUrl).then((o) =>
        o.kind === 'ok' ? o.metadata : null,
      ),
      query.length > 0
        ? findPedalDimensionsByQuery(query)
        : Promise.resolve(null),
      setDraft,
    ).finally(() => onMetadataProcessingChange(false));
  };

  // ---------- Rotate / straighten / crop editor ----------
  if (editor) {
    return (
      <div className={styles.imageStep}>
        <ImageEditor
          source={editor.file}
          onApply={(blob, opts) => void handleEditorApply(blob, opts)}
          onCancel={handleEditorCancel}
        />
      </div>
    );
  }

  // ---------- Web search ----------
  if (search) {
    return (
      <SearchView
        search={search}
        onQueryChange={updateSearchQuery}
        onSubmit={() => void runSearch()}
        onPick={(r) => void pickResult(r)}
        onShowMore={showMoreSearchResults}
        onCancel={closeSearch}
      />
    );
  }

  // ---------- Threshold tuning ----------
  if (threshold) {
    const preview = threshold.previewDataUrl ?? draft.photoDataUrl;
    return (
      <div className={styles.imageStep}>
        <div className={styles.pedalPreview}>
          <div
            className={styles.pedalPhotoPreview}
            style={{ background: draft.color }}
          >
            {preview ? (
              <img
                src={preview}
                alt="Threshold preview"
                className={styles.pedalPhoto}
              />
            ) : null}
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.label}>
            Tolerance · {Math.round(threshold.tolerance * 100)}%
            {threshold.busy ? ' (updating…)' : ''}
          </span>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.005}
            value={threshold.tolerance}
            onChange={(e) =>
              setThreshold((t) =>
                t ? { ...t, tolerance: Number(e.target.value) } : null,
              )
            }
            className={styles.slider}
          />
        </label>
        <p className={styles.helpMuted}>
          Samples the four corners of your photo as the background color and
          erases pixels within this tolerance. Useful when the model erases a
          light-colored pedal.
        </p>
        <div className={styles.photoActions}>
          <Button onClick={applyThreshold} disabled={!threshold.previewDataUrl}>
            Apply
          </Button>
          <Button variant="ghost" onClick={cancelThreshold}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

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
        {draft.photoSourceUrl ? (
          <div className={styles.photoSource}>
            <span className={styles.photoSourceLabel}>
              Where this came from
            </span>
            <a
              className={styles.photoSourceLink}
              href={draft.photoSourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              title={draft.photoSourceUrl}
            >
              {hostnameOf(draft.photoSourceUrl)}
            </a>
          </div>
        ) : null}
        <div className={styles.photoActions}>
          {searchEnabled ? (
            <Button variant="secondary" onClick={openSearch}>
              <i className="ti ti-photo-search" aria-hidden /> Search again
            </Button>
          ) : null}
          <Button variant="secondary" onClick={handleReprocess}>
            <i className="ti ti-refresh" aria-hidden /> Re-process
          </Button>
          <Button variant="secondary" onClick={enterThreshold}>
            <i className="ti ti-adjustments" aria-hidden /> Tune threshold
          </Button>
          {draft.photoDataUrl ? (
            <Button
              variant="secondary"
              onClick={() => void handleEditExisting()}
            >
              <i className="ti ti-rotate-rectangle" aria-hidden /> Rotate &amp;
              crop
            </Button>
          ) : null}
          <Button variant="secondary" onClick={handleUseOriginal}>
            Use as-is
          </Button>
          <Button variant="ghost" onClick={handleUseColor}>
            Color instead
          </Button>
        </div>
        <p className={styles.helpMuted}>
          Model erased part of the pedal? <strong>Tune threshold</strong> gives
          you a slider that removes a single bg color.{' '}
          <strong>Use as-is</strong> skips bg removal entirely.
        </p>
      </div>
    );
  }

  // ---------- Processing: progress bar + cancel-by-replacing-source ----------
  if (progress) {
    const phaseLabel = PHASE_LABELS[progress.phase];
    const phaseSub = PHASE_SUBS[progress.phase];
    // Map phase + inner fraction into the overall 0..100% bar. Null
    // inner-fractions sit at the phase's midpoint so the bar still
    // advances when we switch phases, and we cap below 100% until the
    // very last phase.
    const [phaseStart, phaseEnd] = PHASE_RANGES[progress.phase];
    const inner = progress.fraction ?? 0.5;
    const overall = phaseStart + (phaseEnd - phaseStart) * inner;
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
              style={{ width: `${Math.round(overall * 100)}%` }}
            />
          </div>
          <div className={styles.progressActions}>
            <Button variant="ghost" size="sm" onClick={handleCancelProcessing}>
              Cancel
            </Button>
          </div>
          <p className={styles.helpMuted}>
            You can hit <strong>Continue</strong> and fill in the pedal info
            while this finishes. The photo will attach itself when it&apos;s
            ready.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Metered-connection confirm before first-time model fetch ----
  if (meteredPrompt) {
    return (
      <div className={styles.imageStep}>
        <div className={styles.meteredBox} role="alert">
          <div className={styles.meteredTitle}>
            <i className="ti ti-cellular-signal-3" aria-hidden /> You appear to
            be on cellular data
          </div>
          <p className={styles.meteredBody}>
            Removing the background uses a one-time <strong>~176 MB</strong>{' '}
            model download. It&apos;s cached after that, but the first run is
            heavy on a metered plan.
          </p>
          <div className={styles.photoActions}>
            <Button onClick={acceptMeteredDownload}>Download anyway</Button>
            <Button variant="secondary" onClick={skipMeteredBgRemoval}>
              Use photo as-is
            </Button>
            <Button variant="ghost" onClick={() => setMeteredPrompt(null)}>
              Cancel
            </Button>
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
      {searchEnabled ? (
        <button type="button" className={styles.uploadCta} onClick={openSearch}>
          <i className="ti ti-photo-search" aria-hidden />
          <span className={styles.uploadCtaTitle}>Search the web</span>
          <span className={styles.uploadCtaSub}>
            Find a product photo and we&apos;ll remove the background
          </span>
        </button>
      ) : null}

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
      <div className={styles.colorRow}>
        <label className={styles.colorPickerWrap}>
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setColor(e.target.value)}
            className={styles.colorPicker}
            aria-label="Pick a color"
          />
          <span className={styles.colorHex}>{draft.color.toUpperCase()}</span>
        </label>
        <div className={styles.quickPicks} aria-label="Quick picks">
          {QUICK_PICKS.map((s) => {
            const selected = draft.color.toLowerCase() === s.toLowerCase();
            return (
              <button
                key={s}
                type="button"
                aria-label={`Color ${s}`}
                aria-pressed={selected}
                className={`${styles.quickPick} ${selected ? styles.quickPickSelected : ''}`}
                style={{ background: s }}
                onClick={() => setColor(s)}
              />
            );
          })}
        </div>
      </div>
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

  // Debounced catalog lookup: as the user types brand + name, match
  // against the built-in catalog and silently fill width/depth if both
  // dim fields are still empty. Same "fill empty only" guard the
  // metadata pipeline uses (see applyMetadataInOrder above) so we
  // never trample anything the user has already typed.
  const brandTrim = draft.brand.trim();
  const nameTrim = draft.name.trim();
  const widthEmpty = draft.widthIn.trim() === '';
  const depthEmpty = draft.depthIn.trim() === '';
  useEffect(() => {
    if (brandTrim.length === 0 || nameTrim.length === 0) return;
    if (!widthEmpty || !depthEmpty) return;
    const handle = window.setTimeout(() => {
      const hit = findPedalInCatalog(brandTrim, nameTrim);
      if (!hit) return;
      setDraft((d) => ({
        ...d,
        ...(d.widthIn.trim() === '' ? { widthIn: String(hit.widthIn) } : {}),
        ...(d.depthIn.trim() === '' ? { depthIn: String(hit.depthIn) } : {}),
      }));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [brandTrim, nameTrim, widthEmpty, depthEmpty, setDraft]);

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

/**
 * Project draft ports onto a JackSides bitmap — replaces the dedicated
 * Jacks step. A port on `right` with an audio signal type implies an
 * audio jack on the right; same for MIDI on its own bitmap channels.
 */
function derivedJackSides(ports: DraftPort[]): JackSides {
  const out: JackSides = { ...EMPTY_JACKS };
  for (const p of ports) {
    const isMidi = p.role === 'midi_in' || p.role === 'midi_out';
    if (isMidi) out[MIDI_SIDE_KEY[p.side]] = true;
    else out[AUDIO_SIDE_KEY[p.side]] = true;
  }
  return out;
}

function JackPreview({ ports, color }: { ports: DraftPort[]; color: string }) {
  // Group ports by side and sort each group with the same canonical key the
  // canvas uses (portLayoutGroup → sideOrder) so the preview matches where
  // each port will actually appear on the pedal once placed.
  const bySide: Record<Side, DraftPort[]> = {
    top: [],
    bottom: [],
    left: [],
    right: [],
  };
  for (const p of ports) bySide[p.side].push(p);
  for (const side of SIDES_IN_ORDER) {
    bySide[side.side].sort((a, b) => {
      const ag = portLayoutGroup(a.role);
      const bg = portLayoutGroup(b.role);
      if (ag !== bg) return ag - bg;
      return a.sideOrder - b.sideOrder;
    });
  }

  return (
    <div className={styles.jackPreviewWrap}>
      <div className={styles.jackPreviewBox} style={{ background: color }}>
        {SIDES_IN_ORDER.flatMap(({ side }) => {
          const siblings = bySide[side];
          return siblings.map((p, idx) => {
            const fwd = (idx + 1) / (siblings.length + 1);
            // Top/bottom: first sibling (inputs) anchors on the right;
            // left/right: first sibling anchors at the top — matches the
            // canvas rule in portPositionOnBoard.
            const along = side === 'top' || side === 'bottom' ? 1 - fwd : fwd;
            const isMidi = p.signalType === 'midi';
            const style: React.CSSProperties = { position: 'absolute' };
            if (side === 'top' || side === 'bottom') {
              if (side === 'top') style.top = '-4px';
              else style.bottom = '-4px';
              style.left = `${along * 100}%`;
              style.transform = 'translate(-50%, 0)';
            } else {
              if (side === 'left') style.left = '-4px';
              else style.right = '-4px';
              style.top = `${along * 100}%`;
              style.transform = 'translate(0, -50%)';
            }
            return (
              <span
                key={p._draftId}
                className={isMidi ? styles.jackDotMidi : styles.jackDotAudio}
                style={style}
                aria-hidden
              />
            );
          });
        })}
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

function mkPort(spec: DraftPortFields): DraftPort {
  return { ...spec, _draftId: newDraftPortId() };
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
      // True dual-mono: separate L+R input and L+R output jacks. Right
      // channels are optional so the pedal still validates when used
      // mono-only (left channel as the primary path).
      mkPort({
        label: 'In L',
        role: 'input_l',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 2,
        optional: false,
      }),
      mkPort({
        label: 'In R',
        role: 'input_r',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 3,
        optional: true,
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
      // Top edge with sideOrders past the widest audio preset (dual-
      // mono uses 0-3) so FX Send/Return sit beside the audio ports
      // rather than colliding with them.
      mkPort({
        label: 'FX Send',
        role: 'fx_send',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 6,
        optional: true,
      }),
      mkPort({
        label: 'FX Return',
        role: 'fx_return',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 7,
        optional: true,
      }),
    ],
  },
  {
    id: 'midi',
    label: '+ MIDI',
    replaces: false,
    build: () => [
      // Top edge with sideOrders well past the widest audio preset
      // (dual-mono uses 0-3) so MIDI sits to the right of audio when
      // composing "Dual mono stereo + MIDI".
      mkPort({
        label: 'MIDI In',
        role: 'midi_in',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'top',
        sideOrder: 5,
        optional: true,
      }),
      mkPort({
        label: 'MIDI Out',
        role: 'midi_out',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'top',
        sideOrder: 4,
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
        role: 'expression_in',
        label: 'Expression In',
        signalType: 'expression',
        connectors: ['trs', 'ts'],
      },
      {
        role: 'expression_out',
        label: 'Expression Out',
        signalType: 'expression',
        connectors: ['trs', 'ts'],
      },
      {
        role: 'remote_in',
        label: 'Remote In',
        signalType: 'remote',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'remote_out',
        label: 'Remote Out',
        signalType: 'remote',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'cv_in',
        label: 'CV In',
        signalType: 'cv',
        connectors: ['ts', 'trs'],
      },
      {
        role: 'cv_out',
        label: 'CV Out',
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

/**
 * Where to land a freshly-added port. Modern pedals (Stray Circuits and
 * most boutique builds) jack everything on the top edge, so that's the
 * default for every role. The user can move ports later via the inline
 * editor for older / side-jack pedals.
 */
function defaultSideForRole(_role: PortRole): Side {
  return 'top';
}

/**
 * Resolve a dnd-kit identifier back to the human label of the port it
 * names, for screen-reader announcements. Falls back to the raw id so an
 * unmapped value still says something instead of crashing.
 */
function labelForDraftId(ports: DraftPort[], id: string | number): string {
  const target = ports.find((p) => p._draftId === String(id));
  return target?.label ?? String(id);
}

interface SortablePortRowProps {
  port: DraftPort;
  isOptional: boolean;
  children: ReactNode;
}

/**
 * Wraps a port row with dnd-kit's sortable plumbing. The drag handle is
 * the only element that listens for the drag gesture — the rest of the
 * row (edit/remove buttons, the inline editor) keeps its normal tap
 * behavior. We render a sibling visual "card" wrapping the handle plus
 * children so the border + opacity styling stays on the visible row.
 */
function SortablePortRow({ port, isOptional, children }: SortablePortRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: port._draftId });
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition: transition ?? undefined,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${styles.portRow} ${isOptional ? styles.portRowOptional : ''}`}
      {...attributes}
    >
      <button
        type="button"
        className={styles.portDragHandle}
        aria-label={`Reorder ${port.label}`}
        {...listeners}
      >
        <i className="ti ti-grip-vertical" aria-hidden />
      </button>
      <span
        className={
          port.signalType === 'midi' ? styles.jackDotMidi : styles.jackDotAudio
        }
        aria-hidden
      />
      {children}
    </li>
  );
}

function ConnectionsStep({ draft, setDraft }: StepProps) {
  const [pickerStep, setPickerStep] = useState<
    'closed' | 'category' | 'role' | 'connector' | 'side'
  >('closed');
  const [pickedRole, setPickedRole] = useState<RoleOption | null>(null);
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const [pickedConnector, setPickedConnector] = useState<Connector | null>(
    null,
  );
  // Track the open editor by _draftId, not array index — applyPreset,
  // removePort, and drag-reorder all shuffle draft.ports, and an index
  // would silently retarget the editor onto a different port.
  const [editingId, setEditingId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const prevPickerStepRef = useRef(pickerStep);

  // Scroll the picker into view only on the closed → open transition,
  // not on every internal category → role → connector step (the picker
  // is already on screen at that point).
  useEffect(() => {
    if (prevPickerStepRef.current === 'closed' && pickerStep !== 'closed') {
      pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevPickerStepRef.current = pickerStep;
  }, [pickerStep]);

  const updatePortById = (id: string, patch: Partial<DraftPort>) =>
    setDraft((d) => ({
      ...d,
      ports: d.ports.map((p) => (p._draftId === id ? { ...p, ...patch } : p)),
    }));

  const applyPreset = (preset: ConnectionPreset) => {
    const built = preset.build();
    setDraft((d) => ({
      ...d,
      ports: renumberFxLoops(
        preset.replaces
          ? built
          : [
              ...d.ports.filter((p) => !built.some((b) => b.role === p.role)),
              ...built,
            ],
      ),
    }));
    // Whichever port the editor was open on may have been replaced.
    setEditingId(null);
  };

  const removePortById = (id: string) =>
    setDraft((d) => ({
      ...d,
      ports: renumberFxLoops(d.ports.filter((p) => p._draftId !== id)),
    }));

  // Same-side reorder via drag handle. dnd-kit drives the JSX; sideOrder
  // is renormalized after each successful move so the canvas slot layout
  // tracks the new visual order. Cross-side drops are rejected — moving a
  // port to a different edge is a property change (the inline editor's
  // side dropdown), not a drag-and-drop gesture.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((d) => ({
      ...d,
      ports: applySameSideMove(d.ports, String(active.id), String(over.id)),
    }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const addCustomPort = (
    role: RoleOption,
    connector: Connector,
    side: Side,
  ) => {
    setDraft((d) => {
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
        _draftId: newDraftPortId(),
      };
      return { ...d, ports: renumberFxLoops([...d.ports, nextPort]) };
    });
    setPickerStep('closed');
    setPickedRole(null);
    setPickedConnector(null);
  };

  return (
    <div className={styles.connectionsStep}>
      <JackPreview ports={draft.ports} color={draft.color} />

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) =>
                `Picked up port ${labelForDraftId(draft.ports, active.id)}`,
              onDragOver: ({ active, over }) =>
                over
                  ? `${labelForDraftId(draft.ports, active.id)} is over ${labelForDraftId(draft.ports, over.id)}`
                  : `${labelForDraftId(draft.ports, active.id)} is no longer over a port`,
              onDragEnd: ({ active, over }) =>
                over
                  ? `${labelForDraftId(draft.ports, active.id)} dropped on ${labelForDraftId(draft.ports, over.id)}`
                  : `${labelForDraftId(draft.ports, active.id)} dropped`,
              onDragCancel: ({ active }) =>
                `Reorder of ${labelForDraftId(draft.ports, active.id)} cancelled`,
            },
          }}
        >
          <SortableContext
            items={draft.ports.map((p) => p._draftId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className={styles.portList}>
              {draft.ports.map((p) => {
                const isEditing = editingId === p._draftId;
                return (
                  <SortablePortRow
                    key={p._draftId}
                    port={p}
                    isOptional={p.optional}
                  >
                    {isEditing ? (
                      <PortInlineEditor
                        port={p}
                        onChange={(patch) => updatePortById(p._draftId, patch)}
                        onDone={() => setEditingId(null)}
                      />
                    ) : (
                      <>
                        <div className={styles.portInfo}>
                          <span className={styles.portName}>{p.label}</span>
                          <span className={styles.portMeta}>
                            {p.side} · {p.connector.toUpperCase()}
                            {p.optional ? ' · optional' : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.portEditBtn}
                          aria-label={`Edit ${p.label}`}
                          onClick={() => setEditingId(p._draftId)}
                        >
                          <i className="ti ti-pencil" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={styles.portRemoveBtn}
                          aria-label={`Remove ${p.label}`}
                          onClick={() => removePortById(p._draftId)}
                        >
                          <i className="ti ti-x" aria-hidden />
                        </button>
                      </>
                    )}
                  </SortablePortRow>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {pickerStep === 'closed' ? (
        <button
          type="button"
          className={styles.addPortBtn}
          onClick={() => {
            setPickedCategory(null);
            setPickerStep('category');
          }}
        >
          <i className="ti ti-plus" aria-hidden /> Add Port
        </button>
      ) : (
        <div ref={pickerRef}>
          <PortPicker
            step={pickerStep}
            pickedCategory={pickedCategory}
            pickedRole={pickedRole}
            pickedConnector={pickedConnector}
            defaultSide={
              pickedRole ? defaultSideForRole(pickedRole.role) : 'top'
            }
            onPickCategory={(heading) => {
              setPickedCategory(heading);
              setPickerStep('role');
            }}
            onPickRole={(role) => {
              setPickedRole(role);
              setPickerStep('connector');
            }}
            onPickConnector={(connector) => {
              // Skip the side step: derive it from the role using the app's
              // right-to-left convention (inputs right, outputs left). The
              // user can still nudge a port to a different side later via
              // the inline editor.
              if (pickedRole) {
                const side = defaultSideForRole(pickedRole.role);
                addCustomPort(pickedRole, connector, side);
              }
            }}
            onPickSide={(side) => {
              if (pickedRole && pickedConnector)
                addCustomPort(pickedRole, pickedConnector, side);
            }}
            onBack={() => {
              if (pickerStep === 'connector') {
                setPickerStep('role');
                setPickedRole(null);
              } else if (pickerStep === 'role') {
                setPickerStep('category');
                setPickedCategory(null);
              } else {
                setPickerStep('closed');
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

interface PortPickerProps {
  step: 'category' | 'role' | 'connector' | 'side';
  pickedCategory: string | null;
  pickedRole: RoleOption | null;
  pickedConnector: Connector | null;
  defaultSide: Side;
  onPickCategory: (heading: string) => void;
  onPickRole: (role: RoleOption) => void;
  onPickConnector: (connector: Connector) => void;
  onPickSide: (side: Side) => void;
  onBack: () => void;
}

const SIDE_LABELS: Record<Side, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

function PortPicker({
  step,
  pickedCategory,
  pickedRole,
  pickedConnector,
  defaultSide,
  onPickCategory,
  onPickRole,
  onPickConnector,
  onPickSide,
  onBack,
}: PortPickerProps) {
  const title =
    step === 'category'
      ? 'Choose port category'
      : step === 'role'
        ? `Choose port type · ${pickedCategory ?? ''}`
        : step === 'connector'
          ? `Choose connector · ${pickedRole?.label ?? ''}`
          : `Choose side · ${pickedRole?.label ?? ''}`;
  const roleGroup = ROLE_GROUPS.find((g) => g.heading === pickedCategory);
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
        <span className={styles.portPickerTitle}>{title}</span>
      </div>
      {step === 'category' && (
        <div className={styles.portPickerList}>
          {ROLE_GROUPS.map((group) => (
            <button
              key={group.heading}
              type="button"
              className={styles.portPickerOpt}
              onClick={() => onPickCategory(group.heading)}
            >
              <span className={styles.portPickerOptName}>{group.heading}</span>
              <span className={styles.portPickerHint}>
                {group.options.length} option
                {group.options.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 'role' && roleGroup && (
        <div className={styles.portPickerList}>
          {roleGroup.options.map((opt) => (
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
      )}
      {step === 'connector' &&
        pickedRole?.connectors.map((c) => (
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
      {step === 'side' && (
        <>
          {(['top', 'right', 'bottom', 'left'] as Side[]).map((side) => (
            <button
              key={side}
              type="button"
              className={styles.portPickerOpt}
              onClick={() => onPickSide(side)}
            >
              <span className={styles.portPickerOptName}>
                {SIDE_LABELS[side]}
                {side === defaultSide ? (
                  <span className={styles.portPickerHint}> · suggested</span>
                ) : null}
              </span>
            </button>
          ))}
          {pickedConnector ? (
            <p className={styles.helpMuted}>
              Picked: {CONNECTOR_LABELS[pickedConnector]}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

interface PortInlineEditorProps {
  port: DraftPort;
  onChange: (patch: Partial<DraftPort>) => void;
  onDone: () => void;
}

/**
 * Inline edit panel for an existing port: change side, swap connector.
 * Role/signalType are fixed (changing those is conceptually a remove +
 * re-add). The connector dropdown is constrained to the set declared on
 * the role option so users can't pick a nonsensical pairing.
 */
function PortInlineEditor({ port, onChange, onDone }: PortInlineEditorProps) {
  const roleOption = ROLE_GROUPS.flatMap((g) => g.options).find(
    (o) => o.role === port.role,
  );
  const connectors = roleOption?.connectors ?? [port.connector];
  return (
    <div className={styles.portEditor}>
      <span className={styles.portEditorLabel}>{port.label}</span>
      <select
        className={styles.portEditorSelect}
        aria-label="Port side"
        value={port.side}
        onChange={(e) => onChange({ side: e.target.value as Side })}
      >
        <option value="top">Top</option>
        <option value="right">Right</option>
        <option value="bottom">Bottom</option>
        <option value="left">Left</option>
      </select>
      <select
        className={styles.portEditorSelect}
        aria-label="Port connector"
        value={port.connector}
        onChange={(e) => onChange({ connector: e.target.value as Connector })}
      >
        {connectors.map((c) => (
          <option key={c} value={c}>
            {CONNECTOR_LABELS[c]}
          </option>
        ))}
      </select>
      <label className={styles.portEditorRequired}>
        <input
          type="checkbox"
          checked={!port.optional}
          onChange={(e) => onChange({ optional: !e.target.checked })}
        />
        <span>Required</span>
      </label>
      <button
        type="button"
        className={styles.portEditorDone}
        aria-label="Done editing"
        onClick={onDone}
      >
        <i className="ti ti-check" aria-hidden />
        <span className={styles.portEditorDoneText}>Done</span>
      </button>
    </div>
  );
}

function ReviewStep({ draft, setDraft }: StepProps) {
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
      <label className={styles.reviewRow}>
        <span className={styles.reviewKey}>
          {draft.photoDataUrl ? 'Fallback color' : 'Color'}
        </span>
        <span className={styles.reviewVal}>
          <input
            type="color"
            className={styles.reviewColorPicker}
            value={isValidHex(draft.color) ? draft.color : DEFAULT_COLOR}
            onChange={(e) => setDraft((s) => ({ ...s, color: e.target.value }))}
            aria-label="Fallback color"
          />
          {draft.color}
        </span>
      </label>
      <div className={styles.reviewRow}>
        <span className={styles.reviewKey}>Ports</span>
        <span className={styles.reviewVal}>
          {draft.ports.map((p) => p.label).join(', ') || '—'}
        </span>
      </div>
    </div>
  );
}

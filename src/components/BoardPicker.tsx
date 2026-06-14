import { useMemo, useState } from 'react';
import {
  MONO_SERIES_ORDER,
  PEDALTRAIN_SERIES_ORDER,
  TEMPLE_AUDIO_SERIES_ORDER,
  findPreset,
  monoPresetsBySeries,
  pedaltrainPresetsBySeries,
  templeAudioPresetsBySeries,
  type BoardPreset,
  type BoardSeries,
} from '../data/boardPresets';
import type { BoardStyle } from '../data/schema';
import { BoardThumb } from '../canvas/BoardThumb';
import { CUSTOM_SELECTION, type BoardSelection } from './boardPickerHelpers';
import styles from './BoardPicker.module.css';

interface BoardPickerProps {
  selection: BoardSelection | null;
  customW: string;
  customD: string;
  customStyle: BoardStyle;
  onSelect: (s: BoardSelection) => void;
  onCustomW: (s: string) => void;
  onCustomD: (s: string) => void;
  onCustomStyle: (s: BoardStyle) => void;
}

type View = 'brand' | 'pedaltrain' | 'temple-audio' | 'mono' | 'custom';

/** Pick a representative preset image to put on a brand card. */
function brandThumbPreset(
  brand: 'Pedaltrain' | 'Temple Audio' | 'Mono',
): BoardPreset | undefined {
  // Pedaltrain's Classic Pro is the most-photographed of their lineup;
  // Temple Audio has no images yet so the card will just show the procedural
  // holes drawer behind whatever board is there. Mono shows the Medium
  // pedalboard in black — most recognizable silhouette of the line.
  const preferredId =
    brand === 'Pedaltrain'
      ? 'pedaltrain-classic-pro'
      : brand === 'Temple Audio'
        ? 'temple-duo-24'
        : 'mono-medium-black';
  return findPreset(preferredId);
}

/** Pick the brand a stored selection belongs to (for initial view). */
function brandOfSelection(selection: BoardSelection | null): View {
  if (selection === null) return 'brand';
  if (selection === CUSTOM_SELECTION) return 'custom';
  const preset = findPreset(selection);
  if (!preset) return 'brand';
  if (preset.brand === 'Pedaltrain') return 'pedaltrain';
  if (preset.brand === 'Temple Audio') return 'temple-audio';
  if (preset.brand === 'Mono') return 'mono';
  return 'brand';
}

/**
 * Multi-stage board picker: brand select → board list. The Pedaltrain
 * lineup is 19 boards, so its second stage is grouped by series with
 * each series collapsed by default. The Custom branch goes straight to
 * the dimension form. Internal navigation (which stage, which series
 * are open) is local; the resolved selection bubbles up through the
 * existing controlled-component contract.
 */
export function BoardPicker({
  selection,
  customW,
  customD,
  customStyle,
  onSelect,
  onCustomW,
  onCustomD,
  onCustomStyle,
}: BoardPickerProps) {
  const [view, setView] = useState<View>(() => brandOfSelection(selection));
  const [expandedSeries, setExpandedSeries] = useState<Set<BoardSeries>>(() => {
    const set = new Set<BoardSeries>();
    if (selection !== null && selection !== CUSTOM_SELECTION) {
      const preset = findPreset(selection);
      if (preset?.series) set.add(preset.series);
    }
    return set;
  });

  const pedaltrainBySeries = useMemo(() => pedaltrainPresetsBySeries(), []);
  const templeBySeries = useMemo(() => templeAudioPresetsBySeries(), []);
  const monoBySeries = useMemo(() => monoPresetsBySeries(), []);

  const toggleSeries = (s: BoardSeries) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  if (view === 'brand') {
    return (
      <div className={styles.brandList}>
        <BrandCard
          label="Pedaltrain"
          sub="19 boards · Nano to Terra"
          previewPreset={brandThumbPreset('Pedaltrain')}
          onClick={() => setView('pedaltrain')}
        />
        <BrandCard
          label="Temple Audio"
          sub="7 boards · Solo, Duo, Trio"
          previewPreset={brandThumbPreset('Temple Audio')}
          onClick={() => setView('temple-audio')}
        />
        <BrandCard
          label="Mono"
          sub="8 boards · Lite, Pedalboard, Rail"
          previewPreset={brandThumbPreset('Mono')}
          onClick={() => setView('mono')}
        />
        <button
          type="button"
          className={styles.customCard}
          onClick={() => {
            onSelect(CUSTOM_SELECTION);
            setView('custom');
          }}
        >
          <div className={styles.customIcon}>
            <i className="ti ti-ruler-measure" aria-hidden />
          </div>
          <div className={styles.presetInfo}>
            <div className={styles.presetName}>Custom size</div>
            <div className={styles.presetDims}>
              Set your own dimensions and style
            </div>
          </div>
        </button>
      </div>
    );
  }

  if (view === 'pedaltrain') {
    return (
      <div>
        <BackHeader onBack={() => setView('brand')} label="Pedaltrain" />
        <div className={styles.seriesList}>
          {PEDALTRAIN_SERIES_ORDER.map((series) => {
            const presets = pedaltrainBySeries.get(series) ?? [];
            if (presets.length === 0) return null;
            return (
              <SeriesSection
                key={series}
                series={series}
                presets={presets}
                open={expandedSeries.has(series)}
                onToggle={() => toggleSeries(series)}
                selection={selection}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'temple-audio') {
    return (
      <div>
        <BackHeader onBack={() => setView('brand')} label="Temple Audio" />
        <div className={styles.seriesList}>
          {TEMPLE_AUDIO_SERIES_ORDER.map((series) => {
            const presets = templeBySeries.get(series) ?? [];
            if (presets.length === 0) return null;
            return (
              <SeriesSection
                key={series}
                series={series}
                presets={presets}
                open={expandedSeries.has(series)}
                onToggle={() => toggleSeries(series)}
                selection={selection}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'mono') {
    return (
      <div>
        <BackHeader onBack={() => setView('brand')} label="Mono" />
        <div className={styles.seriesList}>
          {MONO_SERIES_ORDER.map((series) => {
            const presets = monoBySeries.get(series) ?? [];
            if (presets.length === 0) return null;
            return (
              <SeriesSection
                key={series}
                series={series}
                presets={presets}
                open={expandedSeries.has(series)}
                onToggle={() => toggleSeries(series)}
                selection={selection}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // view === 'custom'
  return (
    <div>
      <BackHeader
        onBack={() => {
          setView('brand');
        }}
        label="Custom size"
      />
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
    </div>
  );
}

interface BrandCardProps {
  label: string;
  sub: string;
  previewPreset: BoardPreset | undefined;
  onClick: () => void;
}

function BrandCard({ label, sub, previewPreset, onClick }: BrandCardProps) {
  return (
    <button type="button" className={styles.brandCard} onClick={onClick}>
      <div className={styles.brandThumb}>
        {previewPreset ? (
          <BoardThumb
            style={previewPreset.style}
            width={64}
            height={36}
            scale={0.2}
            {...(previewPreset.image !== undefined
              ? { imageSrc: previewPreset.image }
              : {})}
            title={`${label} preview`}
          />
        ) : null}
      </div>
      <div className={styles.presetInfo}>
        <div className={styles.presetName}>{label}</div>
        <div className={styles.presetDims}>{sub}</div>
      </div>
      <i className={`ti ti-chevron-right ${styles.brandChevron}`} aria-hidden />
    </button>
  );
}

interface BackHeaderProps {
  onBack: () => void;
  label: string;
}

function BackHeader({ onBack, label }: BackHeaderProps) {
  return (
    <div className={styles.backHeader}>
      <button
        type="button"
        className={styles.backButton}
        onClick={onBack}
        aria-label="Back to brand select"
      >
        <i className="ti ti-chevron-left" aria-hidden />
        <span>Back</span>
      </button>
      <span className={styles.backLabel}>{label}</span>
    </div>
  );
}

interface SeriesSectionProps {
  series: BoardSeries;
  presets: BoardPreset[];
  open: boolean;
  onToggle: () => void;
  selection: BoardSelection | null;
  onSelect: (s: BoardSelection) => void;
}

function SeriesSection({
  series,
  presets,
  open,
  onToggle,
  selection,
  onSelect,
}: SeriesSectionProps) {
  return (
    <div className={styles.seriesSection}>
      <button
        type="button"
        className={styles.seriesHeader}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={styles.seriesName}>{series}</span>
        <span className={styles.seriesCount}>{presets.length}</span>
        <i
          className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'} ${styles.seriesChevron}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className={styles.seriesBoards}>
          {presets.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              selected={selection === p.id}
              onClick={() => onSelect(p.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface PresetCardProps {
  preset: BoardPreset;
  selected: boolean;
  onClick: () => void;
}

// Every preset thumb renders at the same px-per-inch so cross-board
// comparison reflects real size — a Trio 43 looks ~2.5× the width of a
// Solo 18, and (via the matching scaling in drawHoles) carries ~2.5× the
// hole columns. The wrapper (.presetThumb) is fixed-size at 68×40 with
// 4px padding → 60×32 usable; 1.4 px/in keeps the widest preset
// (Pedaltrain Terra 42, 42″) inside that envelope.
const UNIFORM_THUMB_PX_PER_INCH = 1.4;

function PresetCard({ preset, selected, onClick }: PresetCardProps) {
  const thumbW = preset.widthIn * UNIFORM_THUMB_PX_PER_INCH;
  const thumbH = preset.depthIn * UNIFORM_THUMB_PX_PER_INCH;
  return (
    <button
      type="button"
      className={[styles.presetCard, selected ? styles.presetCardSelected : '']
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      <div className={styles.presetThumb}>
        <BoardThumb
          style={preset.style}
          width={Math.round(thumbW)}
          height={Math.round(thumbH)}
          scale={0.2}
          widthIn={preset.widthIn}
          {...(preset.image !== undefined ? { imageSrc: preset.image } : {})}
          title={`${preset.brand} ${preset.name}`}
        />
      </div>
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

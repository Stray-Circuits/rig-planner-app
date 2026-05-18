import { useMemo } from 'react';
import { presetsByBrand, type BoardPreset } from '../data/boardPresets';
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

/**
 * Controlled board picker — preset cards grouped by brand plus a Custom card
 * with inline dim inputs + style chips. Used by both the New Rig wizard and
 * the Change Board flow on the rig screen.
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
            selection === CUSTOM_SELECTION ? styles.customCardSelected : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(CUSTOM_SELECTION)}
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
        {selection === CUSTOM_SELECTION ? (
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

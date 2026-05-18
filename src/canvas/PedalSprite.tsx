import type { Pedal } from '../data/schema';
import { pedalImageStyle } from '../lib/pedalImage';
import styles from './PedalSprite.module.css';

interface PedalSpriteProps {
  pedal: Pedal;
  /** Pixels per inch — used to convert the pedal's inch dimensions to px. */
  pxPerInch: number;
  /** Rotation in degrees (0/90/180/270). */
  rotation?: 0 | 90 | 180 | 270;
  /** If true, dims the pedal slightly to indicate inactive / library state. */
  inactive?: boolean;
}

/**
 * Renders a single pedal as a colored or image-backed rectangle, sized in
 * inches × pxPerInch. The wrapping <div> is the OUTER bounding box; the
 * inner element is what rotates so dimensions don't change with rotation.
 */
export function PedalSprite({
  pedal,
  pxPerInch,
  rotation = 0,
  inactive,
}: PedalSpriteProps) {
  const widthPx = pedal.widthIn * pxPerInch;
  const depthPx = pedal.depthIn * pxPerInch;
  // For 90/270 rotation the bounding box swaps width/depth so the sprite
  // continues to occupy the right footprint on the board.
  const rotated = rotation === 90 || rotation === 270;
  const outerW = rotated ? depthPx : widthPx;
  const outerH = rotated ? widthPx : depthPx;
  const bgStyle = pedalImageStyle(pedal.imagePath);
  const hasImage = !!bgStyle.backgroundImage;

  return (
    <div
      className={styles.outer}
      style={{
        width: `${outerW}px`,
        height: `${outerH}px`,
        opacity: inactive ? 0.7 : 1,
      }}
    >
      <div
        className={`${styles.body} ${hasImage ? styles.bodyImage : ''}`}
        style={{
          width: `${widthPx}px`,
          height: `${depthPx}px`,
          transform: `rotate(${rotation}deg)`,
          ...bgStyle,
        }}
      >
        <span className={styles.label}>{pedal.name}</span>
      </div>
    </div>
  );
}

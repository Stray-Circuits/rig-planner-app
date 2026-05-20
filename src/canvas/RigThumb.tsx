import type { Pedal, PlacedPedal, Rig } from '../data/schema';
import { pedalImageStyle } from '../lib/pedalImage';
import { placedFootprint } from '../lib/geometry';
import { BoardThumb } from './BoardThumb';
import styles from './RigThumb.module.css';

interface RigThumbProps {
  rig: Pick<Rig, 'widthIn' | 'depthIn' | 'style'>;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  width: number;
  height: number;
  title?: string;
}

/**
 * Board thumbnail with placed-pedal rectangles overlaid. Used in the rig
 * list so users can see at-a-glance which rig has which pedals on it.
 * Pedals render as solid-color or photo-mini rectangles at the correct
 * scale + position; we deliberately skip ports/labels for tiny sizes.
 */
export function RigThumb({
  rig,
  placed,
  pedalsById,
  width,
  height,
  title,
}: RigThumbProps) {
  const pxPerInch = width / rig.widthIn;
  return (
    <div className={styles.wrap} style={{ width, height }}>
      <BoardThumb
        style={rig.style}
        width={width}
        height={height}
        scale={0.3}
        {...(title !== undefined ? { title } : {})}
      />
      <div className={styles.overlay}>
        {placed.map((p) => {
          const pedal = pedalsById.get(p.pedalId);
          if (!pedal) return null;
          const footprint = placedFootprint(pedal, p.rotation);
          const left = p.xIn * pxPerInch;
          const top = p.yIn * pxPerInch;
          const w = footprint.widthIn * pxPerInch;
          const h = footprint.depthIn * pxPerInch;
          const photoStyle = pedalImageStyle(pedal.imagePath);
          return (
            <div
              key={p.id}
              className={styles.pedal}
              style={{
                left,
                top,
                width: w,
                height: h,
                ...photoStyle,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

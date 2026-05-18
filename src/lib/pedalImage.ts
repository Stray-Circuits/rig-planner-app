import { colorFromImagePath } from '../data/seedPedals';

/**
 * Resolve a Pedal.imagePath into CSS style props for rendering it.
 *
 * Three shapes are supported:
 *   - `color:#RRGGBB`  → flat background color (placeholder pedals)
 *   - `data:image/…`   → image data URL (bg-removed photos from the wizard)
 *   - http(s) URLs or filesystem paths → image URL
 *   - null / missing   → fallback gradient so we still see *something*
 */
export interface PedalImageStyle {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
}

const FALLBACK_GRADIENT = 'linear-gradient(135deg, #444 0%, #222 100%)';

export function pedalImageStyle(
  imagePath: string | null | undefined,
): PedalImageStyle {
  if (!imagePath) return { background: FALLBACK_GRADIENT };
  const color = colorFromImagePath(imagePath);
  if (color) return { background: color };
  // Treat anything else as an image source — covers data URLs, blob URLs,
  // and asset paths once we wire those up.
  return {
    backgroundImage: `url("${imagePath}")`,
    backgroundSize: 'contain',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

/**
 * Single-color background style for places that only want a flat color (the
 * library list thumb, the wizard preview card backdrop). Falls back to a
 * neutral grey when the pedal has a real image instead of a color.
 */
export function pedalThumbColor(imagePath: string | null | undefined): string {
  if (!imagePath) return '#444';
  return colorFromImagePath(imagePath) ?? '#444';
}

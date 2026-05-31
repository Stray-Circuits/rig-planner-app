import type { Port, PortRole, SignalType } from '../data/schema';

/**
 * Cable + port-dot colors per signal type, with L/R variants for audio.
 *
 * The palette is tuned to stay distinguishable for the common forms of
 * color blindness (deuteranopia, protanopia, tritanopia). Green is a
 * lighter mint so it doesn't muddle with red; red leans into vermillion
 * (orange-red) for the same reason. Reds, greens, and browns can still
 * coexist as long as they have distinct lightness — which is what this
 * set targets.
 *
 * These constants mirror the CSS custom properties in src/styles/global.css
 * (--cable-*) and the two helpers should stay in lock-step.
 */
/** Mono / Left-channel audio default. Same as the SIGNAL_COLORS instrument tone. */
const AUDIO_DEFAULT = '#7fd49a';
/** Right-channel audio — vermillion, distinct from green for red-green CVD. */
const AUDIO_R = '#d55e00';

export const SIGNAL_COLORS: Record<SignalType, string> = {
  instrument: AUDIO_DEFAULT,
  line: AUDIO_DEFAULT,
  line_balanced: AUDIO_DEFAULT,
  // Stereo deliberately reuses the audio default — a TRS↔TRS stereo
  // cable is rendered as two parallel L/R strands (see
  // STEREO_STRAND_COLORS) so the signal type itself doesn't carry a
  // unique tone. A stereo port split into two mono TS Y-cables uses
  // the OTHER end's L/R color for each leg.
  stereo: AUDIO_DEFAULT,
  amp_level: '#a36b3a',
  midi: '#cc79a7',
  cv: '#f0e442',
  expression: '#e69f00',
  remote: '#9e9e9e',
};

/**
 * Colors for the two strands of a TRS↔TRS stereo cable rendered as
 * parallel conductors. [0] is the "left" tone (mono/instrument green);
 * [1] is the "right" tone (vermillion). Order matches the strand offset
 * sign in ChainOverlay so the same channel always lands on the same
 * physical side of the cable.
 */
export const STEREO_STRAND_COLORS: readonly [string, string] = [
  AUDIO_DEFAULT,
  AUDIO_R,
];

export function colorForSignal(type: SignalType): string {
  return SIGNAL_COLORS[type];
}

/** True iff this role indicates an explicit right channel. */
function isRightChannelRole(role: PortRole): boolean {
  return role === 'input_r' || role === 'output_r';
}

/** True iff this role indicates an explicit left channel. */
function isLeftChannelRole(role: PortRole): boolean {
  return role === 'input_l' || role === 'output_l';
}

/**
 * Cable / port-dot color for a port. For audio signals the L/R role
 * variants override the signal-type color so stereo pairs visually
 * split left = green, right = vermillion. A stereo TRS port itself
 * has no unique color — it falls through to the audio default; the
 * cable renderer decides whether to draw it as parallel L/R strands
 * (true TRS↔TRS) or as a single strand colored by the other end's
 * channel (Y-split into mono TS).
 */
export function colorForPort(port: Pick<Port, 'role' | 'signalType'>): string {
  if (isRightChannelRole(port.role)) return AUDIO_R;
  if (isLeftChannelRole(port.role)) return AUDIO_DEFAULT;
  return colorForSignal(port.signalType);
}

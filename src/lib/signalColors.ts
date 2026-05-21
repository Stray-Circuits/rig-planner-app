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
export const SIGNAL_COLORS: Record<SignalType, string> = {
  instrument: '#7fd49a',
  line: '#7fd49a',
  line_balanced: '#7fd49a',
  stereo: '#56b4e9',
  amp_level: '#a36b3a',
  midi: '#cc79a7',
  cv: '#f0e442',
  expression: '#e69f00',
  remote: '#9e9e9e',
};

/** Mono / Left-channel audio default. Same as the SIGNAL_COLORS instrument tone. */
const AUDIO_DEFAULT = '#7fd49a';
/** Right-channel audio — vermillion, distinct from green for red-green CVD. */
const AUDIO_R = '#d55e00';

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
 * variants override the signal-type color so stereo pairs visually split
 * left = green, right = vermillion. Stereo (single TRS jack), MIDI, CV,
 * expression, etc. fall through to colorForSignal.
 */
export function colorForPort(port: Pick<Port, 'role' | 'signalType'>): string {
  if (isRightChannelRole(port.role)) return AUDIO_R;
  if (isLeftChannelRole(port.role)) return AUDIO_DEFAULT;
  return colorForSignal(port.signalType);
}

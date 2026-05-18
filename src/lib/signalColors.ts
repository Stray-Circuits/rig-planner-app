import type { SignalType } from '../data/schema';

/**
 * Cable + port-dot colors per signal type. These intentionally read straight
 * from the design palette in src/styles/global.css so the constants and CSS
 * vars stay in lock-step.
 */
export const SIGNAL_COLORS: Record<SignalType, string> = {
  instrument: '#66bb6a',
  line: '#42a5f5',
  line_balanced: '#42a5f5',
  stereo: '#ab47bc',
  amp_level: '#ef5350',
  midi: '#ec407a',
  cv: '#ffee58',
  expression: '#ffa726',
  remote: '#9e9e9e',
};

export function colorForSignal(type: SignalType): string {
  return SIGNAL_COLORS[type];
}

import type { ExternalEndpointKind } from '../data/schema';

/**
 * Wizard-friendly model for the external rig I/O. Translates the user's
 * "I have one guitar, one stereo amp with FX loop"-style choices into a
 * flat list of ExternalEndpoint specs the rig should seed on create.
 */
export type AmpMode = 'mono' | 'stereo_trs' | 'dual_mono';

export interface ExternalIoConfig {
  /** Number of instrument-level sources (1+). */
  guitarCount: number;
  /** How the user wires into the amp(s). */
  ampMode: AmpMode;
  /** Whether each amp has an FX loop the user wants to plan around. */
  ampHasFxLoop: boolean;
}

export const DEFAULT_EXTERNAL_IO: ExternalIoConfig = {
  guitarCount: 1,
  ampMode: 'mono',
  ampHasFxLoop: false,
};

export interface EndpointSpec {
  kind: ExternalEndpointKind;
  label: string;
}

export function endpointsForConfig(cfg: ExternalIoConfig): EndpointSpec[] {
  const out: EndpointSpec[] = [];
  for (let i = 0; i < Math.max(1, cfg.guitarCount); i++) {
    out.push({
      kind: 'guitar',
      label: cfg.guitarCount > 1 ? `Guitar ${i + 1}` : 'Guitar',
    });
  }
  switch (cfg.ampMode) {
    case 'mono':
      out.push({ kind: 'amp_in', label: 'Amp' });
      break;
    case 'stereo_trs':
      out.push({ kind: 'amp_in', label: 'Amp (TRS stereo)' });
      break;
    case 'dual_mono':
      out.push({ kind: 'amp_in', label: 'Amp L' });
      out.push({ kind: 'amp_in', label: 'Amp R' });
      break;
  }
  if (cfg.ampHasFxLoop) {
    out.push({ kind: 'amp_fx_send', label: 'FX Send' });
    out.push({ kind: 'amp_fx_return', label: 'FX Return' });
  }
  return out;
}

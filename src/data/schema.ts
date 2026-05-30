/**
 * Domain types — the in-memory shape we use throughout the app.
 * Mirrors the SQLite schema in migrations.ts but normalized (booleans, enums).
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';

export type PortRole =
  | 'input'
  | 'output'
  | 'input_l'
  | 'input_r'
  | 'stereo_input'
  | 'output_l'
  | 'output_r'
  | 'stereo_output'
  | 'fx_send'
  | 'fx_return'
  | 'midi_in'
  | 'midi_out'
  | 'expression_in'
  | 'expression_out'
  | 'remote_in'
  | 'remote_out'
  | 'cv_in'
  | 'cv_out';

export type SignalType =
  | 'instrument'
  | 'line'
  | 'line_balanced'
  | 'stereo'
  | 'amp_level'
  | 'midi'
  | 'cv'
  | 'expression'
  | 'remote';

export type Connector = 'ts' | 'trs' | 'xlr' | 'midi_din' | 'midi_trs';

export type BoardStyle = 'rail' | 'plain' | 'wood' | 'holes';

export type ExternalEndpointKind =
  | 'guitar'
  | 'amp_in'
  | 'amp_fx_send'
  | 'amp_fx_return'
  | 'custom';

export type NodeKind = 'pedal' | 'external';

export interface JackSides {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  midi_top: boolean;
  midi_bottom: boolean;
  midi_left: boolean;
  midi_right: boolean;
}

export interface Port {
  id: string;
  pedalId: string;
  label: string;
  role: PortRole;
  signalType: SignalType;
  connector: Connector;
  side: Side;
  sideOrder: number;
  optional: boolean;
}

export interface Pedal {
  id: string;
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  imagePath: string | null;
  /**
   * Where the photo came from when it was fetched from the web (Brave Search
   * → user-picked thumbnail). Null for color placeholders and for photos the
   * user uploaded from their device. Surfaced as "Where this came from" on
   * Edit Pedal so users have a DMCA path back to the source.
   */
  imageSourceUrl: string | null;
  jackSides: JackSides;
  powerSide: Side | null;
  ports: Port[];
  createdAt: string;
  updatedAt: string;
}

export interface PlacedPedal {
  id: string;
  rigId: string;
  pedalId: string;
  xIn: number;
  yIn: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface ExternalEndpoint {
  id: string;
  rigId: string;
  kind: ExternalEndpointKind;
  label: string;
}

export interface Connection {
  id: string;
  rigId: string;
  fromNodeKind: NodeKind;
  fromNodeId: string;
  fromPortId: string | null;
  toNodeKind: NodeKind;
  toNodeId: string;
  toPortId: string | null;
}

export interface Rig {
  id: string;
  name: string;
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
  /**
   * Id of the BoardPreset the user picked, or null for custom-dimension rigs
   * (and rigs created before this field existed). When present, the canvas
   * draws the preset's bundled image; when null and style is 'rail', the
   * renderer falls back to the closest Pedaltrain image, scaled.
   */
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RigWithContents extends Rig {
  placedPedals: PlacedPedal[];
  connections: Connection[];
  externalEndpoints: ExternalEndpoint[];
}

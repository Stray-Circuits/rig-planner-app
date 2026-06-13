/**
 * Database migrations.
 *
 * Each entry is applied once, in order. Never modify a published migration —
 * add a new one.
 */
export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description:
      'initial schema: pedals, ports, rigs, placed_pedals, connections, external_endpoints',
    statements: [
      `CREATE TABLE pedals (
        id TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        name TEXT NOT NULL,
        width_in REAL NOT NULL,
        depth_in REAL NOT NULL,
        image_path TEXT,
        jack_top INTEGER NOT NULL DEFAULT 0,
        jack_bottom INTEGER NOT NULL DEFAULT 0,
        jack_left INTEGER NOT NULL DEFAULT 0,
        jack_right INTEGER NOT NULL DEFAULT 0,
        midi_top INTEGER NOT NULL DEFAULT 0,
        midi_bottom INTEGER NOT NULL DEFAULT 0,
        midi_left INTEGER NOT NULL DEFAULT 0,
        midi_right INTEGER NOT NULL DEFAULT 0,
        power_side TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE ports (
        id TEXT PRIMARY KEY,
        pedal_id TEXT NOT NULL,
        label TEXT NOT NULL,
        role TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        connector TEXT NOT NULL,
        side TEXT NOT NULL,
        side_order INTEGER NOT NULL DEFAULT 0,
        optional INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (pedal_id) REFERENCES pedals(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_ports_pedal ON ports(pedal_id)`,

      `CREATE TABLE rigs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width_in REAL NOT NULL,
        depth_in REAL NOT NULL,
        style TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,

      `CREATE TABLE placed_pedals (
        id TEXT PRIMARY KEY,
        rig_id TEXT NOT NULL,
        pedal_id TEXT NOT NULL,
        x_in REAL NOT NULL,
        y_in REAL NOT NULL,
        rotation INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (rig_id) REFERENCES rigs(id) ON DELETE CASCADE,
        FOREIGN KEY (pedal_id) REFERENCES pedals(id) ON DELETE RESTRICT
      )`,
      `CREATE INDEX idx_placed_rig ON placed_pedals(rig_id)`,

      `CREATE TABLE external_endpoints (
        id TEXT PRIMARY KEY,
        rig_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        FOREIGN KEY (rig_id) REFERENCES rigs(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_endpoints_rig ON external_endpoints(rig_id)`,

      `CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        rig_id TEXT NOT NULL,
        from_node_kind TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        from_port_id TEXT,
        to_node_kind TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        to_port_id TEXT,
        FOREIGN KEY (rig_id) REFERENCES rigs(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_connections_rig ON connections(rig_id)`,

      `CREATE TABLE app_state (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
    ],
  },
  {
    version: 2,
    description: 'pedals: track source URL for searched/fetched photos',
    statements: [`ALTER TABLE pedals ADD COLUMN image_source_url TEXT`],
  },
  {
    version: 3,
    description: 'rigs: track which BoardPreset the user picked',
    statements: [`ALTER TABLE rigs ADD COLUMN preset_id TEXT`],
  },
  {
    version: 4,
    description: 'rigs: per-rig patch-cable jack size',
    statements: [
      `ALTER TABLE rigs ADD COLUMN jack_size TEXT NOT NULL DEFAULT 'large'`,
    ],
  },
  {
    version: 5,
    description:
      'rigs: per-rig floor style (was a global preference until issue #114)',
    statements: [
      `ALTER TABLE rigs ADD COLUMN floor_style TEXT NOT NULL DEFAULT 'concrete_grey'`,
      `ALTER TABLE rigs ADD COLUMN custom_floor_color TEXT NOT NULL DEFAULT '#8a8a8a'`,
      `ALTER TABLE rigs ADD COLUMN custom_floor_grain REAL NOT NULL DEFAULT 0.4`,
    ],
  },
];

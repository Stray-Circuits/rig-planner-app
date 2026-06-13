ALTER TABLE rigs ADD COLUMN floor_style TEXT NOT NULL DEFAULT 'concrete_grey';
ALTER TABLE rigs ADD COLUMN custom_floor_color TEXT NOT NULL DEFAULT '#8a8a8a';
ALTER TABLE rigs ADD COLUMN custom_floor_grain REAL NOT NULL DEFAULT 0.4;

#![forbid(unsafe_code)]

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description:
                "initial schema: pedals, ports, rigs, placed_pedals, connections, external_endpoints",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "pedals: track source URL for searched/fetched photos",
            sql: include_str!("../migrations/0002_image_source_url.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "rigs: track which BoardPreset the user picked",
            sql: include_str!("../migrations/0003_rig_preset_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "rigs: per-rig patch-cable jack size",
            sql: include_str!("../migrations/0004_rig_jack_size.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rigplanner.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

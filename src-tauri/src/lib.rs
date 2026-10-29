use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionSettings {
    profiles: Vec<ConnectionProfile>,
    active_profile_id: Option<String>,
    #[serde(default)]
    dark_mode: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfile {
    id: String,
    name: String,
    client_url: String,
    site_url: String,
    #[serde(default)]
    accounts: Vec<String>,
}

fn connection_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not find the app config directory: {error}"))?;
    Ok(config_dir.join("connections.json"))
}

#[tauri::command]
fn load_connection_settings(app: AppHandle) -> Result<ConnectionSettings, String> {
    let path = connection_settings_path(&app)?;
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("Could not read saved Convex server settings: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(ConnectionSettings::default())
        }
        Err(error) => Err(format!(
            "Could not read saved Convex server settings: {error}"
        )),
    }
}

#[tauri::command]
fn save_connection_settings(app: AppHandle, settings: ConnectionSettings) -> Result<(), String> {
    let path = connection_settings_path(&app)?;
    let config_dir = path
        .parent()
        .ok_or_else(|| "Could not resolve the app config directory.".to_string())?;
    fs::create_dir_all(config_dir)
        .map_err(|error| format!("Could not create the app config directory: {error}"))?;
    let contents = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Could not encode Convex server settings: {error}"))?;
    fs::write(path, contents)
        .map_err(|error| format!("Could not save Convex server settings: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            load_connection_settings,
            save_connection_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

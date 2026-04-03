use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent};

struct LaunchProjectPath(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_project_path(state: tauri::State<'_, LaunchProjectPath>) -> Option<String> {
  state.0.lock().ok().and_then(|guard| guard.clone())
}

#[tauri::command]
fn read_project_file(path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&path).map_err(|error| format!("Failed to read project file '{path}': {error}"))
}

#[tauri::command]
fn write_project_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
  std::fs::write(&path, bytes)
    .map_err(|error| format!("Failed to write project file '{path}': {error}"))
}

fn is_supported_project_path(path: &str) -> bool {
  let lower = path.to_lowercase();
  lower.ends_with(".sbn") || lower.ends_with(".json")
}

fn update_launch_project_path(app: &AppHandle, path: String) -> tauri::Result<()> {
  if let Ok(mut guard) = app.state::<LaunchProjectPath>().0.lock() {
    *guard = Some(path.clone());
  }

  app.emit("spine:launch-project-path", path)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_project_path = std::env::args()
    .skip(1)
    .find(|arg| is_supported_project_path(arg));

  let app = tauri::Builder::default()
    .manage(LaunchProjectPath(Mutex::new(launch_project_path)))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let launch_path = app
        .state::<LaunchProjectPath>()
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

      if let Some(path) = launch_path {
        app.emit("spine:launch-project-path", path)?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_launch_project_path,
      read_project_file,
      write_project_file
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if let RunEvent::Opened { urls } = event {
      for url in urls {
        if let Ok(path) = url.to_file_path() {
          if let Some(path_str) = path.to_str() {
            if is_supported_project_path(path_str) {
              if let Err(error) = update_launch_project_path(app_handle, path_str.to_string()) {
                eprintln!("failed to emit opened project path: {error}");
              }
              break;
            }
          }
        }
      }
    }
  });
}

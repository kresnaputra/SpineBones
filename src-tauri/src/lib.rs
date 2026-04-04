use std::{
  io::{Read, Write},
  net::TcpListener,
  path::PathBuf,
  process::{Child, Command, Stdio},
  sync::{Arc, Mutex},
  thread,
  time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

struct LaunchProjectPath(Mutex<Option<String>>);
struct McpEditorState(Arc<Mutex<Option<String>>>);
struct McpBridgeActivity(Arc<Mutex<BridgeActivitySnapshot>>);
struct McpBridgePort(u16);
struct McpServerPort(u16);
struct McpProcessState {
  child: Mutex<Option<Child>>,
  last_error: Mutex<Option<String>>,
  server_path: Mutex<PathBuf>,
  server_source: Mutex<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeInfo {
  port: u16,
  url: String,
  external_client_active: bool,
  last_client_path: Option<String>,
  last_client_seen_seconds_ago: Option<u64>,
}

#[derive(Default)]
struct BridgeActivitySnapshot {
  last_client_path: Option<String>,
  last_client_seen_at_ms: Option<u128>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpServerStatus {
  running: bool,
  pid: Option<u32>,
  command: String,
  server_path: String,
  server_source: String,
  server_url: String,
  last_error: Option<String>,
}

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

#[tauri::command]
fn update_mcp_editor_state(
  state: tauri::State<'_, McpEditorState>,
  snapshot_json: String,
) -> Result<(), String> {
  let mut guard = state
    .0
    .lock()
    .map_err(|_| "Failed to lock MCP editor state".to_string())?;
  *guard = Some(snapshot_json);
  Ok(())
}

#[tauri::command]
fn get_mcp_bridge_info(
  port_state: tauri::State<'_, McpBridgePort>,
  activity_state: tauri::State<'_, McpBridgeActivity>,
) -> McpBridgeInfo {
  let snapshot = activity_state
    .0
    .lock()
    .ok()
    .map(|guard| BridgeActivitySnapshot {
      last_client_path: guard.last_client_path.clone(),
      last_client_seen_at_ms: guard.last_client_seen_at_ms,
    })
    .unwrap_or_default();
  let now_ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .unwrap_or(0);
  let last_seen_seconds_ago = snapshot
    .last_client_seen_at_ms
    .map(|timestamp| (now_ms.saturating_sub(timestamp) / 1000) as u64);

  McpBridgeInfo {
    port: port_state.0,
    url: format!("http://127.0.0.1:{}", port_state.0),
    external_client_active: last_seen_seconds_ago.is_some_and(|seconds| seconds <= 15),
    last_client_path: snapshot.last_client_path,
    last_client_seen_seconds_ago: last_seen_seconds_ago,
  }
}

#[tauri::command]
fn get_mcp_server_status(
  bridge_state: tauri::State<'_, McpBridgePort>,
  server_port_state: tauri::State<'_, McpServerPort>,
  process_state: tauri::State<'_, McpProcessState>,
) -> Result<McpServerStatus, String> {
  let mut child_guard = process_state
    .child
    .lock()
    .map_err(|_| "Failed to lock MCP process state".to_string())?;

  let mut running = false;
  let mut pid = None;

  if let Some(child) = child_guard.as_mut() {
    match child.try_wait() {
      Ok(Some(_)) => {
        *child_guard = None;
      }
      Ok(None) => {
        running = true;
        pid = Some(child.id());
      }
      Err(error) => {
        *process_state
          .last_error
          .lock()
          .map_err(|_| "Failed to lock MCP error state".to_string())? =
          Some(format!("Failed to poll MCP server: {error}"));
        *child_guard = None;
      }
    }
  }

  let last_error = process_state
    .last_error
    .lock()
    .map_err(|_| "Failed to lock MCP error state".to_string())?
    .clone();
  let server_script_path = process_state
    .server_path
    .lock()
    .map_err(|_| "Failed to lock MCP server path".to_string())?
    .clone();
  let script_source = process_state
    .server_source
    .lock()
    .map_err(|_| "Failed to lock MCP server source".to_string())?
    .clone();

  Ok(McpServerStatus {
    running,
    pid,
    command: build_mcp_launch_command(&server_script_path, bridge_state.0, server_port_state.0),
    server_path: server_script_path.to_string_lossy().to_string(),
    server_source: script_source,
    server_url: format!("http://127.0.0.1:{}/mcp", server_port_state.0),
    last_error,
  })
}

#[tauri::command]
fn start_mcp_server(
  bridge_state: tauri::State<'_, McpBridgePort>,
  server_port_state: tauri::State<'_, McpServerPort>,
  process_state: tauri::State<'_, McpProcessState>,
) -> Result<McpServerStatus, String> {
  {
    let server_script_path = process_state
      .server_path
      .lock()
      .map_err(|_| "Failed to lock MCP server path".to_string())?
      .clone();
    let mut child_guard = process_state
      .child
      .lock()
      .map_err(|_| "Failed to lock MCP process state".to_string())?;

    if let Some(child) = child_guard.as_mut() {
      match child.try_wait() {
        Ok(None) => {
          return Ok(McpServerStatus {
            running: true,
            pid: Some(child.id()),
            command: build_mcp_launch_command(
              &server_script_path,
              bridge_state.0,
              server_port_state.0,
            ),
            server_path: server_script_path.to_string_lossy().to_string(),
            server_source: process_state
              .server_source
              .lock()
              .map_err(|_| "Failed to lock MCP server source".to_string())?
              .clone(),
            server_url: format!("http://127.0.0.1:{}/mcp", server_port_state.0),
            last_error: None,
          });
        }
        Ok(Some(_)) => {
          *child_guard = None;
        }
        Err(error) => {
          *child_guard = None;
          *process_state
            .last_error
            .lock()
            .map_err(|_| "Failed to lock MCP error state".to_string())? =
            Some(format!("Failed to poll MCP server before start: {error}"));
        }
      }
    }
  }

  let server_script_path = process_state
    .server_path
    .lock()
    .map_err(|_| "Failed to lock MCP server path".to_string())?
    .clone();
  let launch_command =
    build_mcp_launch_command(&server_script_path, bridge_state.0, server_port_state.0);
  let mut command = if server_script_path
    .extension()
    .and_then(|value| value.to_str())
    .is_some_and(|ext| ext.eq_ignore_ascii_case("mjs"))
  {
    let mut shell_command = Command::new("/bin/zsh");
    shell_command.arg("-lc").arg(&launch_command);
    shell_command
  } else {
    let mut binary_command = Command::new(&server_script_path);
    binary_command.env(
      "SPINEBONES_MCP_URL",
      format!("http://127.0.0.1:{}", bridge_state.0),
    );
    binary_command.env("SPINEBONES_MCP_TRANSPORT", "http");
    binary_command.env("SPINEBONES_MCP_PORT", server_port_state.0.to_string());
    binary_command
  };

  command
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  match command.spawn() {
    Ok(child) => {
      let pid = child.id();
      *process_state
        .child
        .lock()
        .map_err(|_| "Failed to lock MCP process state".to_string())? = Some(child);
      *process_state
        .last_error
        .lock()
        .map_err(|_| "Failed to lock MCP error state".to_string())? = None;

      Ok(McpServerStatus {
        running: true,
        pid: Some(pid),
        command: launch_command,
        server_path: server_script_path.to_string_lossy().to_string(),
        server_source: process_state
          .server_source
          .lock()
          .map_err(|_| "Failed to lock MCP server source".to_string())?
          .clone(),
        server_url: format!("http://127.0.0.1:{}/mcp", server_port_state.0),
        last_error: None,
      })
    }
    Err(error) => {
      let message = format!("Failed to start MCP server process: {error}");
      *process_state
        .last_error
        .lock()
        .map_err(|_| "Failed to lock MCP error state".to_string())? = Some(message.clone());
      Err(message)
    }
  }
}

#[tauri::command]
fn stop_mcp_server(process_state: tauri::State<'_, McpProcessState>) -> Result<(), String> {
  let mut child_guard = process_state
    .child
    .lock()
    .map_err(|_| "Failed to lock MCP process state".to_string())?;

  if let Some(child) = child_guard.as_mut() {
    child
      .kill()
      .map_err(|error| format!("Failed to stop MCP server process: {error}"))?;
    let _ = child.wait();
  }

  *child_guard = None;
  Ok(())
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

fn extract_path(request_line: &str) -> &str {
  request_line
    .split_whitespace()
    .nth(1)
    .unwrap_or("/")
}

fn build_http_response(status: &str, body: &str) -> Vec<u8> {
  format!(
    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(),
    body
  )
  .into_bytes()
}

fn build_text_response(status: &str, body: &str) -> Vec<u8> {
  format!(
    "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    body.len(),
    body
  )
  .into_bytes()
}

fn build_mcp_launch_command(script_path: &PathBuf, bridge_port: u16, server_port: u16) -> String {
  let path = script_path.to_string_lossy();
  if path.ends_with(".mjs") {
    format!(
      "SPINEBONES_MCP_URL=http://127.0.0.1:{bridge_port} SPINEBONES_MCP_TRANSPORT=http SPINEBONES_MCP_PORT={server_port} bun \"{path}\""
    )
  } else {
    format!(
      "SPINEBONES_MCP_URL=http://127.0.0.1:{bridge_port} SPINEBONES_MCP_TRANSPORT=http SPINEBONES_MCP_PORT={server_port} \"{path}\""
    )
  }
}

fn pick_bridge_port() -> u16 {
  (48_570..48_590)
    .find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
    .unwrap_or(48_570)
}

fn pick_mcp_server_port() -> u16 {
  (48_600..48_620)
    .find(|port| TcpListener::bind(("127.0.0.1", *port)).is_ok())
    .unwrap_or(48_600)
}

fn start_mcp_bridge_server(
  app: AppHandle,
  editor_state: Arc<Mutex<Option<String>>>,
  bridge_activity: Arc<Mutex<BridgeActivitySnapshot>>,
  port: u16,
) {
  thread::spawn(move || {
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
      Ok(listener) => listener,
      Err(error) => {
        eprintln!("failed to start MCP bridge on port {port}: {error}");
        return;
      }
    };

    for incoming in listener.incoming() {
      let mut stream = match incoming {
        Ok(stream) => stream,
        Err(error) => {
          eprintln!("failed to accept MCP bridge connection: {error}");
          continue;
        }
      };

      let mut buffer = vec![0_u8; 1024 * 256];
      let bytes_read = match stream.read(&mut buffer) {
        Ok(bytes_read) => bytes_read,
        Err(error) => {
          eprintln!("failed to read MCP bridge request: {error}");
          continue;
        }
      };

      let request_text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
      let request_line = request_text.lines().next().unwrap_or_default();
      let path = extract_path(request_line);

      let response = if request_line.starts_with("OPTIONS ") {
        build_http_response("204 No Content", "")
      } else if request_line.starts_with("GET /health") {
        build_http_response(
          "200 OK",
          &serde_json::json!({
            "ok": true,
            "port": port,
          })
          .to_string(),
        )
      } else if request_line.starts_with("GET /state") {
        if let Ok(mut activity) = bridge_activity.lock() {
          activity.last_client_path = Some("/state".to_string());
          activity.last_client_seen_at_ms = Some(
            SystemTime::now()
              .duration_since(UNIX_EPOCH)
              .map(|duration| duration.as_millis())
              .unwrap_or(0),
          );
        }
        let snapshot = editor_state
          .lock()
          .ok()
          .and_then(|guard| guard.clone())
          .unwrap_or_else(|| serde_json::json!({ "ready": false }).to_string());
        build_http_response("200 OK", &snapshot)
      } else if request_line.starts_with("POST /command") {
        if let Ok(mut activity) = bridge_activity.lock() {
          activity.last_client_path = Some("/command".to_string());
          activity.last_client_seen_at_ms = Some(
            SystemTime::now()
              .duration_since(UNIX_EPOCH)
              .map(|duration| duration.as_millis())
              .unwrap_or(0),
          );
        }
        let body = request_text
          .split("\r\n\r\n")
          .nth(1)
          .unwrap_or_default()
          .to_string();

        match serde_json::from_str::<serde_json::Value>(&body) {
          Ok(command) => {
            let command_type = command
              .get("commandType")
              .and_then(|value| value.as_str())
              .unwrap_or("unknown")
              .to_string();
            if let Err(error) = app.emit("spine:mcp-command", command) {
              build_http_response(
                "500 Internal Server Error",
                &serde_json::json!({
                  "ok": false,
                  "error": format!("Failed to emit MCP command: {error}"),
                })
                .to_string(),
              )
            } else {
              build_http_response(
                "200 OK",
                &serde_json::json!({
                  "ok": true,
                  "accepted": true,
                  "commandType": command_type,
                })
                .to_string(),
              )
            }
          }
          Err(error) => build_http_response(
            "400 Bad Request",
            &serde_json::json!({
              "ok": false,
              "error": format!("Invalid MCP command body: {error}"),
            })
            .to_string(),
          ),
        }
      } else {
        build_text_response("404 Not Found", &format!("Unknown MCP bridge path: {path}"))
      };

      if let Err(error) = stream.write_all(&response) {
        eprintln!("failed to write MCP bridge response: {error}");
      }
    }
  });
}

fn resolve_mcp_server_path(app: &AppHandle, workspace_root: &PathBuf) -> (PathBuf, String) {
  if let Ok(resource_dir) = app.path().resource_dir() {
    let bundled_binary = resource_dir.join("dist-mcp").join("spinebones-mcp-server");
    if bundled_binary.exists() {
      return (bundled_binary, "bundled binary".to_string());
    }

    let bundled_script = resource_dir.join("scripts").join("spinebones-mcp-server.mjs");
    if bundled_script.exists() {
      return (bundled_script, "bundled script fallback".to_string());
    }
  }

  let dev_binary = workspace_root.join("dist-mcp").join("spinebones-mcp-server");
  if dev_binary.exists() {
    return (dev_binary, "development binary".to_string());
  }

  let dev_script = workspace_root.join("scripts").join("spinebones-mcp-server.mjs");
  if dev_script.exists() {
    return (dev_script, "development script fallback".to_string());
  }

  (workspace_root.join("dist-mcp").join("spinebones-mcp-server"), "unresolved".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_project_path = std::env::args()
    .skip(1)
    .find(|arg| is_supported_project_path(arg));
  let mcp_port = pick_bridge_port();
  let mcp_server_port = pick_mcp_server_port();
  let mcp_editor_state = Arc::new(Mutex::new(None::<String>));
  let mcp_bridge_activity = Arc::new(Mutex::new(BridgeActivitySnapshot::default()));
  let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from("."));
  let workspace_root_for_setup = workspace_root.clone();

  let app = tauri::Builder::default()
    .manage(LaunchProjectPath(Mutex::new(launch_project_path)))
    .manage(McpEditorState(mcp_editor_state.clone()))
    .manage(McpBridgeActivity(mcp_bridge_activity.clone()))
    .manage(McpBridgePort(mcp_port))
    .manage(McpServerPort(mcp_server_port))
    .manage(McpProcessState {
      child: Mutex::new(None),
      last_error: Mutex::new(None),
      server_path: Mutex::new(PathBuf::from("dist-mcp/spinebones-mcp-server")),
      server_source: Mutex::new("unresolved".to_string()),
    })
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let (server_path, server_source) = resolve_mcp_server_path(app.handle(), &workspace_root_for_setup);
      if let Ok(mut script_path) = app.state::<McpProcessState>().server_path.lock() {
        *script_path = server_path.clone();
      }
      if let Ok(mut source) = app.state::<McpProcessState>().server_source.lock() {
        *source = server_source;
      }
      if let Ok(mut last_error) = app.state::<McpProcessState>().last_error.lock() {
        *last_error = if server_path.exists() {
          None
        } else {
          Some(format!(
            "MCP server binary/script not found at {}",
            server_path.to_string_lossy()
          ))
        };
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

      start_mcp_bridge_server(
        app.handle().clone(),
        mcp_editor_state.clone(),
        mcp_bridge_activity.clone(),
        mcp_port,
      );
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_launch_project_path,
      read_project_file,
      write_project_file,
      update_mcp_editor_state,
      get_mcp_bridge_info,
      get_mcp_server_status,
      start_mcp_server,
      stop_mcp_server
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

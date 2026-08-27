use std::{path::Path, process::Command};

const MCP_SERVER_SOURCE: &str = "scripts/spinebones-mcp-server.mjs";
const MCP_SERVER_BUNDLE: &str = "scripts/spinebones-mcp-server.bundle.mjs";

fn main() {
  ensure_mcp_server_bundle();
  tauri_build::build()
}

/// The MCP server bundle is embedded into the binary (see `EMBEDDED_MCP_SERVER`
/// in `lib.rs`), so it has to exist before rustc compiles. Regenerate it with
/// bun whenever the source script is newer than the bundle.
fn ensure_mcp_server_bundle() {
  println!("cargo:rerun-if-changed=../{MCP_SERVER_SOURCE}");
  println!("cargo:rerun-if-changed=../{MCP_SERVER_BUNDLE}");

  let source = Path::new("..").join(MCP_SERVER_SOURCE);
  let bundle = Path::new("..").join(MCP_SERVER_BUNDLE);

  if bundle_is_fresh(&source, &bundle) {
    return;
  }

  let build = Command::new("bun")
    .args([
      "build",
      &format!("./{MCP_SERVER_SOURCE}"),
      "--target=node",
      "--format=esm",
      "--outfile",
      &format!("./{MCP_SERVER_BUNDLE}"),
    ])
    .current_dir("..")
    .status();

  match build {
    Ok(status) if status.success() => {}
    Ok(status) => {
      if !bundle.exists() {
        panic!("`bun build` failed with {status} and {MCP_SERVER_BUNDLE} is missing. Run `bun run build:mcp-server` first.");
      }
      println!("cargo:warning=`bun build` failed with {status}; using the existing {MCP_SERVER_BUNDLE}.");
    }
    Err(error) => {
      if !bundle.exists() {
        panic!("Could not run bun ({error}) and {MCP_SERVER_BUNDLE} is missing. Install bun or run `bun run build:mcp-server` first.");
      }
      println!("cargo:warning=Could not run bun ({error}); using the existing {MCP_SERVER_BUNDLE}.");
    }
  }
}

fn bundle_is_fresh(source: &Path, bundle: &Path) -> bool {
  let modified = |path: &Path| std::fs::metadata(path).and_then(|meta| meta.modified()).ok();
  match (modified(bundle), modified(source)) {
    (Some(bundle_time), Some(source_time)) => bundle_time >= source_time,
    (Some(_), None) => true,
    _ => false,
  }
}
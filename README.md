# SpineBones

SpineBones is a 2D skeletal animation editor for building rigs, attaching images through slots, animating them on a timeline, previewing a video-safe viewport, and exporting the result as `.sbn` projects, WebM video, PNG sequences, or sprite sheets.

This README is written as a practical user guide so someone new to the project can understand what the application already supports and how to use it effectively.

## Main Features

- Create and edit 2D bone rigs directly on the canvas
- Build parent-child hierarchies, re-parent bones, and organize them into groups
- Use `SETUP` and `ANIMATE` modes with a shared rig workflow
- Add slots to bones and assign multiple image attachments per slot
- Switch attachments per frame for sprite-style animation
- Edit attachment offset, rotation, scale, and opacity
- Animate attachment opacity with smooth fade interpolation and timeline easing
- Convert attachments into editable mesh attachments
- Deform mesh attachments on the canvas and animate mesh deformation per frame
- Preview a centered 16:9 video viewport in the editor
- Pan and zoom the camera while keeping the viewport preview aligned to export framing
- Use onion skin previews for previous and next moving poses
- Play animation in the timeline with audio import, offset, and volume controls
- Insert, clear, delete, move, copy first, and loop keyframes
- Use IK controls for supported chains
- Undo and redo edits across rigging, timeline, attachment, mesh, and project changes
- Save and load `.sbn` project packages with bundled assets
- Open legacy `.json` projects and resave them as `.sbn`
- Browse recent projects with thumbnail previews in the desktop app
- Export WebM video, PNG sequence ZIPs, and sprite sheet ZIPs
- Control the app from desktop menus and the MCP bridge

## Tech Stack

- React 19
- TypeScript
- Zustand
- Vite
- Tailwind CSS 4
- Tauri 2 for desktop builds

## Requirements

### Web

- Bun is recommended
- A modern browser with support for Canvas API, File API, and `MediaRecorder`

### Desktop

- Bun
- Rust toolchain
- The Tauri system dependencies required by your operating system

## Installation

Using Bun:

```bash
bun install
```

Using npm:

```bash
npm install
```

## Running the App

### Web Development

```bash
bun run dev
```

### Web Production Build

```bash
bun run build
```

### Preview the Web Build

```bash
bun run preview
```

### Desktop Development

```bash
bun run tauri:dev
```

### Desktop Build

```bash
bun run tauri:build
```

### Build macOS DMG

```bash
bun run tauri:build -- --bundles dmg
```

## Interface Overview

When the application starts and the project is empty, SpineBones automatically loads a demo skeleton so there is always something ready to explore.

### Top Toolbar

The top toolbar contains:

- Tool selection: `Pose`, `Bone`, `Move`, `Rotate`, `Scale`, `Mesh`
- `Undo` and `Redo`
- `Key` to insert keyframes for the selected bones
- `Clear` to remove all animation keyframes from the timeline
- `Loop` to mirror the existing animation range into a continuation
- `1st Key` to copy the first keyframe state to the current frame
- save/load/export actions
- background image controls
- `SETUP` and `ANIMATE` mode buttons

### Left Sidebar

The left side contains:

- `Bones`
- `Slots`
- `Skins`

This side is used to:

- select bones
- reorder bones
- manage slots and attachments
- switch the active skin

### Center Canvas

The canvas is the main workspace for:

- creating and selecting bones
- moving, rotating, and scaling rigs
- dragging attachments
- editing mesh vertices directly on the artwork
- previewing the 16:9 export viewport
- viewing the background reference image
- panning and zooming the camera

### Right Sidebar

The right side shows:

- active attachment properties for the current slot
- properties of the selected bone

If no bone is selected, the panel shows a helper message.

### Bottom Timeline

The timeline is used for:

- frame scrubbing and playback
- previous and next keyframe navigation
- editing FPS and duration
- inserting, deleting, moving, copying, clearing, and looping keyframes
- editing easing
- importing preview audio and adjusting audio offset/volume
- driving bone transforms, attachment fades, and mesh deformation

### Status Bar

The bottom status bar shows:

- the application name
- the currently opened project filename
- an `Open File` button in desktop mode
- important usage hints such as delete, keyframe, play/pause, setup/animate, and tool shortcuts

## Complete Usage Guide

## 1. Creating Bones

To create a bone:

1. Select the `Bone` tool.
2. Click on the canvas.
3. If you click on top of an existing bone while creating a new one, the new bone will use that bone as its parent.

New bone defaults:

- default name: `bone_{index}`
- default length: `50`
- default `scaleX` and `scaleY`: `1`
- the new bone uses the currently active skin

Notes:

- bones can be selected from the canvas or from the `Bones` panel
- bone order in the `Bones` panel can be changed with drag and drop
- deleting a parent bone also removes child bones that depend on it

## 2. Selecting and Manipulating Bones

### Pose Tool

Use `Pose` for general selection and manipulation.

On the canvas:

- click a bone to select it
- click empty space to clear selection
- drag the selected bone to move it

### Move Tool

Use `Move` to explicitly reposition a bone.

Behavior:

- click a bone to select it
- drag to change its position
- if the bone has a parent, its local position is recalculated relative to that parent

### Rotate Tool

Use `Rotate` to rotate a bone around its pivot.

Behavior:

- click a bone
- drag around the bone pivot
- the rotation is updated from the pointer angle relative to the bone position

### Scale Tool

Use `Scale` to change `scaleX` and `scaleY` together.

Behavior:

- click a bone
- drag farther away or closer to the pivot
- the scale factor is computed from the pointer distance ratio

## 3. Editing Bones from the Properties Panel

When a bone is selected, the `Properties` panel exposes:

- `Name`
- `X`
- `Y`
- `Length`
- `Rotation`
- `Scale X`
- `Scale Y`
- `Parent`

Important behavior:

- when the current mode is `ANIMATE`, changing numeric values such as position, rotation, or scale automatically writes a keyframe for the selected bone
- changing `Parent` preserves the world transform of the bone so it does not unexpectedly jump during reparenting

## 4. Managing Slots and Attachments

### Adding a Slot

1. Select a bone.
2. In the `Slots` panel, click the `+` button.
3. A new slot is created using a default name based on the selected bone.

### Uploading an Image to a Slot

1. Click the upload button on a slot.
2. Choose an image file.
3. The app creates an image attachment for that slot.
4. The uploaded attachment becomes the active attachment automatically.

Supported image types:

- PNG
- JPG / JPEG
- WEBP
- GIF
- SVG

When an image is loaded:

- the original image size is read
- the app automatically applies an initial scale so the image fits the scene more reasonably

### Switching the Active Attachment

If a slot has more than one attachment, all attachments are shown in a list under that slot. Click an attachment name to make it the active one.

### Deleting a Slot

Click the trash icon on the slot row to remove that slot.

## 5. Editing Attachments from the Right Panel

If the active slot has an image attachment, the right panel shows attachment properties such as:

- position offset
- rotation
- scale

This panel is used to align the image with the bone, for example:

- moving the image upward so it sits above the bone
- rotating the image to match the bone direction
- resizing the image without changing the underlying bone data

## 6. Managing Skins

The `Skins` panel shows all available skins.

Available actions:

- click a skin to make it the active skin
- every newly created bone uses the active skin
- the skin color is used as the base color for bone indicators on the canvas

## 7. Background Reference

The toolbar provides:

- `Background`
- `Remove BG`

Purpose:

- upload a reference image for tracing or pose matching
- remove the reference image when it is no longer needed

Background behavior:

- it is rendered semi-transparently
- it stays visible in the canvas as a visual guide
- it can appear in exported video output

## 8. Bone Indicators

Bone indicators are the visual circles and labels shown on top of bones in the canvas.

Behavior:

- they can be shown or hidden
- even when hidden, bones can still be hit-tested and edited
- the toggle only hides the visual indicators, not the actual bone system

### Desktop View Menu

In the desktop app, this toggle is available under:

- `View > Toggle Bone Indicators`

Desktop shortcut:

- `Cmd/Ctrl + B`

## 9. Animation Playback and Onion Skin

The timeline is where you preview and refine motion.

Available tools include:

- `Play`, `Pause`, and `Stop`
- `Previous Key` and `Next Key`
- frame scrubbing
- FPS and duration editing
- onion skin preview for nearby motion comparison

Onion skin behavior:

- click the `Onion` button in the toolbar or press `O` while in `ANIMATE` mode
- the previous moving pose is outlined in cyan
- the next moving pose is outlined in magenta
- only bones and sprite attachments that actually change are shown as ghost overlays
- ghost sprite outlines are drawn on top of the canvas so they stay visible while posing

This is useful for:

- checking arcs and spacing
- comparing silhouettes between nearby poses
- spotting unwanted pops between keyframes

## 10. Timeline Keyframes

In the timeline you can:

- click a keyframe to select it
- Shift+click to multi-select keyframes
- drag selected keyframes together
- double-click or delete a hovered keyframe
- delete all selected frame keys at once

Useful animation actions:

- `Key` inserts keyframes for the current selection
- `Clear` removes keyframes for the current selection
- `Loop` creates a reversed continuation for cycle work
- `1st Key` copies the first keyframe to the current frame

## 11. Audio, Playback, and Timing

You can also use the timeline for timing reference:

- import an audio file
- adjust audio start offset
- change audio volume
- scrub while previewing the relationship between motion and sound

Timing notes:

- `FPS` changes playback speed
- `Duration` changes the visible timeline range
- `Space` toggles play and pause quickly

## 9. SETUP and ANIMATE Modes

### SETUP

Use this mode to prepare the base rig:

- set the default pose
- organize parent relationships
- align attachments

When entering `SETUP`:

- the app restores the stored setup pose

### ANIMATE

Use this mode to create frame-based animation with keyframes.

When switching to `ANIMATE`:

- the app compares the current pose against the previous setup pose
- if there are deltas in position, rotation, or scale, existing keyframes are shifted so the animation remains aligned with the updated setup pose
- the new setup pose is then saved

This allows you to refine the setup rig without immediately breaking existing animation.

## 10. Timeline and Animation

### Selecting Frames

You can select a frame by:

- clicking the timeline
- dragging across the timeline to scrub
- using `Arrow Left` and `Arrow Right`

When the current mode is `ANIMATE`, changing the frame applies keyframes to the skeleton.

### Playback

Timeline controls:

- `Play/Pause`
- `Stop`
- `Prev Key`
- `Next Key`

Playback behavior:

- playback uses the currently configured `fps`
- the timeline automatically loops back to frame `0` after the last global keyframe is reached

### Editing FPS and Duration

Timeline fields:

- `FPS` can be set from `1` to `120`
- `Duration` can be set from `10` to `300`

### Keyframe Actions

Available actions:

- `K` or the `Key` button inserts a keyframe on the current frame
- `Clear` removes all keyframes from the selected bone
- `Loop` mirrors existing keyframes to help create a looping animation
- `1st Key` copies the first keyframe of the selected bone to the current frame
- double click a keyframe to delete it
- hover a keyframe and press `X` or `Delete` to delete it
- right click a keyframe to delete it

Animated properties:

- `x`
- `y`
- `rotation`
- `scaleX`
- `scaleY`

Interpolation:

- linear interpolation

## 11. Save, Load, and Project Files

### Saving a Project

Saving writes a project JSON file containing:

- bones
- skins
- active skin
- setup pose
- slots
- attachments
- keyframes
- duration
- fps
- background image

Default suggested filename:

- `spinebones-project.json`

### Loading a Project

Loading reads a JSON project file previously saved from this application.

When a project is loaded:

- editor state is replaced by the file contents
- the current frame resets to `0`
- playback is stopped
- selection is cleared
- the setup pose is validated
- bones are restored to the setup pose so the initial display is correct

### Desktop File Menu

In the desktop app, the File menu includes:

- `File > New Project`
- `File > Save`
- `File > Save As…`
- `File > Open…`
- `File > Export Spine`
- `File > Export Video`

## 12. Export

### Export Spine

Export Spine creates a ZIP file containing:

- `skeleton.json`
- `atlas.atlas`
- one PNG file for each attachment

This is intended as a lightweight Spine-like export for simple downstream workflows.

### Export Video

Video export produces:

- `*.webm`
- `*-audio.wav` when timeline audio tracks are present

Video export behavior:

- renders the animation frame by frame
- uses `MediaRecorder`
- can include the current background image if one is active
- exports video-only WebM and a separate mixed WAV for all imported timeline audio tracks

## Full Shortcut Reference

### Tools and Modes

- `Q`: Pose
- `B`: Bone
- `M`: Move
- `R`: Rotate
- `S`: Scale
- `Cmd/Ctrl+N`: New project
- `W`: switch to `SETUP`
- `E`: switch to `ANIMATE`

### Editing

- `K`: insert keyframe
- `Delete` / `Backspace`: delete the selected bone
- `Esc`: clear selection

### Timeline

- `Space`: play/pause
- `Arrow Left`: previous frame
- `Arrow Right`: next frame
- double click keyframe: delete keyframe
- `X` or `Delete` while hovering a keyframe: delete keyframe

### Undo / Redo / File

- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z`: redo
- `Cmd/Ctrl + Y`: redo
- `Cmd/Ctrl + S`: save
- `Cmd/Ctrl + Shift + S`: save as
- `Cmd/Ctrl + O`: open

### Canvas Navigation

- right mouse button drag: pan
- mouse wheel: zoom

### Desktop View Menu

- `Cmd/Ctrl + B`: toggle bone indicators

## Usage Tips

- Start in `SETUP` mode to build the rig structure
- Once the base pose is correct, switch to `ANIMATE`
- Use the `Properties` panel when you need precise numeric values
- Choose the active skin before creating new bones if you want different bone colors
- Use the background image as a tracing or pose reference
- If an animation feels difficult to control, insert more keyframes on important poses

## Important Notes

- App state is stored in memory during the session
- Projects must be saved manually if you want to reuse them later
- A demo skeleton is loaded automatically when the state is empty
- Deleting a parent bone also removes dependent child bones
- Hiding bone indicators does not disable bone editing

## Available Scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "lint": "eslint .",
  "preview": "bun run build && wrangler dev",
  "deploy": "bun run build && wrangler deploy"
}
```

# SpineWeb

SpineWeb is a web-based 2D skeleton editor for creating simple rigs, attaching images, animating bones with keyframes, and exporting the result as project JSON, a Spine-like package, or video.

## Main Features

- Create and arrange bone hierarchies directly on the canvas
- Edit bone position, rotation, scale, parent, and length
- Add slots and upload image attachments per bone
- Manage active skins
- Animate bones with keyframes on a timeline
- Undo and redo changes
- Save and load projects in JSON format
- Export to a Spine-like package (`.zip` containing `skeleton.json`, `atlas.atlas`, and attachment images)
- Export animation as `WebM` video
- Add a background image as animation reference

## Tech Stack

- React 19
- TypeScript
- Vite
- Zustand
- Tailwind CSS 4

## Requirements

- Bun or a modern Node.js version
- A modern browser with support for Canvas API, File API, and `MediaRecorder`

## Installation

Using Bun is recommended because this repository already includes `bun.lock`.

```bash
bun install
```

If you prefer npm:

```bash
npm install
```

## Running the App

Development mode:

```bash
bun run dev
```

or:

```bash
npm run dev
```

Production build:

```bash
bun run build
```

Preview the production build:

```bash
bun run preview
```

Lint:

```bash
bun run lint
```

## Interface Overview

When the app starts, it automatically loads a demo skeleton if the project is still empty.

- Top toolbar: tool selection, undo/redo, keyframe actions, skin actions, save/load, export, and editor mode
- Left panel: bone list, slots per bone, and skin list
- Center canvas: main workspace for creating bones, posing, and previewing attachments
- Right panel: selected bone and active attachment properties
- Bottom timeline: animation playback, frame control, fps, duration, and bone keyframes
- Status bar: quick shortcut reference

## How To Use

### 1. Create Bones

1. Run the application.
2. Select the `Bone` tool or press `B`.
3. Click on the canvas to create a new bone.
4. Click an existing bone while creating a new one if you want to assign it as the parent.

Notes:

- A new bone uses the currently active skin.
- Bones can be selected from the canvas or from the `Bones` panel.
- Bone order in the left panel can be changed with drag and drop.

### 2. Edit Bones

Select a bone, then use:

- `Pose` tool (`Q`) for general selection and manipulation
- `Move` tool (`M`) to move the bone
- `Rotate` tool (`R`) to rotate the bone
- `Scale` tool (`S`) to scale the bone
- `Properties` panel to edit name, position, length, rotation, scale, and parent precisely

### 3. Add Slots and Attachments

1. Select the bone you want to attach an image to.
2. In the `Slots` panel, click the `+` button.
3. Enter a slot name.
4. Click the upload icon on the slot.
5. Choose an image file from your computer.

Once an attachment is active, the right panel will show controls for:

- `Offset X`
- `Offset Y`
- `Rotation`
- `Scale X`
- `Scale Y`

These settings help adjust the image pivot and visual placement relative to the bone.

### 4. Manage Skins

- The skin list is available in the `Skins` panel
- Click a skin to make it active
- Use the `Add Skin` button in the toolbar to create a new skin

### 5. Create Animation

1. Click the `ANIMATE` mode button on the right side of the toolbar.
2. Select the bone you want to animate.
3. Move the current frame in the timeline.
4. Change the bone position, rotation, or scale.
5. Press `K` or click the `Key` button to insert a keyframe.

Timeline features:

- `Play/Pause` for animation preview
- `Stop` to return to frame 0
- `Prev/Next Key` to jump between keyframes on the selected bone
- `Clear` to remove all keyframes from the selected bone
- `Loop` to copy the first keyframe to the current frame for smoother looping
- Editable `FPS` and `Duration` values directly from the timeline

Keyframes are interpolated linearly for:

- `x`
- `y`
- `rotation`
- `scaleX`
- `scaleY`

### 6. Add a Reference Background

- Click `Background` in the toolbar to upload a reference image
- Click `Remove BG` to remove the background

The background is used as a visual reference inside the editor and can also appear in video exports.

## Keyboard Shortcuts

- `Q`: Pose tool
- `B`: Bone tool
- `M`: Move tool
- `R`: Rotate tool
- `S`: Scale tool
- `K`: Insert keyframe
- `Space`: Play/Pause animation
- `Delete` / `Backspace`: Delete selected bone
- `Esc`: Clear bone selection
- `Arrow Left` / `Arrow Right`: Move frame backward or forward
- `Ctrl/Cmd + Z`: Undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: Redo
- Right mouse drag on canvas: Pan camera
- Mouse wheel: Zoom camera
- Double click a keyframe in the timeline: Delete keyframe
- `X` or `Delete` while hovering a keyframe: Delete keyframe

## Save, Load, and Export

### Save Project

The `Save` button downloads a `spine-project.json` file containing:

- bones
- skins
- slots
- attachments
- keyframes
- duration
- fps

### Load Project

The `Load` button accepts a `.json` project file previously saved from this application.

### Export Spine

The `Export Spine` button generates a `spine-export.zip` file containing:

- `skeleton.json`
- `atlas.atlas`
- one PNG file for each attachment

This export is intended as a lightweight Spine-like output for workflows such as PixiJS Spine integration.

### Export Video

The `Export Video` button generates a `spine-animation.webm` file.

Notes:

- Video export uses `MediaRecorder`
- Final output quality depends on browser support
- If a browser does not support a preferred codec, the exporter will try available fallback formats

## Usage Notes

- App data is currently stored in local in-memory state during the session
- Projects must be saved manually if you want to reuse them later
- The app automatically loads a demo skeleton when the state is empty
- Deleting a parent bone also removes its child bones

## Available Scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

## Possible Future Improvements

Some areas that can be extended further:

- batch asset import
- draw order management in the UI
- timeline easing support
- more complete Spine import/export support
- project autosave
- multi-animation management


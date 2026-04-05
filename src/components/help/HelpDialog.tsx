import { useEffect } from "react";
import {
  X,
  BookOpen,
  MousePointer2,
  Move3D,
  Diamond,
  Bone,
  Move,
  RotateCw,
  Maximize2,
  ArrowLeftRight,
  ArrowUpDown,
  Play,
  Pause,
  Square,
  ChevronLeft,
  ChevronRight,
  Music2,
  Image,
  XCircle,
  Save,
  FolderOpen,
  FilePlus2,
  Video,
  Grid2x2,
  Bot,
  Link2,
  FolderTree,
  Keyboard,
  Eye,
} from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";

type HelpSection = {
  title: string;
  icon: React.ComponentType<{ size?: number }>;
  items: React.ReactNode[];
};

const InlineIcon = ({
  icon: Icon,
}: {
  icon: React.ComponentType<{ size?: number }>;
}) => (
  <span className="mx-1 inline-flex rounded border border-border bg-panel px-1.5 py-1 align-middle text-accent2">
    <Icon size={13} />
  </span>
);

const sections: HelpSection[] = [
  {
    title: "Quick Start",
    icon: BookOpen,
    items: [
      <>
        Create a new project from File &gt; New Project{" "}
        <InlineIcon icon={FilePlus2} />, then start placing bones with the Bone
        tool <InlineIcon icon={Bone} />.
      </>,
      "Build the default rig in Setup mode first, because Setup becomes the base pose for your animation workflow.",
      "When the rig feels correct, switch to Animate mode to start adding keyframes on the timeline.",
      "Save the project as a .sbn file so bones, slots, groups, IK, keyframes, audio, images, and background settings stay preserved in one package.",
    ],
  },
  {
    title: "Projects and Files",
    icon: BookOpen,
    items: [
      <>
        Use File &gt; New Project <InlineIcon icon={FilePlus2} /> to reset the
        editor into a clean untitled project.
      </>,
      <>
        Use Save or Save As <InlineIcon icon={Save} /> to write the current
        project to disk as a SpineBones .sbn package. Legacy .json projects can still be opened and will be converted to .sbn when saved.
      </>,
      "Each .sbn package now stores a manifest, project data, a generated thumbnail preview, and bundled assets for images/audio.",
      "Use Project Browser on desktop to reopen recent .sbn packages with thumbnail previews.",
      <>
        Use Open <InlineIcon icon={FolderOpen} /> to load an existing project.
      </>,
      <>
        Use Export Video <InlineIcon icon={Video} /> to render the animation as
        a WebM video.
      </>,
      <>
        Use Export Sprite Sheet <InlineIcon icon={Grid2x2} /> to generate a
        sprite sheet archive for game workflows.
      </>,
      "Use Export PNG Sequence to generate one PNG per frame inside a ZIP archive.",
    ],
  },
  {
    title: "Canvas Navigation",
    icon: MousePointer2,
    items: [
      "Drag an empty area to pan when no bones are selected.",
      "Right-click drag can also be used to pan the canvas.",
      "Use scroll or a touchpad gesture to zoom the canvas.",
      "Click a bone to select it, then Shift+click to multi-select bones.",
      "Arrow Left and Arrow Right move the current frame by one step on the timeline.",
    ],
  },
  {
    title: "Tools and Bone Editing",
    icon: MousePointer2,
    items: [
      <>
        Pose <InlineIcon icon={MousePointer2} /> lets you pick and pose bones
        directly on the canvas.
      </>,
      <>
        Bone <InlineIcon icon={Bone} /> creates new bones by clicking in the
        canvas.
      </>,
      <>
        Move <InlineIcon icon={Move} />, Rotate <InlineIcon icon={RotateCw} />,
        and Scale <InlineIcon icon={Maximize2} /> edit the selected bones using
        the corresponding transform mode.
      </>,
      <>
        Mirror H <InlineIcon icon={ArrowLeftRight} /> and Mirror V{" "}
        <InlineIcon icon={ArrowUpDown} /> flip the selected bones horizontally
        or vertically.
      </>,
      "Delete or Backspace removes the selected bones.",
    ],
  },
  {
    title: "Bone Properties",
    icon: Diamond,
    items: [
      "Use the Properties panel to edit name, position, length, rotation, scale, and parent.",
      "Changing numeric values in Animate mode also records the updated transform into the current keyframe.",
      "The Parent dropdown can be used for manual re-parenting while preserving world placement.",
      "Attachment settings appear above the bone properties when relevant.",
    ],
  },
  {
    title: "Rig and Relationships",
    icon: Move3D,
    items: [
      <>
        Select a child bone, then right-click a target bone{" "}
        <InlineIcon icon={Link2} /> to assign it as the new parent.
      </>,
      "Parent-child relationship lines are drawn on the canvas so you can see how bones connect.",
      "Moving a parent affects its children, and in Animate mode the affected descendants can also receive keyframes.",
      "Use the status bar hints as a quick reminder for parenting and navigation actions.",
    ],
  },
  {
    title: "Inverse Kinematics",
    icon: Move3D,
    items: [
      <>
        Enable IK <InlineIcon icon={Link2} /> from the Properties panel or press
        C when a valid chain is selected.
      </>,
      "IK supports dynamic single-child chains, including simple 2-bone chains and longer n-bone chains.",
      "Dragging the end bone of an active IK chain makes parent bones solve toward the new target.",
      "IK is useful for feet, hands, and other chain-based posing where moving the endpoint is faster than rotating each joint manually.",
    ],
  },
  {
    title: "Bone Groups",
    icon: BookOpen,
    items: [
      <>
        Create manual groups in the Bones panel with the + Group button{" "}
        <InlineIcon icon={FolderTree} />.
      </>,
      "Drag one or more selected bones into a group, or back into Ungrouped.",
      "Double-click a group name to rename it.",
      "Collapsed groups automatically reveal themselves when one of their bones is selected.",
    ],
  },
  {
    title: "Animation and Timeline",
    icon: Diamond,
    items: [
      <>
        Use Key <InlineIcon icon={Diamond} /> to create keyframes for the
        currently selected bones.
      </>,
      <>
        Use Clear <InlineIcon icon={X} /> to remove keyframes for the currently
        selected bones.
      </>,
      <>
        Use Loop <InlineIcon icon={Diamond} /> to mirror existing animation into
        a reversed continuation for seamless cycles.
      </>,
      <>
        Use 1st Key <InlineIcon icon={Diamond} /> to copy the first keyframe of
        the selected bone to the current frame.
      </>,
      <>
        Use Onion <InlineIcon icon={Eye} /> in Animate mode to preview the
        nearest previous and next moving poses directly on the canvas.
      </>,
      "Frame Keys selects every keyframe on the active frame, then Delete or Backspace removes them all at once.",
      "Click a keyframe to select it, then Shift+click to build a multi-selection.",
      "Drag selected keyframes to move them together to a new frame.",
      "Double-click or delete a hovered keyframe to remove it quickly.",
    ],
  },
  {
    title: "Playback, Audio, and Timing",
    icon: Diamond,
    items: [
      <>
        Use Play <InlineIcon icon={Play} />, Pause <InlineIcon icon={Pause} />,
        Stop <InlineIcon icon={Square} />, Previous Key{" "}
        <InlineIcon icon={ChevronLeft} />, and Next Key{" "}
        <InlineIcon icon={ChevronRight} /> in the timeline toolbar to preview
        animation.
      </>,
      <>
        Import audio into the timeline <InlineIcon icon={Music2} /> for sync
        reference, then adjust its start frame and volume.
      </>,
      "Onion skin only shows the parts of the rig that actually move, so nearby comparisons stay readable instead of drawing the full character every time.",
      "FPS controls the playback speed, while Duration controls the timeline length.",
      "Space toggles play and pause for fast previewing.",
    ],
  },
  {
    title: "Backgrounds and Attachments",
    icon: MousePointer2,
    items: [
      <>
        Use Background <InlineIcon icon={Image} /> to load an image behind the
        rig for tracing or reference.
      </>,
      <>
        Use Remove BG <InlineIcon icon={XCircle} /> to clear the current
        background image.
      </>,
      "Slots and attachments let you connect artwork to bones.",
      "Press D to toggle canvas dragging for attachments when an attachment is active on the selected bone.",
    ],
  },
  {
    title: "AI / MCP — Setup",
    icon: Bot,
    items: [
      <>
        Open the <span className="text-text">MCP Server</span> panel on the
        right sidebar. It shows the bridge URL and the current server status.
      </>,
      <>
        Click <span className="text-text">Start MCP</span> to launch the
        local MCP server. The status indicator turns green when it is running.
        Click <span className="text-text">Stop MCP</span> to shut it down.
      </>,
      <>
        Click <span className="text-text">Check Bridge</span> to verify that
        the internal bridge is reachable, then click{" "}
        <span className="text-text">Copy URL</span> to copy the MCP server
        URL to the clipboard.
      </>,
      <>
        Click <span className="text-text">MCP Config</span> to see the
        connection settings. Use those details when adding SpineBones as an MCP
        server in your AI client — transport is{" "}
        <code className="rounded bg-panel px-1 text-accent2">
          Streamable HTTP
        </code>
        , authentication is none.
      </>,
      "The MCP server starts automatically on a free port each time SpineBones launches, so the port number may change between sessions — always copy the URL from the panel.",
    ],
  },
  {
    title: "AI / MCP — Connecting Claude Code",
    icon: Bot,
    items: [
      <>
        In your terminal, run{" "}
        <code className="rounded bg-panel px-1 text-accent2">
          claude mcp add spinebones --transport http --url &lt;paste URL&gt;
        </code>{" "}
        using the URL copied from the MCP Config panel.
      </>,
      "Once registered, Claude Code can read and drive the live editor — bones, keyframes, skins, slots, attachments, IK, timeline, and playback are all accessible as MCP tools.",
      <>
        Verify the connection by asking Claude:{" "}
        <em className="text-text">"List all bones in the current SpineBones project."</em>{" "}
        It will call{" "}
        <code className="rounded bg-panel px-1 text-accent2">
          spinebones_list_bones
        </code>{" "}
        and return the live bone data.
      </>,
      "Any other MCP-compatible client (Cursor, Continue, Windsurf, etc.) can connect the same way using the Streamable HTTP URL.",
    ],
  },
  {
    title: "AI / MCP — What You Can Do",
    icon: Bot,
    items: [
      <>
        <span className="text-text">Read state —</span> list bones,
        keyframes, skins, slots, attachments, IK roots, bone groups, camera, and
        timeline summary at any time.
      </>,
      <>
        <span className="text-text">Edit bones —</span> add, rename, delete,
        reorder, reparent, mirror, and set transforms, all from a prompt.
      </>,
      <>
        <span className="text-text">Keyframe animation —</span> set or
        overwrite individual keyframes, batch multiple keyframes in one call,
        duplicate or remove keyframes, and clear a frame range.
      </>,
      <>
        <span className="text-text">Timeline control —</span> change FPS,
        duration, current frame, playback range, and trigger play or stop.
      </>,
      <>
        <span className="text-text">Slots and attachments —</span> add
        slots, create image attachments from local paths, update attachment
        transforms, and set the active attachment per slot.
      </>,
      <>
        <span className="text-text">Skins, groups, and IK —</span> create
        and switch skins, manage bone groups, and toggle IK chains or set IK
        targets.
      </>,
    ],
  },
  {
    title: "AI / MCP — Example Prompts",
    icon: Bot,
    items: [
      <><em className="text-text">"Create a breathing animation for the body and breast bones over 120 frames at 50 fps using easeInOut keyframes."</em></>,
      <><em className="text-text">"List all bones, then add keyframe at frame 0 and frame 30 for each bone using their current transforms."</em></>,
      <><em className="text-text">"Set the timeline to 60 frames and 24 fps, then play the animation."</em></>,
      <><em className="text-text">"Mirror all selected bones horizontally and save the new setup pose."</em></>,
      <><em className="text-text">"Add a slot to the body bone, create an attachment from ~/Downloads/body.png, and set it as active."</em></>,
      "Be specific with bone names or IDs when prompting — the AI will use the exact names returned by the list tools to avoid ambiguity.",
    ],
  },
  {
    title: "Keyboard Shortcuts",
    icon: Diamond,
    items: [
      "Q, B, M, R, and S switch tools for Pose, Bone, Move, Rotate, and Scale.",
      "W switches to Setup mode and E switches to Animate mode.",
      "O toggles onion skin preview while you are in Animate mode.",
      "K inserts keyframes for the current bone selection.",
      "F copies the first keyframe of the selected bone to the current frame. With nothing selected, it copies the first keyframe of every bone at once.",
      "C toggles IK for the selected valid chain.",
      "Delete or Backspace deletes selected bones or selected timeline keyframes.",
      "Cmd/Ctrl+N creates a new project, Cmd/Ctrl+O opens a project, and Cmd/Ctrl+S saves.",
      "Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo.",
    ],
  },
];

const getSectionId = (title: string) =>
  `help-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const iconLegend = [
  { label: "New Project", icon: FilePlus2 },
  { label: "Open", icon: FolderOpen },
  { label: "Save", icon: Save },
  { label: "Export Video", icon: Video },
  { label: "Sprite Sheet", icon: Grid2x2 },
  { label: "Pose", icon: MousePointer2 },
  { label: "Bone", icon: Bone },
  { label: "Move", icon: Move },
  { label: "Rotate", icon: RotateCw },
  { label: "Scale", icon: Maximize2 },
  { label: "Mirror H", icon: ArrowLeftRight },
  { label: "Mirror V", icon: ArrowUpDown },
  { label: "Key / Loop", icon: Diamond },
  { label: "Play / Pause", icon: Play },
  { label: "Stop", icon: Square },
  { label: "Prev Key", icon: ChevronLeft },
  { label: "Next Key", icon: ChevronRight },
  { label: "Audio", icon: Music2 },
  { label: "Background", icon: Image },
  { label: "Remove BG", icon: XCircle },
  { label: "MCP Server", icon: Bot },
  { label: "Parent / IK", icon: Link2 },
  { label: "Groups", icon: FolderTree },
  { label: "Shortcuts", icon: Keyboard },
];

export const HelpDialog = () => {
  const { showHelpDialog, setShowHelpDialog } = useEditorStore();

  useEffect(() => {
    if (!showHelpDialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowHelpDialog(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelpDialog, setShowHelpDialog]);

  if (!showHelpDialog) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6 py-8">
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl"
        style={{ fontFamily: "var(--font-family-sans)" }}
      >
        <div className="panel-padding-left panel-padding-right panel-padding-top panel-padding-bottom flex items-start justify-between border-b border-border bg-panel2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-accent2">
              Help
            </div>
            <h2 className="mt-2 text-2xl font-semibold leading-tight text-text">
              How to Use SpineBones
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-8 text-text-dim">
              A complete guide to the editor tools, rigging workflow, IK,
              grouping, timeline editing, audio preview, export, and shortcuts.
            </p>
          </div>

          <button
            onClick={() => setShowHelpDialog(false)}
            className="rounded-lg border border-border bg-panel px-3 py-2 text-text-dim transition-all hover:border-accent hover:text-text"
            title="Close help"
          >
            <X size={16} />
          </button>
        </div>

        <div className="panel-padding-left panel-padding-right panel-padding-top panel-padding-bottom max-h-[70vh] overflow-y-auto bg-panel">
          <section className="panel-padding-left panel-padding-right panel-padding-top-lg panel-padding-bottom-lg rounded-xl border border-border bg-panel2/70">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-accent2">
              Table of Contents
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {sections.map((section) => {
                const sectionId = getSectionId(section.title);

                return (
                  <button
                    key={sectionId}
                    onClick={() => {
                      document.getElementById(sectionId)?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }}
                    className="rounded-lg border border-border bg-panel px-4 py-3 text-left text-sm text-text-dim transition-all hover:border-accent hover:text-text"
                  >
                    {section.title}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel-padding-left panel-padding-right panel-padding-top-lg panel-padding-bottom-lg mt-8 rounded-xl border border-border bg-panel2/70 margin-top-lg">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-accent2">
              Toolbar and Timeline Icons
            </div>
            <p className="mt-4 text-sm leading-7 text-text-dim">
              These icons match the controls used throughout the editor, so you
              can quickly identify the buttons mentioned in the guide below.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {iconLegend.map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-sm text-text-dim"
                  >
                    <span className="rounded-md bg-accent/15 p-2 text-accent2">
                      <Icon size={16} />
                    </span>
                    <span>{item.label}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3 text-sm text-text-dim">
                <span className="rounded-md bg-accent/15 p-2 text-accent2">
                  <Pause size={16} />
                </span>
                <span>Pause</span>
              </div>
            </div>
          </section>

          <div className="mt-8 space-y-8">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <section
                  key={section.title}
                  id={getSectionId(section.title)}
                  className="margin-top-lg panel-padding-left panel-padding-right panel-padding-top-lg panel-padding-bottom-lg rounded-xl border border-border bg-panel2/70"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-accent/15 p-2 text-accent2">
                      <Icon size={18} />
                    </div>
                    <h3 className="text-lg font-semibold leading-tight text-text">
                      {section.title}
                    </h3>
                  </div>

                  <ul className="mt-6 list-disc space-y-4 pl-6 text-base leading-8 text-text-dim marker:text-accent2 panel-padding-left panel-padding-right">
                    {section.items.map((item, index) => (
                      <li key={`${section.title}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

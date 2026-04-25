#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import * as z from 'zod/v4';

const bridgeUrl = process.env.SPINEBONES_MCP_URL ?? 'http://127.0.0.1:48570';
const serverPort = Number.parseInt(process.env.SPINEBONES_MCP_PORT ?? '48600', 10);
const serverHost = process.env.SPINEBONES_MCP_HOST ?? '127.0.0.1';
const transportMode = process.env.SPINEBONES_MCP_TRANSPORT === 'http' ? 'http' : 'stdio';

const requestJson = async (path, init) => {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Bridge request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
};

const asTextResult = (label, payload) => ({
  content: [
    {
      type: 'text',
      text: `${label}\n${JSON.stringify(payload, null, 2)}`,
    },
  ],
});

const findBoneFromState = (state, boneId, boneName) => {
  if (typeof boneId === 'number') {
    return state.bones?.find((bone) => bone.id === boneId) ?? null;
  }

  if (boneName) {
    const normalized = boneName.trim().toLowerCase();
    return (
      state.bones?.find((bone) => bone.name.trim().toLowerCase() === normalized) ?? null
    );
  }

  return null;
};

const createServer = () => {
  const server = new McpServer({
    name: 'spinebones-editor',
    version: '0.1.3',
  });

  server.registerTool(
    'spinebones_health',
    {
      description: 'Check whether the local SpineBones editor bridge is reachable.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/health');
      return asTextResult('SpineBones bridge health', result);
    },
  );

  server.registerTool(
    'spinebones_get_editor_state',
    {
      description: 'Read the live state snapshot from the currently running SpineBones editor.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones editor state', result);
    },
  );

  server.registerTool(
    'spinebones_get_selected_bone',
    {
      description: 'Read the currently selected bone from the running SpineBones editor.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      const selectedBone =
        result.bones?.find((bone) => bone.id === result.selectedBoneId) ?? null;
      return asTextResult('SpineBones selected bone', {
        selectedBoneId: result.selectedBoneId,
        selectedBone,
      });
    },
  );

  server.registerTool(
    'spinebones_get_selected_bones',
    {
      description: 'Read all currently selected bones from the running SpineBones editor.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      const selectedIds = result.selectedBoneIds ?? [];
      const selectedBones = (result.bones ?? []).filter((bone) => selectedIds.includes(bone.id));
      return asTextResult('SpineBones selected bones', {
        selectedBoneId: result.selectedBoneId,
        selectedBoneIds: selectedIds,
        selectedBones,
      });
    },
  );

  server.registerTool(
    'spinebones_list_bones',
    {
      description: 'List all bones in the running SpineBones editor.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones bones', {
        boneCount: result.boneCount,
        bones: result.bones ?? [],
      });
    },
  );

  server.registerTool(
    'spinebones_get_bone_keyframes',
    {
      description: 'Read all keyframes for a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to inspect.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to inspect.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bone = findBoneFromState(result, bone_id, bone_name);
      if (!bone) {
        throw new Error('Bone not found for get_bone_keyframes');
      }

      const boneKeyframes = result.keyframes?.[bone.id] ?? {};
      const frames = Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b);
      return asTextResult('SpineBones bone keyframes', {
        bone,
        frameCount: frames.length,
        frames,
        keyframes: boneKeyframes,
      });
    },
  );

  server.registerTool(
    'spinebones_get_bone_world_transform',
    {
      description: 'Read the current world transform of a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to inspect.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to inspect.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bone = findBoneFromState(result, bone_id, bone_name);
      if (!bone) {
        throw new Error('Bone not found for get_bone_world_transform');
      }

      return asTextResult('SpineBones bone world transform', {
        boneId: bone.id,
        boneName: bone.name,
        worldX: bone.worldX,
        worldY: bone.worldY,
        worldRotation: bone.worldRotation,
        scaleX: bone.scaleX,
        scaleY: bone.scaleY,
      });
    },
  );

  server.registerTool(
    'spinebones_get_bone_hierarchy',
    {
      description: 'Read parent and child relationships for all bones or a specific bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Optional bone id to inspect.'),
        bone_name: z.string().min(1).optional().describe('Optional exact bone name to inspect.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bones = result.bones ?? [];
      const hierarchy = bones.map((bone) => ({
        boneId: bone.id,
        boneName: bone.name,
        parentId: bone.parentId,
        parentName: bones.find((candidate) => candidate.id === bone.parentId)?.name ?? null,
        childIds: bones.filter((candidate) => candidate.parentId === bone.id).map((candidate) => candidate.id),
        childNames: bones.filter((candidate) => candidate.parentId === bone.id).map((candidate) => candidate.name),
      }));

      const selected = findBoneFromState(result, bone_id, bone_name);
      return asTextResult('SpineBones bone hierarchy', {
        hierarchy: selected ? hierarchy.find((entry) => entry.boneId === selected.id) ?? null : hierarchy,
      });
    },
  );

  server.registerTool(
    'spinebones_get_bone_parent',
    {
      description: 'Read the direct parent of a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to inspect.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to inspect.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bones = result.bones ?? [];
      const bone = findBoneFromState(result, bone_id, bone_name);
      if (!bone) {
        throw new Error('Bone not found for get_bone_parent');
      }

      const parent =
        bone.parentId === null
          ? null
          : bones.find((candidate) => candidate.id === bone.parentId) ?? null;

      return asTextResult('SpineBones bone parent', {
        boneId: bone.id,
        boneName: bone.name,
        parentId: parent?.id ?? null,
        parentName: parent?.name ?? null,
        parent,
      });
    },
  );

  server.registerTool(
    'spinebones_get_bone_children',
    {
      description: 'Read the direct children of a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to inspect.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to inspect.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bones = result.bones ?? [];
      const bone = findBoneFromState(result, bone_id, bone_name);
      if (!bone) {
        throw new Error('Bone not found for get_bone_children');
      }

      const children = bones.filter((candidate) => candidate.parentId === bone.id);

      return asTextResult('SpineBones bone children', {
        boneId: bone.id,
        boneName: bone.name,
        childCount: children.length,
        childIds: children.map((child) => child.id),
        childNames: children.map((child) => child.name),
        children,
      });
    },
  );

  server.registerTool(
    'spinebones_get_timeline_summary',
    {
      description: 'Read a summary of the current timeline, frame distribution, and keyed bones.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      const keyframes = result.keyframes ?? {};
      const keyedBones = Object.entries(keyframes).map(([boneId, boneKeyframes]) => ({
        boneId: Number(boneId),
        boneName: result.bones?.find((bone) => bone.id === Number(boneId))?.name ?? null,
        frames: Object.keys(boneKeyframes).map(Number).sort((a, b) => a - b),
      }));
      const allFrames = [...new Set(keyedBones.flatMap((entry) => entry.frames))].sort((a, b) => a - b);

      return asTextResult('SpineBones timeline summary', {
        frame: result.frame,
        duration: result.duration,
        fps: result.fps,
        playing: result.playing,
        playbackRangeStart: result.playbackRangeStart ?? 0,
        playbackRangeEnd: result.playbackRangeEnd ?? null,
        keyedBoneCount: keyedBones.length,
        keyedFrames: allFrames,
        keyedBones,
      });
    },
  );

  server.registerTool(
    'spinebones_get_camera_state',
    {
      description: 'Read the current camera position, zoom, and canvas size.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones camera state', result.camera ?? null);
    },
  );

  server.registerTool(
    'spinebones_list_bone_groups',
    {
      description: 'List all bone groups and their assigned bones.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones bone groups', {
        boneGroups: result.boneGroups ?? [],
      });
    },
  );

  server.registerTool(
    'spinebones_list_skins',
    {
      description: 'List all skins and the currently active skin.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones skins', {
        activeSkinId: result.activeSkinId ?? null,
        skins: result.skins ?? [],
      });
    },
  );

  server.registerTool(
    'spinebones_list_ik_roots',
    {
      description: 'List all IK root bones that are currently enabled.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      const bones = result.bones ?? [];
      const ikRoots = (result.ikChainRootIds ?? []).map((rootId) => {
        const root = bones.find((bone) => bone.id === rootId) ?? null;
        const child = bones.find((bone) => bone.parentId === rootId) ?? null;
        const end = child ? bones.find((bone) => bone.parentId === child.id) ?? null : null;
        return {
          rootId,
          rootName: root?.name ?? null,
          childId: child?.id ?? null,
          childName: child?.name ?? null,
          endId: end?.id ?? null,
          endName: end?.name ?? null,
        };
      });
      return asTextResult('SpineBones IK roots', { ikRoots });
    },
  );

  server.registerTool(
    'spinebones_list_slots',
    {
      description: 'List slots, optionally filtered by a bone id or exact bone name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bone = bone_id !== undefined || bone_name ? findBoneFromState(result, bone_id, bone_name) : null;
      const slots = bone
        ? (result.slots ?? []).filter((slot) => slot.boneId === bone.id)
        : (result.slots ?? []);
      return asTextResult('SpineBones slots', {
        boneId: bone?.id ?? null,
        boneName: bone?.name ?? null,
        slots,
      });
    },
  );

  server.registerTool(
    'spinebones_get_slots_by_bone',
    {
      description: 'List all slots attached to a specific bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/state');
      const bone = findBoneFromState(result, bone_id, bone_name);
      if (!bone) throw new Error('Bone not found for get_slots_by_bone');
      const slots = (result.slots ?? []).filter((slot) => slot.boneId === bone.id);
      return asTextResult('SpineBones slots by bone', {
        boneId: bone.id,
        boneName: bone.name,
        slots,
      });
    },
  );

  server.registerTool(
    'spinebones_list_attachments',
    {
      description: 'List attachments, optionally filtered by slot id or exact slot name.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
      },
    },
    async ({ slot_id, slot_name }) => {
      const result = await requestJson('/state');
      const slot =
        typeof slot_id === 'number'
          ? (result.slots ?? []).find((entry) => entry.id === slot_id) ?? null
          : slot_name
            ? (result.slots ?? []).find((entry) => entry.name.trim().toLowerCase() === slot_name.trim().toLowerCase()) ?? null
            : null;
      const attachments = slot
        ? (result.attachments ?? []).filter((attachment) => attachment.slotId === slot.id)
        : (result.attachments ?? []);
      return asTextResult('SpineBones attachments', {
        slotId: slot?.id ?? null,
        slotName: slot?.name ?? null,
        attachments,
      });
    },
  );

  server.registerTool(
    'spinebones_get_audio_state',
    {
      description: 'Read the current preview audio state.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/state');
      return asTextResult('SpineBones audio state', {
        audioData: result.audioData ?? null,
        audioName: result.audioName ?? null,
        audioVolume: result.audioVolume ?? null,
        audioOffsetFrames: result.audioOffsetFrames ?? null,
        hasAudio: Boolean(result.audioData),
      });
    },
  );

  server.registerTool(
    'spinebones_get_project_info',
    {
      description: 'Read the current project path and suggested save name.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'get_project_info',
        }),
      });

      return asTextResult('SpineBones project info', result);
    },
  );

  server.registerTool(
    'spinebones_list_recent_projects',
    {
      description: 'List recent projects shown in the project browser.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'list_recent_projects',
        }),
      });

      return asTextResult('SpineBones recent projects', result);
    },
  );

  server.registerTool(
    'spinebones_set_mode',
    {
      description: 'Switch the editor mode between setup and animate.',
      inputSchema: {
        mode: z.enum(['setup', 'animate']).describe('Target editor mode.'),
      },
    },
    async ({ mode }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_mode',
          mode,
        }),
      });

      return asTextResult('Editor mode updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_tool',
    {
      description: 'Switch the active editor tool between pose, bone, move, rotate, and scale.',
      inputSchema: {
        tool: z.enum(['pose', 'bone', 'move', 'rotate', 'scale']),
      },
    },
    async ({ tool }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_tool',
          tool,
        }),
      });

      return asTextResult('Editor tool updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_frame',
    {
      description: 'Set the current frame in the running SpineBones editor.',
      inputSchema: {
        frame: z.number().int().min(0).describe('Target frame index.'),
      },
    },
    async ({ frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_frame',
          frame,
        }),
      });

      return asTextResult('Frame updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_playback_range',
    {
      description: 'Set the playback range metadata for the current editor session.',
      inputSchema: {
        start_frame: z.number().int().min(0).describe('Playback range start frame.'),
        end_frame: z.number().int().min(0).nullable().optional().describe('Playback range end frame, or null to clear it.'),
      },
    },
    async ({ start_frame, end_frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_playback_range',
          startFrame: start_frame,
          endFrame: end_frame ?? null,
        }),
      });

      return asTextResult('Playback range updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_select_bone',
    {
      description: 'Select a specific bone by id or exact name in the running SpineBones editor.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to select.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to select.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'select_bone',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });

      return asTextResult('Bone selected in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_select_bones',
    {
      description: 'Select multiple bones by id in the running SpineBones editor.',
      inputSchema: {
        bone_ids: z.array(z.number().int().min(0)).min(1),
      },
    },
    async ({ bone_ids }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'select_multiple_bones',
          boneIds: bone_ids,
        }),
      });

      return asTextResult('Multiple bones selected in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_selection',
    {
      description: 'Clear the current bone selection.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'clear_selection',
        }),
      });

      return asTextResult('Selection cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_add_bone',
    {
      description: 'Add a new bone to the skeleton.',
      inputSchema: {
        name: z.string().min(1).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        length: z.number().positive().optional(),
        rotation: z.number().optional(),
        scale_x: z.number().optional(),
        scale_y: z.number().optional(),
        parent_bone_id: z.number().int().min(0).optional(),
        parent_bone_name: z.string().min(1).optional(),
      },
    },
    async ({ name, x, y, length, rotation, scale_x, scale_y, parent_bone_id, parent_bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'add_bone',
          name,
          x,
          y,
          value: length,
          rotation,
          transform: {
            rotation,
            scaleX: scale_x,
            scaleY: scale_y,
          },
          parentBoneId: parent_bone_id,
          parentBoneName: parent_bone_name,
        }),
      });

      return asTextResult('Bone added in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_rename_bone',
    {
      description: 'Rename a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        name: z.string().min(1),
      },
    },
    async ({ bone_id, bone_name, name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'rename_bone',
          boneId: bone_id,
          boneName: bone_name,
          name,
        }),
      });

      return asTextResult('Bone renamed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_delete_bone',
    {
      description: 'Delete a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'delete_bone',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });

      return asTextResult('Bone deleted in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_reorder_bone',
    {
      description: 'Move a bone to a different draw-order index.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        to_index: z.number().int().min(0),
      },
    },
    async ({ bone_id, bone_name, to_index }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'reorder_bone',
          boneId: bone_id,
          boneName: bone_name,
          value: to_index,
        }),
      });

      return asTextResult('Bone reordered in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_mirror_horizontal',
    {
      description: 'Mirror one or more selected bones horizontally.',
      inputSchema: {
        bone_ids: z.array(z.number().int().min(0)).min(1).optional(),
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_ids, bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'mirror_horizontal',
          boneIds: bone_ids,
          boneId: bone_id,
          boneName: bone_name,
        }),
      });

      return asTextResult('Bones mirrored horizontally in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_mirror_vertical',
    {
      description: 'Mirror one or more selected bones vertically.',
      inputSchema: {
        bone_ids: z.array(z.number().int().min(0)).min(1).optional(),
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_ids, bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'mirror_vertical',
          boneIds: bone_ids,
          boneId: bone_id,
          boneName: bone_name,
        }),
      });

      return asTextResult('Bones mirrored vertically in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_save_setup_pose',
    {
      description: 'Persist the current setup pose as the rig base pose.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'save_setup_pose',
        }),
      });

      return asTextResult('Setup pose saved in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_bone_parent',
    {
      description: 'Set the parent of a specific bone by id or exact name. This only works while the editor is in Setup mode.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Child bone id to reparent.'),
        bone_name: z.string().min(1).optional().describe('Exact child bone name to reparent.'),
        parent_bone_id: z.number().int().min(0).optional().describe('New parent bone id. Omit to clear parent.'),
        parent_bone_name: z.string().min(1).optional().describe('Exact new parent bone name. Omit to clear parent.'),
      },
    },
    async ({ bone_id, bone_name, parent_bone_id, parent_bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_bone_parent',
          boneId: bone_id,
          boneName: bone_name,
          parentBoneId: parent_bone_id,
          parentBoneName: parent_bone_name,
        }),
      });

      return asTextResult('Bone parent updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_bone_parent',
    {
      description: 'Clear the parent of a specific bone. This only works while the editor is in Setup mode.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Child bone id to detach.'),
        bone_name: z.string().min(1).optional().describe('Exact child bone name to detach.'),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'clear_bone_parent',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });

      return asTextResult('Bone parent cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_create_bone_group',
    {
      description: 'Create a bone group.',
      inputSchema: {
        name: z.string().min(1).optional(),
      },
    },
    async ({ name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'create_bone_group',
          name,
        }),
      });
      return asTextResult('Bone group created in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_rename_bone_group',
    {
      description: 'Rename a bone group by id or exact name.',
      inputSchema: {
        group_id: z.number().int().min(0).optional(),
        group_name: z.string().min(1).optional(),
        name: z.string().min(1),
      },
    },
    async ({ group_id, group_name, name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'rename_bone_group',
          groupId: group_id,
          groupName: group_name,
          name,
        }),
      });
      return asTextResult('Bone group renamed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_delete_bone_group',
    {
      description: 'Delete a bone group by id or exact name.',
      inputSchema: {
        group_id: z.number().int().min(0).optional(),
        group_name: z.string().min(1).optional(),
      },
    },
    async ({ group_id, group_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'delete_bone_group',
          groupId: group_id,
          groupName: group_name,
        }),
      });
      return asTextResult('Bone group deleted in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_assign_bone_to_group',
    {
      description: 'Assign a bone to a bone group.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        group_id: z.number().int().min(0).optional(),
        group_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name, group_id, group_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'assign_bone_to_group',
          boneId: bone_id,
          boneName: bone_name,
          groupId: group_id,
          groupName: group_name,
        }),
      });
      return asTextResult('Bone assigned to group in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_unassign_bone_from_group',
    {
      description: 'Remove a bone from its bone group.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'unassign_bone_from_group',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });
      return asTextResult('Bone unassigned from group in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_create_skin',
    {
      description: 'Create a new skin.',
      inputSchema: {
        name: z.string().min(1).optional(),
        color: z.string().min(1).optional(),
      },
    },
    async ({ name, color }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'create_skin',
          name,
          color,
        }),
      });
      return asTextResult('Skin created in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_rename_skin',
    {
      description: 'Rename a skin by id or exact name.',
      inputSchema: {
        skin_id: z.number().int().min(0).optional(),
        skin_name: z.string().min(1).optional(),
        name: z.string().min(1),
      },
    },
    async ({ skin_id, skin_name, name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'rename_skin',
          skinId: skin_id,
          skinName: skin_name,
          name,
        }),
      });
      return asTextResult('Skin renamed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_delete_skin',
    {
      description: 'Delete a skin by id or exact name.',
      inputSchema: {
        skin_id: z.number().int().min(0).optional(),
        skin_name: z.string().min(1).optional(),
      },
    },
    async ({ skin_id, skin_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'delete_skin',
          skinId: skin_id,
          skinName: skin_name,
        }),
      });
      return asTextResult('Skin deleted in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_active_skin',
    {
      description: 'Set the active skin by id or exact name.',
      inputSchema: {
        skin_id: z.number().int().min(0).optional(),
        skin_name: z.string().min(1).optional(),
      },
    },
    async ({ skin_id, skin_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_active_skin',
          skinId: skin_id,
          skinName: skin_name,
        }),
      });
      return asTextResult('Active skin updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_toggle_ik_chain',
    {
      description: 'Toggle 2-bone IK for a root bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'toggle_ik_chain',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });
      return asTextResult('IK chain toggled in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_ik_target',
    {
      description: 'Set the target position for a 2-bone IK chain by its root bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        x: z.number(),
        y: z.number(),
      },
    },
    async ({ bone_id, bone_name, x, y }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_ik_target',
          boneId: bone_id,
          boneName: bone_name,
          x,
          y,
        }),
      });
      return asTextResult('IK target updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_add_slot',
    {
      description: 'Add a slot to a bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name, name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'add_slot',
          boneId: bone_id,
          boneName: bone_name,
          name,
        }),
      });
      return asTextResult('Slot added in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_rename_slot',
    {
      description: 'Rename a slot by id or exact name.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        name: z.string().min(1),
      },
    },
    async ({ slot_id, slot_name, name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'rename_slot',
          slotId: slot_id,
          slotName: slot_name,
          name,
        }),
      });
      return asTextResult('Slot renamed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_delete_slot',
    {
      description: 'Delete a slot by id or exact name.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
      },
    },
    async ({ slot_id, slot_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'delete_slot',
          slotId: slot_id,
          slotName: slot_name,
        }),
      });
      return asTextResult('Slot deleted in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_slot_attachment',
    {
      description: 'Set the active attachment on a slot.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        attachment_name: z.string().min(1),
      },
    },
    async ({ slot_id, slot_name, attachment_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_slot_attachment',
          slotId: slot_id,
          slotName: slot_name,
          attachmentName: attachment_name,
        }),
      });
      return asTextResult('Slot attachment updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_slot_attachment',
    {
      description: 'Clear the active attachment from a slot.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
      },
    },
    async ({ slot_id, slot_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'clear_slot_attachment',
          slotId: slot_id,
          slotName: slot_name,
        }),
      });
      return asTextResult('Slot attachment cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_create_attachment',
    {
      description: 'Create an image attachment for a slot from a local file path.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        path: z.string().min(1),
        attachment_name: z.string().min(1).optional(),
      },
    },
    async ({ slot_id, slot_name, path, attachment_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'create_attachment',
          slotId: slot_id,
          slotName: slot_name,
          path,
          attachmentName: attachment_name,
        }),
      });
      return asTextResult('Attachment created in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_update_attachment',
    {
      description: 'Update attachment transform or rename an attachment.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        attachment_name: z.string().min(1),
        name: z.string().min(1).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scale_x: z.number().optional(),
        scale_y: z.number().optional(),
      },
    },
    async ({ slot_id, slot_name, attachment_name, name, x, y, rotation, scale_x, scale_y }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'update_attachment',
          slotId: slot_id,
          slotName: slot_name,
          attachmentName: attachment_name,
          name,
          x,
          y,
          rotation,
          transform: {
            scaleX: scale_x,
            scaleY: scale_y,
          },
        }),
      });
      return asTextResult('Attachment updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_delete_attachment',
    {
      description: 'Delete an attachment from a slot.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        attachment_name: z.string().min(1),
      },
    },
    async ({ slot_id, slot_name, attachment_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'delete_attachment',
          slotId: slot_id,
          slotName: slot_name,
          attachmentName: attachment_name,
        }),
      });
      return asTextResult('Attachment deleted in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_reorder_slots',
    {
      description: 'Set the draw-order index for a slot.',
      inputSchema: {
        slot_id: z.number().int().min(0).optional(),
        slot_name: z.string().min(1).optional(),
        draw_order: z.number().int().min(0),
      },
    },
    async ({ slot_id, slot_name, draw_order }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'reorder_slots',
          slotId: slot_id,
          slotName: slot_name,
          drawOrder: draw_order,
        }),
      });
      return asTextResult('Slot draw order updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_toggle_attachment_drag',
    {
      description: 'Enable or disable attachment canvas dragging.',
      inputSchema: {
        enabled: z.boolean(),
      },
    },
    async ({ enabled }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'toggle_attachment_drag',
          value: enabled,
        }),
      });
      return asTextResult('Attachment drag state updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_bone_transform',
    {
      description: 'Set the live transform of a specific bone by id or exact name.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to update.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to update.'),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scale_x: z.number().optional(),
        scale_y: z.number().optional(),
      },
    },
    async ({ bone_id, bone_name, x, y, rotation, scale_x, scale_y }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_bone_transform',
          boneId: bone_id,
          boneName: bone_name,
          transform: {
            x,
            y,
            rotation,
            scaleX: scale_x,
            scaleY: scale_y,
          },
        }),
      });

      return asTextResult('Bone transform updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_multiple_bone_transforms',
    {
      description: 'Set the live transform of multiple bones in one call.',
      inputSchema: {
        transforms: z.array(
          z.object({
            bone_id: z.number().int().min(0).optional(),
            bone_name: z.string().min(1).optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            rotation: z.number().optional(),
            scale_x: z.number().optional(),
            scale_y: z.number().optional(),
          }),
        ).min(1),
      },
    },
    async ({ transforms }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_multiple_bone_transforms',
          transforms: transforms.map((entry) => ({
            boneId: entry.bone_id,
            boneName: entry.bone_name,
            x: entry.x,
            y: entry.y,
            rotation: entry.rotation,
            scaleX: entry.scale_x,
            scaleY: entry.scale_y,
          })),
        }),
      });

      return asTextResult('Multiple bone transforms updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_keyframe',
    {
      description: 'Set or overwrite a keyframe for a specific bone at a target frame.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to keyframe.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to keyframe.'),
        frame: z.number().int().min(0).optional().describe('Frame to write. Defaults to current frame.'),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scale_x: z.number().optional(),
        scale_y: z.number().optional(),
        easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).optional(),
      },
    },
    async ({ bone_id, bone_name, frame, x, y, rotation, scale_x, scale_y, easing }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_keyframe',
          boneId: bone_id,
          boneName: bone_name,
          frame,
          transform: {
            x,
            y,
            rotation,
            scaleX: scale_x,
            scaleY: scale_y,
            easing,
          },
        }),
      });

      return asTextResult('Keyframe written in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_multiple_keyframes',
    {
      description: 'Set or overwrite multiple keyframes across bones in one call. NOTE: If you are creating a new animation (walk, run, idle, attack, etc.), call spinebones_apply_rag_animation first — it retrieves a matching animation from the dataset and applies it automatically. Use this tool only for manual edits or when spinebones_apply_rag_animation is not suitable.',
      inputSchema: {
        keyframes: z.array(
          z.object({
            bone_id: z.number().int().min(0).optional(),
            bone_name: z.string().min(1).optional(),
            frame: z.number().int().min(0).optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            rotation: z.number().optional(),
            scale_x: z.number().optional(),
            scale_y: z.number().optional(),
            easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).optional(),
          }),
        ).min(1),
      },
    },
    async ({ keyframes }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_multiple_keyframes',
          keyframes: keyframes.map((entry) => ({
            boneId: entry.bone_id,
            boneName: entry.bone_name,
            frame: entry.frame,
            x: entry.x,
            y: entry.y,
            rotation: entry.rotation,
            scaleX: entry.scale_x,
            scaleY: entry.scale_y,
            easing: entry.easing,
          })),
        }),
      });

      return asTextResult('Multiple keyframes written in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_add_keyframe_for_specific_bone',
    {
      description: 'Alias of set_keyframe for a specific bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to keyframe.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to keyframe.'),
        frame: z.number().int().min(0).optional().describe('Frame to write. Defaults to current frame.'),
        x: z.number().optional(),
        y: z.number().optional(),
        rotation: z.number().optional(),
        scale_x: z.number().optional(),
        scale_y: z.number().optional(),
        easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']).optional(),
      },
    },
    async ({ bone_id, bone_name, frame, x, y, rotation, scale_x, scale_y, easing }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'add_keyframe_for_specific_bone',
          boneId: bone_id,
          boneName: bone_name,
          frame,
          transform: {
            x,
            y,
            rotation,
            scaleX: scale_x,
            scaleY: scale_y,
            easing,
          },
        }),
      });

      return asTextResult('Keyframe written in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_animation_range',
    {
      description: 'Remove all keyframes inside an inclusive frame range.',
      inputSchema: {
        start_frame: z.number().int().min(0).describe('Inclusive start frame.'),
        end_frame: z.number().int().min(0).describe('Inclusive end frame.'),
      },
    },
    async ({ start_frame, end_frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'clear_animation_range',
          startFrame: start_frame,
          endFrame: end_frame,
        }),
      });

      return asTextResult('Animation range cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_remove_keyframe',
    {
      description: 'Remove a keyframe for a specific bone at a target frame.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to edit.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to edit.'),
        frame: z.number().int().min(0).optional().describe('Frame to remove. Defaults to current frame.'),
      },
    },
    async ({ bone_id, bone_name, frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'remove_keyframe',
          boneId: bone_id,
          boneName: bone_name,
          frame,
        }),
      });

      return asTextResult('Keyframe removed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_duplicate_keyframe',
    {
      description: 'Duplicate a bone keyframe from one frame to another.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional().describe('Bone id to duplicate.'),
        bone_name: z.string().min(1).optional().describe('Exact bone name to duplicate.'),
        from_frame: z.number().int().min(0).describe('Source frame to copy from.'),
        to_frame: z.number().int().min(0).describe('Target frame to paste to.'),
      },
    },
    async ({ bone_id, bone_name, from_frame, to_frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'duplicate_keyframe',
          boneId: bone_id,
          boneName: bone_name,
          frame: from_frame,
          keyframeFrame: to_frame,
        }),
      });

      return asTextResult('Keyframe duplicated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_duration',
    {
      description: 'Set the animation duration in frames.',
      inputSchema: {
        duration: z.number().int().min(10).max(300),
      },
    },
    async ({ duration }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_duration',
          duration,
        }),
      });
      return asTextResult('Animation duration updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_fps',
    {
      description: 'Set the timeline FPS.',
      inputSchema: {
        fps: z.number().int().min(1).max(120),
      },
    },
    async ({ fps }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_fps',
          fps,
        }),
      });
      return asTextResult('Timeline FPS updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_apply_rag_animation',
    {
      description: 'PREFERRED FIRST STEP for any animation task. Retrieves the best-matching animation from the RAG dataset using a natural-language prompt and applies it to the current timeline automatically — including bone mapping, duration, fps, and all keyframes. Always call this before manually writing keyframes with spinebones_set_multiple_keyframes.',
      inputSchema: {
        prompt: z.string().min(1).describe('Natural-language description of the desired animation, e.g. "walk cycle for knight" or "animasi lari".'),
      },
    },
    async ({ prompt }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'apply_rag_animation',
          prompt,
        }),
      });
      return asTextResult('RAG animation applied in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_play_animation',
    {
      description: 'Start playback in the timeline.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'play_animation' }),
      });
      return asTextResult('Timeline playback started in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_pause_animation',
    {
      description: 'Pause timeline playback while keeping the current frame.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'pause_animation' }),
      });
      return asTextResult('Timeline playback paused in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_stop_animation',
    {
      description: 'Stop timeline playback and return to frame 0.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'stop_animation' }),
      });
      return asTextResult('Timeline playback stopped in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_move_keyframe',
    {
      description: 'Move a specific bone keyframe from one frame to another.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        from_frame: z.number().int().min(0),
        to_frame: z.number().int().min(0),
      },
    },
    async ({ bone_id, bone_name, from_frame, to_frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'move_keyframe',
          boneId: bone_id,
          boneName: bone_name,
          frame: from_frame,
          keyframeFrame: to_frame,
        }),
      });
      return asTextResult('Keyframe moved in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_update_keyframe_easing',
    {
      description: 'Update the easing of a specific keyframe.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        frame: z.number().int().min(0),
        easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut']),
      },
    },
    async ({ bone_id, bone_name, frame, easing }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'update_keyframe_easing',
          boneId: bone_id,
          boneName: bone_name,
          frame,
          easing,
        }),
      });
      return asTextResult('Keyframe easing updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_bone_keyframes',
    {
      description: 'Clear all keyframes for a specific bone.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
      },
    },
    async ({ bone_id, bone_name }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'clear_bone_keyframes',
          boneId: bone_id,
          boneName: bone_name,
        }),
      });
      return asTextResult('Bone keyframes cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_copy_first_keyframe',
    {
      description: 'Copy the first keyframe of a bone to the current or specified frame.',
      inputSchema: {
        bone_id: z.number().int().min(0).optional(),
        bone_name: z.string().min(1).optional(),
        frame: z.number().int().min(0).optional(),
      },
    },
    async ({ bone_id, bone_name, frame }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'copy_first_keyframe',
          boneId: bone_id,
          boneName: bone_name,
          frame,
        }),
      });
      return asTextResult('First keyframe copied in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_loop_keyframes',
    {
      description: 'Mirror existing keyframes in reverse to create a seamless loop.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'loop_keyframes' }),
      });
      return asTextResult('Loop keyframes generated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_audio_track',
    {
      description: 'Import a preview audio track from a local file path.',
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async ({ path }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'set_audio_track', path }),
      });
      return asTextResult('Audio track imported into SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_audio_track',
    {
      description: 'Remove the preview audio track.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'clear_audio_track' }),
      });
      return asTextResult('Audio track cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_audio_volume',
    {
      description: 'Set the preview audio volume between 0 and 1.',
      inputSchema: {
        volume: z.number().min(0).max(1),
      },
    },
    async ({ volume }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'set_audio_volume', volume }),
      });
      return asTextResult('Audio volume updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_audio_offset_frames',
    {
      description: 'Set the audio start offset in frames.',
      inputSchema: {
        offset_frames: z.number().int().min(0),
      },
    },
    async ({ offset_frames }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_audio_offset_frames',
          offsetFrames: offset_frames,
        }),
      });
      return asTextResult('Audio offset updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_camera',
    {
      description: 'Set the camera position and/or zoom.',
      inputSchema: {
        x: z.number().optional(),
        y: z.number().optional(),
        zoom: z.number().positive().optional(),
      },
    },
    async ({ x, y, zoom }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_camera',
          x,
          y,
          zoom,
        }),
      });
      return asTextResult('Camera updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_pan_camera',
    {
      description: 'Pan the camera by dx and dy screen-space deltas.',
      inputSchema: {
        x: z.number().describe('Pan delta X.'),
        y: z.number().describe('Pan delta Y.'),
      },
    },
    async ({ x, y }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'pan_camera',
          x,
          y,
        }),
      });
      return asTextResult('Camera panned in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_zoom_camera',
    {
      description: 'Multiply the camera zoom by a factor.',
      inputSchema: {
        factor: z.number().positive(),
      },
    },
    async ({ factor }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'zoom_camera',
          factor,
        }),
      });
      return asTextResult('Camera zoom updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_reset_camera',
    {
      description: 'Reset the camera to its default position and zoom.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'reset_camera' }),
      });
      return asTextResult('Camera reset in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_onion_skin',
    {
      description: 'Enable or disable onion skin preview.',
      inputSchema: {
        enabled: z.boolean(),
      },
    },
    async ({ enabled }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_onion_skin',
          value: enabled,
        }),
      });
      return asTextResult('Onion skin state updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_bone_indicators',
    {
      description: 'Enable or disable bone indicators in the canvas.',
      inputSchema: {
        enabled: z.boolean(),
      },
    },
    async ({ enabled }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_bone_indicators',
          value: enabled,
        }),
      });
      return asTextResult('Bone indicator visibility updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_background',
    {
      description: 'Set the canvas background image from a local file path.',
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async ({ path }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_background',
          path,
        }),
      });
      return asTextResult('Background image updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_background',
    {
      description: 'Clear the background image.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'clear_background' }),
      });
      return asTextResult('Background image cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_new_project',
    {
      description: 'Create a new empty project.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'new_project' }),
      });
      return asTextResult('New project created in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_open_project',
    {
      description: 'Open a project from an exact local file path.',
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async ({ path }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'open_project', path }),
      });
      return asTextResult('Project opened in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_save_project',
    {
      description: 'Save the current project to its current path, or prompt Save As when needed.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'save_project' }),
      });
      return asTextResult('Project saved in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_save_project_as',
    {
      description: 'Prompt a Save As flow for the current project.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'save_project_as' }),
      });
      return asTextResult('Project save-as completed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_remove_recent_project',
    {
      description: 'Remove a project path from the recent-project list.',
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async ({ path }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'remove_recent_project', path }),
      });
      return asTextResult('Recent project removed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_clear_recent_projects',
    {
      description: 'Clear the recent-project list.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'clear_recent_projects' }),
      });
      return asTextResult('Recent projects cleared in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_project_browser',
    {
      description: 'Show or hide the project browser dialog.',
      inputSchema: {
        visible: z.boolean(),
      },
    },
    async ({ visible }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_project_browser',
          value: visible,
        }),
      });
      return asTextResult('Project browser visibility updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_set_help_dialog',
    {
      description: 'Show or hide the help dialog.',
      inputSchema: {
        visible: z.boolean(),
      },
    },
    async ({ visible }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'set_help_dialog',
          value: visible,
        }),
      });
      return asTextResult('Help dialog visibility updated in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_export_video',
    {
      description: 'Export the current animation as a WebM video to an exact local output path.',
      inputSchema: {
        output_path: z.string().min(1),
      },
    },
    async ({ output_path }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'export_video',
          outputPath: output_path,
        }),
      });
      return asTextResult('Video exported from SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_export_sprite_sheet',
    {
      description: 'Export the current animation as a sprite-sheet ZIP to an exact local output path.',
      inputSchema: {
        output_path: z.string().min(1),
        frame_width: z.number().int().min(64).max(4096).optional(),
        frame_height: z.number().int().min(64).max(4096).optional(),
      },
    },
    async ({ output_path, frame_width, frame_height }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'export_sprite_sheet',
          outputPath: output_path,
          x: frame_width,
          y: frame_height,
        }),
      });
      return asTextResult('Sprite sheet exported from SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_export_png_sequence',
    {
      description: 'Export the current animation as a PNG-sequence ZIP to an exact local output path.',
      inputSchema: {
        output_path: z.string().min(1),
        frame_width: z.number().int().min(64).max(4096).optional(),
        frame_height: z.number().int().min(64).max(4096).optional(),
        include_background: z.boolean().optional(),
      },
    },
    async ({ output_path, frame_width, frame_height, include_background }) => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({
          commandType: 'export_png_sequence',
          outputPath: output_path,
          x: frame_width,
          y: frame_height,
          value: include_background ?? false,
        }),
      });
      return asTextResult('PNG sequence exported from SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_undo',
    {
      description: 'Undo the last editor action.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'undo' }),
      });
      return asTextResult('Undo executed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_redo',
    {
      description: 'Redo the last undone editor action.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'redo' }),
      });
      return asTextResult('Redo executed in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_prev_keyframe',
    {
      description: 'Jump to the previous keyframe for the currently selected bone.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'prev_keyframe' }),
      });
      return asTextResult('Moved to previous keyframe in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_next_keyframe',
    {
      description: 'Jump to the next keyframe for the currently selected bone.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'next_keyframe' }),
      });
      return asTextResult('Moved to next keyframe in SpineBones', result);
    },
  );

  server.registerTool(
    'spinebones_select_frame_keyframes',
    {
      description: 'Select all keyframes at the current frame inside the timeline UI.',
      inputSchema: {},
    },
    async () => {
      const result = await requestJson('/command', {
        method: 'POST',
        body: JSON.stringify({ commandType: 'select_frame_keyframes' }),
      });
      return asTextResult('Selected frame keyframes in SpineBones', result);
    },
  );

  return server;
};

if (transportMode === 'http') {
  const app = createMcpExpressApp();
  const transports = new Map();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      mode: 'streamable-http',
      bridgeUrl,
      port: serverPort,
      host: serverHost,
      mcpUrl: `http://${serverHost}:${serverPort}/mcp`,
    });
  });

  const handleMcpRequest = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let record = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    try {
      if (!record) {
        if (req.method !== 'POST') {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'No active MCP session for this request.',
            },
            id: null,
          });
          return;
        }

        const server = createServer();
        let createdSessionId = null;
        let closing = false;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId) => {
            createdSessionId = newSessionId;
            transports.set(newSessionId, { transport, server });
          },
        });

        transport.onclose = async () => {
          if (closing) return;
          closing = true;
          if (createdSessionId) {
            transports.delete(createdSessionId);
          }
        };

        await server.connect(transport);
        record = { transport, server };
      }

      await record.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling SpineBones MCP HTTP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpRequest);
  app.delete('/mcp', handleMcpRequest);

  app.listen(serverPort, serverHost, (error) => {
    if (error) {
      console.error('Failed to start SpineBones MCP HTTP server:', error);
      process.exit(1);
    }

    console.error(`SpineBones MCP server ready via streamable HTTP -> http://${serverHost}:${serverPort}/mcp`);
  });
} else {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`SpineBones MCP server ready via stdio -> ${bridgeUrl}`);
}

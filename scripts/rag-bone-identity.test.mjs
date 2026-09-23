import { test, expect } from 'bun:test';
import backflip from '../data/rag/animations/jump-backflip-2.json';
import { flattenDatasetKeyframes, bindKeyframeTargets, resolveKeyframeTarget } from '../src/thesis/rag/adaptation/keyframeAdapter';
import { compareKeyframes } from '../src/thesis/evaluation/compareKeyframes';
import { synthesizeKeyframes } from '../src/thesis/rag/synthesis/keyframeSynthesizer';
import { analyzeMotionPattern } from '../src/thesis/rag/synthesis/motionAnalyzer';

const bones = backflip.animation.bones;
const mapping = Object.fromEntries(bones.map(bone => [bone.name, bone.name]));
const raw = () => flattenDatasetKeyframes(backflip.animation, mapping);

test('same-rig backflip preserves both right_arm tracks and verifies all 110 poses', () => {
  const entries = bindKeyframeTargets(raw(), backflip.animation, bones);
  const actual = {};
  for (const entry of entries) {
    const bone = resolveKeyframeTarget(entry, bones);
    expect(bone.id).toBe(entry.sourceBoneId);
    const { x, y, rotation, scaleX, scaleY, easing } = entry;
    (actual[bone.id] ??= {})[entry.frame] = { x, y, rotation, scaleX, scaleY, easing };
  }
  expect(Object.keys(actual)).toHaveLength(10);
  const comparison = compareKeyframes(entries, bones, actual, 72);
  expect(comparison.appliedKeyframeCount).toBe(110);
  expect(comparison.matchingKeyframeCount).toBe(110);
  expect(comparison.discrepancies).toEqual([]);
  expect(comparison.duplicateDestinations).toBe(0);
});

test('synthesis retains source IDs before target binding', () => {
  const result = synthesizeKeyframes(backflip, mapping, analyzeMotionPattern(backflip), {
    heightScale: 1.15, timeScale: 1.15, weightScale: 0.9, smoothness: 1, exaggeration: 1, matchedPhrases: [],
  });
  const entries = bindKeyframeTargets(result.flatKeyframes, backflip.animation, bones);
  expect(entries.filter(entry => entry.targetBoneId === 2)).toHaveLength(11);
  expect(entries.filter(entry => entry.targetBoneId === 3)).toHaveLength(11);
  expect(result.appliedDuration).toBe(83);
});

test('different rig cannot reuse coincidental IDs for ambiguous names', () => {
  const differentRig = bones.map(bone => bone.id === 3 ? { ...bone, parentId: 1 } : bone);
  const entries = bindKeyframeTargets(raw(), backflip.animation, differentRig);
  const arm = entries.find(entry => entry.sourceBoneId === 2);
  expect(arm.targetBoneId).toBeUndefined();
  expect(resolveKeyframeTarget(arm, differentRig)).toBeUndefined();
});

test('different rig maps unique names to their actual target IDs', () => {
  const differentRig = bones.map(bone => ({ ...bone, id: bone.id + 100, parentId: bone.parentId === null ? null : bone.parentId + 100 }));
  const entries = bindKeyframeTargets(raw(), backflip.animation, differentRig);
  expect(entries.find(entry => entry.sourceBoneId === 0).targetBoneId).toBe(100);
});

test('a genuinely missing track still fails evaluation after identity binding', () => {
  const entries = bindKeyframeTargets(raw(), backflip.animation, bones);
  const comparison = compareKeyframes(entries, bones, {}, 72);
  expect(comparison.matchingKeyframeCount).toBe(0);
  expect(comparison.missingKeyframes).toBe(110);
});

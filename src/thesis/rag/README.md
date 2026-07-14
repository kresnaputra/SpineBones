# Thesis RAG Module

This folder contains the thesis-specific RAG pipeline for animation retrieval.

Structure:

- `types/`: shared TypeScript types for RAG dataset items and retrieval results
- `retrieval/`: query building, loading, scoring, and top-k retrieval
- `adaptation/`: mapping retrieved animation data onto the active rig
- `synthesis/`: prompt modifier parsing, motion pattern analysis (key poses, timing,
  displacement), and keyframe generation from an analyzed pattern
- `shared/`: small helpers (duration/fps clamping) reused across the pipeline

Recommended flow:

1. Load dataset items from `data/rag/animations/`
2. Build a query from prompt + semantic bone context
3. Retrieve top matching animation references (top 2-3 candidates)
4. Map semantic bones from dataset to the active rig
5. Analyze the selected candidate's motion pattern and synthesize a new keyframe set from it,
   applying any prompt modifiers (higher/faster/heavier/smoother/dramatic) — raw dataset
   keyframes are only used verbatim when explicitly requested
6. Apply the resulting keyframes to the editor timeline

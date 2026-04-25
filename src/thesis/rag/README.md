# Thesis RAG Module

This folder contains the thesis-specific RAG pipeline for animation retrieval.

Structure:

- `types/`: shared TypeScript types for RAG dataset items and retrieval results
- `retrieval/`: query building, loading, scoring, and top-k retrieval
- `adaptation/`: mapping retrieved animation data onto the active rig

Recommended flow:

1. Load dataset items from `data/rag/animations/`
2. Build a query from prompt + semantic bone context
3. Retrieve top matching animation references
4. Map semantic bones from dataset to the active rig
5. Adapt or apply the retrieved animation to the editor timeline

# Project Beta — Conflict Visualization

#project #planned

## Overview

Project Beta explores how to visualize CRDT merge conflicts and edit history in the Obsidian editor. This is a stretch goal that depends on [[Projects/Project Alpha]] reaching M2.

## Ideas

- Timeline slider showing document state at any point in history
- Color-coded highlighting showing which user wrote each section
- "Blame" view similar to `git blame` but per-character via Yjs metadata

## Open Questions

- How much history does Yjs retain after garbage collection?
- Can we reconstruct per-user attribution from the Yjs update log?
- What's the performance impact of rendering attribution on large docs?

#research

# Brick Builder V3

A Next.js + React Three Fiber browser game prototype for building voxel/brick artworks.

## V3 implemented

- 1x1, 2x2 and 2x4 bricks
- 100-piece starter set
- grid snapping
- live ghost placement preview
- green valid / red blocked placement state
- simple stacking based on occupied footprint
- collision prevention
- select, move, rotate and delete
- keyboard controls
- undo / redo with history
- local draft persistence
- save modal with WebGL thumbnail capture
- responsive editor UI
- gallery navigation

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000/build`.

## Next phase

V4 should replace localStorage persistence with PostgreSQL + Vercel Blob, add real user accounts, views/likes and a dynamic public gallery. Solana wallet connection should remain optional and can be added after the core game loop is stable.

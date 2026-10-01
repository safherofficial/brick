# Real raster fixture sources

The regression suite uses real PNG/JPEG game-art bytes pinned to immutable source commits. It downloads those bytes during the test run, verifies their Git blob SHA, decodes them with a real raster decoder, and feeds the decoded RGBA raster through Brick's existing image-to-voxel importer.

| Fixture | Source | Pinned commit | Git blob SHA | License |
|---|---|---|---|---|
| `kenney_chest.png` | Kenney Cartography Pack | `3694c6879e487c108f55677be7dd2ca75b07cc3b` | `879a950aa77434e95d17385498bad4e2fc73c965` | CC0 |
| `kenney_character_wizard.png` — Kenney, Block Pack, source commit `3694c6879e487c108f55677be7dd2ca75b07cc3b`. Kenney assets are released under CC0.nney Brick Pack / Special | `3694c6879e487c108f55677be7dd2ca75b07cc3b` | `155df67042a9ec44852e8b2da5eba3e10dd287f3` | CC0 |
| `kenney_character_man.png` | Kenney Block Pack | `3694c6879e487c108f55677be7dd2ca75b07cc3b` | `5468d004c4fd1bc2dcce964721ec347e806ffebb` | CC0 |
| `cc0_bird.jpg` | 2D Assets / OpenGameArt collection | `e0cbe0d995554a490d4c182fe9beb8769ffbb606` | `19c136a88304d0375dbc8a4dc0de743c2f85e6d5` | CC0 |

No exporter, Unity scale/pivot, collider, socket, metadata, or output contract is changed by this fixture update.

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <div className="headerLeft">
          <Link href="/" className="backLink">
            VOXEL
          </Link>
          {editingTitle ? (
            <input
              className="titleInput"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingTitle(false);
              }}
            />
          ) : (
            <button className="titleEditBtn" onClick={() => setEditingTitle(true)}>
              <span className="creationTitle">{title}</span> EDIT
            </button>
          )}
        </div>
        <div className="builderActions">
          <button onClick={undo} disabled={!canUndo}>UNDO</button>
          <button onClick={redo} disabled={!canRedo}>REDO</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}>OPEN</button>
          <button onClick={() => exportFiles("json")}>PROJECT</button>
          <button onClick={() => exportFiles("vox")}>VOX</button>
          <button onClick={() => exportFiles("glb")}>GLB</button>
          <button onClick={() => exportFiles("obj")}>OBJ</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".png,.jpg,.jpeg,.webp,.vox,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void openProject(file);
            }}
          />
        </div>
      </header>

      <div className="builderBody voxelBody">
        <aside className="brickPanel">
          <p className="category">TOOLS</p>
          <div className="toolStack">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                className={tool === item.id ? "modeOn" : ""}
                onClick={() => setTool(item.id)}
              >
                {item.label} <small>{item.key}</small>
              </button>
            ))}
          </div>
          {tool === "box" && (
            <div className="viewRow">
              {(["fill", "erase", "select"] as BoxMode[]).map((mode) => (
                <button
                  key={mode}
                  className={boxMode === mode ? "modeOn" : ""}
                  onClick={() => setBoxMode(mode)}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <p className="category">BRUSH {brush}</p>
          <div className="viewRow">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={brush === n ? "modeOn" : ""} onClick={() => setBrush(n)}>
                {n}
              </button>
            ))}
          </div>
          <p className="category">MIRROR</p>
          <div className="viewRow">
            {(["x", "y", "z"] as const).map((axis) => (
              <button
                key={axis}
                className={mirror[axis] ? "modeOn" : ""}
                onClick={() => setMirror((m) => ({ ...m, [axis]: !m[axis] }))}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="category">VOLUME</p>
          <div className="viewRow">
            {SIZES.map((size) => (
              <button
                key={size}
                className={volume.size === size ? "modeOn" : ""}
                onClick={() => resize(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="toolStack">
            <button onClick={packVolume} disabled={!count}>FIT</button>
            <button onClick={() => applyNow(hollowCells(volumeRef.current), null, false)}>
              HOLLOW
            </button>
            <button onClick={clearAll}>CLEAR</button>
          </div>
        </aside>

        <section className="viewport">
          {/* Canvas + HUD + toast: lascia INVARIATO quello che hai già */}
        </section>

        <aside className="inspector">
          {/* VIEW / CLIP / IMAGE: lascia invariato */}
          <p className="category">PALETTE</p>
          <div className="colorRow dense">
            {palette.slice(0, 64).map((hex, i) => (
              <button
                key={i}
                className={color === i ? "swatchOn" : "swatch"}
                style={{ background: hex }}
                onClick={() => setColor(i)}
              />
            ))}
          </div>
          <input
            type="color"
            value={palette[color] ?? "#ffffff"}
            onChange={(e) => {
              const next = [...palette];
              next[color] = e.target.value;
              setPalette(next);
            }}
          />
          <p className="hint">
            {color}, {palette[color]}
          </p>
        </aside>
      </div>
    </main>
  );

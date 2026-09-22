"use client";
import type { RefObject } from "react";
import Link from "next/link";
import type { ExportMotion } from "@/components/builder/builderHelpers";
export type BuilderHeaderProps = {
  title: string;
  editingTitle: boolean;
  setTitle: (value: string) => void;
  setEditingTitle: (value: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  undo: () => void;
  redo: () => void;
  exportFiles: (
    kind: "json" | "vox" | "glb" | "obj" | "png" | "unity-pack"
  ) => void | Promise<void>;
  publish: () => void | Promise<void>;
  openProject: (file: File) => void | Promise<void>;
  attachFront: (file: File) => void | Promise<void>;
  attachSide: (file: File) => void | Promise<void>;
  fileRef: RefObject<HTMLInputElement | null>;
  frontRef: RefObject<HTMLInputElement | null>;
  sideRef: RefObject<HTMLInputElement | null>;
  exportMotion: ExportMotion;
  setExportMotion: (motion: ExportMotion) => void;
};
export function BuilderHeader({
  title,
  editingTitle,
  setTitle,
  setEditingTitle,
  canUndo,
  canRedo,
  busy,
  undo,
  redo,
  exportFiles,
  publish,
  openProject,
  attachFront,
  attachSide,
  fileRef,
  frontRef,
  sideRef,
  exportMotion,
  setExportMotion
}: BuilderHeaderProps) {
  return (
    <header className="builderHeader">
      <div className="headerLeft">
        <Link href="/" className="brand">
          <span className="brandMark">◆</span> VOXEL
        </Link>
      </div>
      <div className="creationTitle">
        {editingTitle ? (
          <input
            autoFocus
            className="titleInput"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditingTitle(false);
            }}
          />
        ) : (
          <>
            <span>{title}</span>
            <button className="titleEditBtn" onClick={() => setEditingTitle(true)}>
              EDIT
            </button>
          </>
        )}
      </div>
      <div className="builderActions">
        <button onClick={undo} disabled={!canUndo || busy}>
          UNDO
        </button>
        <button onClick={redo} disabled={!canRedo || busy}>
          REDO
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          OPEN
        </button>
        <button onClick={() => void exportFiles("json")} disabled={busy}>
          PROJECT
        </button>
        <button onClick={() => void exportFiles("vox")} disabled={busy}>
          VOX
        </button>
        <button
          className={exportMotion === "static" ? "modeOn" : ""}
          disabled={busy}
          onClick={() => setExportMotion("static")}
        >
          STATIC
        </button>
        <button
          className={exportMotion === "dynamic" ? "modeOn" : ""}
          disabled={busy}
          onClick={() => setExportMotion("dynamic")}
        >
          DYNAMIC
        </button>
        <button onClick={() => void exportFiles("glb")} disabled={busy}>
          {exportMotion === "dynamic" ? "GLB ANIM" : "GLB"}
        </button>
        <button onClick={() => void exportFiles("unity-pack")} disabled={busy}>
          {exportMotion === "dynamic" ? "UNITY ANIM" : "UNITY PACK"}
        </button>
        <button onClick={() => void exportFiles("png")} disabled={busy}>
          PNG
        </button>
        <button onClick={() => void exportFiles("obj")} disabled={busy}>
          OBJ
        </button>
        <button className="primaryButton" onClick={() => void publish()} disabled={busy}>
          PUBLISH
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.vox,.png,.jpg,.jpeg,.webp,application/json,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openProject(file);
            e.target.value = "";
          }}
        />
        <input
          ref={frontRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attachFront(file);
            e.target.value = "";
          }}
        />
        <input
          ref={sideRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attachSide(file);
            e.target.value = "";
          }}
        />
      </div>
    </header>
  );
}

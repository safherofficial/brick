import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VOXEL — PNG to game-ready voxels",
  description: "Drop a PNG. Export GLB, VOX or OBJ with a ground pivot."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

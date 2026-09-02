import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brick Builder",
  description: "Build anything, one brick at a time."
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
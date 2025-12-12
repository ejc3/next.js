import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Figma File Viewer",
  description: "Upload and render Figma files with component tree visualization",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

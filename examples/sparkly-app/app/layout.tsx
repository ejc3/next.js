import "./globals.css";

export const metadata = {
  title: "Sparkly App",
  description: "A sparkly Next.js application with beautiful sparkle effects",
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

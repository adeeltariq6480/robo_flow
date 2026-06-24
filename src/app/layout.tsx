import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Label AI",
  description: "AI-powered image labeling and dataset platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

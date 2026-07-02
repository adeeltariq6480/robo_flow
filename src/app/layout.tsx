import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axiom AI",
  description: "AI-powered image labeling and dataset platform by Axiom AI",
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

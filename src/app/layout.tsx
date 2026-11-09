import type { Metadata } from "next";
import { Manrope, Outfit } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";

import { hasClerkConfig } from "@/lib/auth/clerk";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Give Yourself a Raise",
  description:
    "Diagnosis-first spending analysis for finding the few discretionary levers worth cutting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = hasClerkConfig() ? <ClerkProvider>{children}</ClerkProvider> : children;

  return (
    <html
      lang="en"
      className={`${outfit.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{content}</body>
    </html>
  );
}

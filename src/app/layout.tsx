import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const title = "Overlay";
const description = "講義資料へのメモも、白紙への手書きも。ペン・テキスト・付箋で、普段のノートとして使えるPDFのーと。";

export const metadata: Metadata = {
  metadataBase: new URL("https://overlay-virid.vercel.app"),
  title,
  description,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "/",
    siteName: title,
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [{
      url: "/opengraph-image.png",
      alt: "Overlay（おーばーれい）— PDFに書き込むのーと。手描きうさぎのアイコン。",
    }],
  },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

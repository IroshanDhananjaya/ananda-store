import type { Metadata } from "next";
import { Geist_Mono, Inter, Roboto_Slab } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// Inter, the typeface Linear-style interfaces are set in
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headings on the goods order sheet, like Raigam's printed one; only that page uses it, so no preload
const robotoSlab = Roboto_Slab({
  variable: "--font-roboto-slab",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Ananda Stores",
    template: "%s · Ananda Stores",
  },
  description: "Manage incoming orders, stock, items and store locations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is changed by THEME_SCRIPT before React hydrates, so React keeps what's in the DOM
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${robotoSlab.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

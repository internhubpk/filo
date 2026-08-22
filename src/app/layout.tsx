import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: "Filo - AI Artifact Generation Platform",
    template: "%s | Filo",
  },
  description: "Transform your ideas into professional documents, spreadsheets, presentations, and more. Describe what you need. Filo creates it.",
  keywords: [
    "Filo", 
    "AI document generation", 
    "artifact creation", 
    "AI productivity", 
    "document automation",
    "business proposals",
    "presentations",
    "spreadsheets",
    "PDF generation",
    "DOCX generation",
  ],
  authors: [{ name: "Filo Team" }],
  creator: "Filo",
  publisher: "Filo",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://filo.app",
    siteName: "Filo",
    title: "Filo - AI Artifact Generation Platform",
    description: "Transform your ideas into professional documents, spreadsheets, presentations, and more with AI.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Filo - AI Artifact Generation Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Filo - AI Artifact Generation Platform",
    description: "Transform your ideas into professional documents, spreadsheets, and presentations.",
    images: ["/og-image.png"],
    creator: "@filoapp",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Filo" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ConvexClientProvider>
            {children}
            <Toaster />
          </ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

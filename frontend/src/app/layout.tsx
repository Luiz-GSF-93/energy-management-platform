import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Expert Energy",
  description: "Plataforma de Gestão de Energia",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <style>{`
          :root {
            --font-family: 'Inter', sans-serif;
          }
        `}</style>
      </head>
      <body className={`${inter.variable} bg-gray-950 text-white`}>
        {children}
      </body>
    </html>
  );
}

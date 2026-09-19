import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Houston Watch',
  description: 'Zillow listings from the Houston Watch Apify tasks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#011e30] text-white antialiased">{children}</body>
    </html>
  );
}

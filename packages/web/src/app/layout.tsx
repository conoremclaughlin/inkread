import type { Metadata } from 'next';
import './globals.css';
import { ElectronChrome } from '@/components/ElectronChrome';

export const metadata: Metadata = {
  title: 'inkread',
  description: 'Your library, readable everywhere — PDF to EPUB, listening, notes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#faf7f2] text-[#26221c] antialiased">
        <ElectronChrome />
        {children}
      </body>
    </html>
  );
}

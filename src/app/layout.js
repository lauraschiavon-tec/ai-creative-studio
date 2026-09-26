import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], variable: '--f-display', axes: ['opsz'] });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--f-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--f-mono' });

export const metadata = {
  title: 'ai-creative — estúdio criativo interno',
  description: 'Geração de imagens e vídeos para a equipe.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

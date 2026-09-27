import { Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--f-sans' });

export const metadata = {
  title: 'ai-creative — estúdio criativo interno',
  description: 'Geração de imagens e vídeos para a equipe.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}

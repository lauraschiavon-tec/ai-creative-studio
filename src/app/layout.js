import localFont from 'next/font/local';
import './globals.css';

// Fonte hospedada no repo (não next/font/google): o build do Docker roda sem
// acesso à internet e a busca ao Google Fonts falhava nesse passo.
const manrope = localFont({ src: './fonts/Manrope-Variable.ttf', variable: '--f-sans', weight: '200 800' });

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

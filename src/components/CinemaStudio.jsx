'use client';
import { useState } from 'react';
import Studio from './Studio';
import CameraControls from './CameraControls';
import { DEFAULT_CAMERA, NEGATIVE_PROMPT, buildCinemaPrompt } from '@/config/cinema';

// Cinema Studio = o mesmo Studio (modelos, uploads, custo, polling, histórico), com controles de câmera
// que são transformados no prompt. Nada de endpoints ou lógica duplicados.
export default function CinemaStudio() {
  const [kind, setKind] = useState('image');
  const [cam, setCam] = useState(DEFAULT_CAMERA);
  return (
    <>
      <div className="pagehead" style={{ marginBottom: 16 }}>
        <div className="chips">
          <button className={`chip ${kind === 'image' ? 'on' : ''}`} onClick={() => setKind('image')}>Cena em imagem</button>
          <button className={`chip ${kind === 'video' ? 'on' : ''}`} onClick={() => setKind('video')}>Cena em vídeo</button>
        </div>
        <span className="muted">Câmera, lente, distância focal e abertura viram o prompt da cena.</span>
      </div>
      <Studio
        key={kind}
        studio={kind}
        featuredFirst={kind === 'image' ? ['nano-banana-pro'] : ['kling-3-pro']}
        defaultParams={{ negative_prompt: NEGATIVE_PROMPT }}
        emptyTitle="O set está pronto."
        emptyText="Escolha câmera e lente, descreva a cena e clique em Gerar. O resultado aparece aqui, com custo e download."
        promptPlaceholder="Descreva a cena que você filmaria…"
        composePrompt={(base) => buildCinemaPrompt(base, cam, kind)}
        meta={{ _cinema: { ...cam, kind } }}
        beforePrompt={(prompt) => <CameraControls value={cam} onChange={setCam} kind={kind} basePrompt={prompt} />}
      />
    </>
  );
}

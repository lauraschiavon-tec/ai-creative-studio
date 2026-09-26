'use client';
import { useRef, useState } from 'react';

const ACCEPT = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/quicktime,video/webm',
  audio: 'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg',
};
const HINT = {
  image: 'PNG, JPG ou WebP · até 10 MB',
  video: 'MP4, MOV ou WebM · até 50 MB',
  audio: 'MP3, WAV, M4A, AAC ou OGG · até 25 MB',
};
const NOUN = { image: 'imagem', video: 'vídeo', audio: 'áudio' };
// Nomes técnicos dos campos da MuAPI → rótulos legíveis.
const TITLES = {
  image_url: 'Imagem', images_list: 'Imagens de referência', image_urls: 'Imagens de referência', reference_images: 'Imagens de referência',
  last_image: 'Último quadro', last_image_url: 'Último quadro', end_image_url: 'Imagem final', first_frame_url: 'Primeiro quadro', last_frame_url: 'Último quadro',
  start_image_url: 'Primeiro quadro', mask_url: 'Máscara', mask_image_url: 'Máscara', watermark_image_url: 'Marca d’água', model_image_url: 'Foto do modelo',
  person_image_url: 'Foto da pessoa', garment_image_url: 'Peça de roupa', product_image_url: 'Produto',
  video_url: 'Vídeo', videos_list: 'Vídeos de referência', video_files: 'Vídeos de referência', video_urls: 'Vídeos', reference_videos: 'Vídeos de referência', reference_video_url: 'Vídeo de referência',
  audio_url: 'Áudio', audios_list: 'Áudios', audio_files: 'Áudios', reference_audios: 'Áudios de referência',
};

// Upload de uma mídia de referência (imagem, vídeo ou áudio) para um campo declarado pelo modelo.
export default function MediaField({ def, files, onChange, onError, showRequired = true }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const max = def.array ? def.maxItems || 10 : 1;
  const title = TITLES[def.name] || def.title;

  async function upload(list) {
    onError('');
    setBusy(true);
    let current = files;
    try {
      for (const file of Array.from(list)) {
        if (current.length >= max) { onError(`"${title}" aceita no máximo ${max} arquivo(s).`); break; }
        const fd = new FormData(); fd.append('file', file); fd.append('kind', def.kind);
        const res = await fetch('/api/uploads', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Falha no envio.');
        current = [...current, data];
        onChange(current);
      }
    } catch (e) { onError(e.message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  }

  return (
    <div>
      <div className="lbl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {title}{' '}
        <span className="muted" style={{ fontWeight: 400 }}>
          ({files.length}/{max}){showRequired && def.required ? ' · obrigatório' : ' · opcional'}
        </span>
      </div>
      {files.length < max && (
        <div className="drop" onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
          {busy ? 'Enviando…' : `Clique ou arraste ${def.kind === 'audio' ? 'um' : 'um(a)'} ${NOUN[def.kind]} · ${HINT[def.kind]}`}
        </div>
      )}
      <input ref={ref} type="file" accept={ACCEPT[def.kind]} multiple={max > 1} hidden onChange={(e) => upload(e.target.files)} />
      {def.description && <div className="hint">{def.description}</div>}
      {!!files.length && (
        <div className="thumbs">
          {files.map((f) => (
            <div className={`thumb ${def.kind !== 'image' ? 'wide' : ''}`} key={f.path}>
              {def.kind === 'image' && <img src={f.previewUrl} alt={f.name} />}
              {def.kind === 'video' && <video src={f.previewUrl} muted preload="metadata" />}
              {def.kind === 'audio' && <div className="audio-chip"><span>♪</span><small>{f.name}</small></div>}
              <button aria-label="Remover" onClick={() => onChange(files.filter((x) => x.path !== f.path))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import MediaField from './MediaField';
import ModelPicker from './gen/ModelPicker';
import ParamsForm from './gen/ParamsForm';
import ResultPanel from './gen/ResultPanel';
import CostBar from './gen/CostBar';
import { carryParams } from './gen/params';
import { api, useGeneration, useEstimate } from './gen/useGeneration';
import { usd } from './format';

const INPUTS = [['image', 'Imagem / avatar'], ['video', 'Vídeo (dublagem)'], ['all', 'Todos']];
const subjectKind = (m) => m.media.find((d) => d.kind !== 'audio')?.kind || null;

// Lip Sync: simplifica os endpoints de lip sync do catálogo de vídeo.
// Voz por áudio enviado OU por texto (gera a voz com um modelo TTS e usa o resultado como áudio do lip sync).
export default function LipSyncStudio() {
  const [videoCat, setVideoCat] = useState(null);
  const [ttsCat, setTtsCat] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [inputKind, setInputKind] = useState('image');
  const [modelId, setModelId] = useState(null);
  const [search, setSearch] = useState('');
  const [media, setMedia] = useState({});
  const [voiceMode, setVoiceMode] = useState('audio'); // 'audio' | 'text'
  const [script, setScript] = useState('');
  const [ttsId, setTtsId] = useState(null);
  const [ttsParams, setTtsParams] = useState({});
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState({});
  const tts = useGeneration();
  const lip = useGeneration();

  useEffect(() => {
    api('/api/catalog?studio=video').then((d) => setVideoCat(d.models.filter((m) => m.mode === 'lipsync'))).catch((e) => setLoadError(e.message));
    api('/api/catalog?studio=audio').then((d) => setTtsCat(d.models.filter((m) => !m.limited))).catch(() => setTtsCat([]));
  }, []);

  const list = useMemo(() => (videoCat || []).filter((m) => inputKind === 'all' || subjectKind(m) === inputKind), [videoCat, inputKind]);
  const model = list.find((m) => m.id === modelId) || list[0] || null;
  const ttsModel = (ttsCat || []).find((m) => m.id === ttsId) || (ttsCat || [])[0] || null;

  const audioDef = model?.media.find((d) => d.kind === 'audio') || null;
  const otherDefs = (model?.media || []).filter((d) => d.kind !== 'audio');
  const usesText = !!audioDef && voiceMode === 'text' && !!ttsModel;

  const mk = model?.id;
  useEffect(() => { if (model) setParams((p) => carryParams(p, model)); }, [mk]); // eslint-disable-line react-hooks/exhaustive-deps
  const tk = ttsModel?.id;
  useEffect(() => { if (ttsModel) setTtsParams((p) => carryParams(p, ttsModel)); }, [tk]); // eslint-disable-line react-hooks/exhaustive-deps

  const estLip = useEstimate('video', model, params, prompt);
  const estTts = useEstimate('audio', usesText ? ttsModel : null, ttsParams, script);
  const parts = usesText ? [estLip, estTts] : [estLip];
  const estimate = parts.some((p) => p === null) ? null : parts.every((p) => p.available) ? { available: true, usd: parts.reduce((s, p) => s + p.usd, 0) } : { available: false };

  const filesOf = (d) => media[d.name] || [];
  const missingTtsField = usesText && Object.values(ttsModel.inputs).some((d) => d.required && (ttsParams[d.name] === undefined || ttsParams[d.name] === ''));
  const missing = !model
    || model.media.some((d) => d.required && !(d.kind === 'audio' && usesText) && !filesOf(d).length)
    || (model.needsMedia && !model.media.some((d) => filesOf(d).length))
    || (usesText && (!script.trim() || missingTtsField))
    || (model.hasPrompt && model.promptRequired && !prompt.trim());
  const busy = tts.busy || lip.busy;

  async function generate() {
    let audioGenId;
    if (usesText) {
      const t = await tts.run({ studio: 'audio', catalogId: ttsModel.id, prompt: script, params: ttsParams });
      if (!t || t.status !== 'completed') return;
      audioGenId = t.id;
    }
    const sent = {};
    for (const d of model.media) if (!(d.kind === 'audio' && usesText) && filesOf(d).length) sent[d.name] = filesOf(d).map((f) => f.path);
    await lip.run({ studio: 'video', catalogId: model.id, prompt, params, media: sent, ...(usesText ? { fromGenerations: { [audioDef.name]: audioGenId } } : {}) });
  }

  if (loadError) return <div className="alert">{loadError}</div>;
  if (!videoCat) return <p className="muted">Carregando modelos…</p>;

  // Resultado: enquanto a voz é gerada mostra o andamento dela; depois, o do vídeo.
  let shown = lip.gen;
  if (!shown && busy) shown = tts.gen && tts.gen.status !== 'completed' ? tts.gen : { status: 'processing', model_name: model?.name };
  if (!shown && !busy && tts.gen?.status === 'failed') shown = tts.gen;
  const phase = tts.busy ? 'Gerando a voz…' : lip.busy ? 'Animando…' : undefined;
  const ttsCost = usesText && tts.gen?.status === 'completed' && lip.gen?.status === 'completed' ? `Voz (${tts.gen.model_name}): ${usd(tts.gen.cost_usd)}` : null;
  const error = lip.error || tts.error;
  const session = { usd: tts.sessionCost.usd + lip.sessionCost.usd, credits: tts.sessionCost.credits + lip.sessionCost.credits, n: lip.sessionCost.n };

  return (
    <div className="studio">
      <div className="panel panel-pad stack">
        <section>
          <h3 className="step"><b>1</b> O que animar</h3>
          <div className="chips">{INPUTS.map(([k, l]) => <button key={k} className={`chip ${inputKind === k ? 'on' : ''}`} onClick={() => { setInputKind(k); setSearch(''); }}>{l}</button>)}</div>
          <p className="hint">Imagem/avatar: o personagem da foto passa a falar. Vídeo: a boca do vídeo é ajustada ao novo áudio.</p>
        </section>

        <section>
          <h3 className="step"><b>2</b> Modelo</h3>
          <ModelPicker models={list} search={search} onSearch={setSearch} activeModelId={model?.id} onPickModel={setModelId}
            tag={inputKind === 'all' ? (m) => (subjectKind(m) === 'video' ? 'vídeo' : 'imagem') : undefined} placeholder="Buscar modelo (Kling, OmniHuman, Sync…)" />
          {!list.length && <p className="hint">Nenhum modelo para este tipo de entrada.</p>}
        </section>

        {model && (
          <section className="stack">
            <h3 className="step"><b>3</b> Personagem e voz</h3>
            {otherDefs.map((d) => (
              <MediaField key={d.name} def={d} files={filesOf(d)} onError={lip.setError} onChange={(l) => setMedia((m) => ({ ...m, [d.name]: l }))} />
            ))}

            {audioDef && (
              <div className="stack" style={{ '--gap': '12px' }}>
                <div className="chips">
                  <button className={`chip ${voiceMode === 'audio' ? 'on' : ''}`} onClick={() => setVoiceMode('audio')}>Enviar áudio</button>
                  <button className={`chip ${voiceMode === 'text' ? 'on' : ''}`} onClick={() => setVoiceMode('text')} disabled={!ttsModel}>Escrever texto (gera a voz)</button>
                </div>
                {voiceMode === 'audio' && (
                  <MediaField def={audioDef} files={filesOf(audioDef)} onError={lip.setError} onChange={(l) => setMedia((m) => ({ ...m, [audioDef.name]: l }))} />
                )}
                {usesText && (
                  <>
                    <label className="field"><span className="lbl">Voz gerada por</span>
                      <select value={ttsModel.id} onChange={(e) => setTtsId(e.target.value)}>
                        {ttsCat.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.provider}</option>)}
                      </select></label>
                    <label className="field"><span className="lbl">Texto que será falado</span>
                      <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder="Escreva a fala do personagem…" /></label>
                    <ParamsForm model={ttsModel} params={ttsParams} setParams={setTtsParams} />
                    <p className="hint">Gera a voz primeiro e usa esse áudio no lip sync. São duas gerações (cada uma aparece no Histórico e nos custos).</p>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {model && (
          <section className="stack">
            <h3 className="step"><b>4</b> Ajustes</h3>
            {model.hasPrompt && (
              <label className="field"><span className="lbl">Prompt {!model.promptRequired && <span>opcional</span>}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descreva emoção, gestos ou cenário (opcional)…" /></label>
            )}
            <ParamsForm model={model} params={params} setParams={setParams} />
          </section>
        )}

        <hr className="rule" />
        <section className="stack">
          <CostBar estimate={estimate} label={usesText ? 'Custo estimado (voz + vídeo)' : 'Custo estimado'} />
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn primary block" disabled={missing || busy} onClick={generate}>{busy ? (tts.busy ? 'Gerando a voz…' : 'Animando…') : 'Gerar'}</button>
        </section>
      </div>

      <ResultPanel gen={shown} sessionCost={session} phase={phase} extraCost={ttsCost}
        emptyTitle="Ninguém falando ainda."
        emptyText="Escolha a imagem ou vídeo, envie o áudio (ou escreva o texto) e clique em Gerar. O resultado aparece aqui, com custo e download."
        note="Pode levar alguns minutos. Pode sair: o resultado fica no Histórico." />
    </div>
  );
}

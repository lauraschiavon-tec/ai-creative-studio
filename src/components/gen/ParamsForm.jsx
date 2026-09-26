'use client';
import { useMemo } from 'react';
import ParamField from '../ParamField';
import { PRIMARY } from '../format';

// Parâmetros do modelo (do schema da MuAPI): principais visíveis, o resto em "Opções avançadas".
export default function ParamsForm({ model, params, setParams, skip }) {
  const { main, adv } = useMemo(() => {
    const all = Object.entries(model?.inputs || {}).filter(([k]) => !(skip || []).includes(k));
    return { main: all.filter(([k]) => PRIMARY.includes(k)), adv: all.filter(([k]) => !PRIMARY.includes(k)) };
  }, [model, skip]);
  const field = ([k, def]) => <ParamField key={k} name={k} def={def} value={params[k]} onChange={(v) => setParams((p) => ({ ...p, [k]: v }))} />;
  return (
    <>
      {main.map(field)}
      {!!adv.length && <details className="adv"><summary>Opções avançadas ({adv.length})</summary><div className="stack">{adv.map(field)}</div></details>}
    </>
  );
}

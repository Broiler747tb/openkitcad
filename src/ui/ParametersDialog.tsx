import { useEffect, useRef, useState } from 'react'
import { newId, useStore } from '../doc/store'
import { parameterFields, resolveParameters } from '../doc/parameters'

export function ParametersDialog({onClose}:{onClose:()=>void}) {
  const state=useStore(),ref=useRef<HTMLDialogElement>(null)
  const [parameters,setParameters]=useState(()=>structuredClone(state.doc.parameters))
  const [bindings,setBindings]=useState(()=>structuredClone(state.doc.bindings??[]))
  const [failure,setFailure]=useState('')
  useEffect(()=>{ref.current?.showModal()},[])
  const targets=state.doc.bodies.flatMap(body=>body.features.flatMap(feature=>parameterFields(feature).map(field=>({body,feature,field,key:`${body.id}/${feature.id}/${field}`}))))
  const preview=structuredClone(state.doc);preview.parameters=structuredClone(parameters);preview.bindings=bindings
  let error=''
  try{resolveParameters(preview)}catch(e){error=(e as Error).message}
  const add=()=>{let name='parameter_1',i=1;while(parameters.some(p=>p.name===name))name=`parameter_${++i}`;setParameters([...parameters,{id:newId('param'),name,value:10,expression:'10'}])}
  return <dialog ref={ref} className="parameters-dialog" onCancel={onClose} onKeyDown={e=>e.stopPropagation()} aria-label="User parameters">
    <header className="dialog-heading"><h2>User parameters · fx</h2><button onClick={onClose} aria-label="Close parameters">×</button></header>
    <p>Persistent scalar formulas. Parameters use model millimetres; angle links interpret values as degrees. No dimensional unit analysis.</p>
    <h3>Parameter table</h3><div className="parameter-table"><div className="parameter-row"><b>Name</b><b>Expression</b><b>Value</b><b>Comment</b><span/></div>
      {parameters.map((p,index)=><div className="parameter-row" key={p.id}>
        <input aria-label={`Parameter ${index+1} name`} value={p.name} onChange={e=>setParameters(parameters.map(q=>q.id===p.id?{...q,name:e.target.value}:q))}/>
        <input aria-label={`Parameter ${index+1} expression`} value={p.expression??String(p.value)} onChange={e=>setParameters(parameters.map(q=>q.id===p.id?{...q,expression:e.target.value}:q))}/>
        <output>{error?'—':preview.parameters[index].value.toLocaleString(undefined,{maximumFractionDigits:6})}</output>
        <input aria-label={`Parameter ${index+1} comment`} value={p.comment??''} onChange={e=>setParameters(parameters.map(q=>q.id===p.id?{...q,comment:e.target.value}:q))}/>
        <button aria-label={`Remove parameter ${p.name}`} onClick={()=>setParameters(parameters.filter(q=>q.id!==p.id))}>×</button>
      </div>)}
    </div><button onClick={add}>Add parameter</button>
    <p className="hint">Examples: width = 80; depth = width/2; wall = 3mm. Lowercase names. + − * /, parentheses, pi, mm/cm/m/in. References may point to later rows. Rename referenced names in formulas too.</p>
    <h3>Linked feature dimensions</h3><p className="hint">Numeric edits in Properties detach that field's link. Unlink keeps its last applied value.</p>
    {bindings.map((b,index)=><div className="binding-row" key={index}>
      <select aria-label={`Link ${index+1} target`} value={`${b.bodyId}/${b.featureId}/${b.field}`} onChange={e=>{const t=targets.find(t=>t.key===e.target.value)!;setBindings(bindings.map((q,i)=>i===index?{...q,bodyId:t.body.id,featureId:t.feature.id,field:t.field}:q))}}>
        {targets.map(t=><option key={t.key} value={t.key}>{t.body.name} / {t.feature.name} / {t.field}</option>)}
      </select><input aria-label={`Link ${index+1} expression`} value={b.expression} onChange={e=>setBindings(bindings.map((q,i)=>i===index?{...q,expression:e.target.value}:q))}/>
      <button onClick={()=>setBindings(bindings.filter((_,i)=>i!==index))}>Unlink</button>
    </div>)}
    <button disabled={!targets.length} onClick={()=>{const t=targets.find(t=>!bindings.some(b=>b.bodyId===t.body.id&&b.featureId===t.feature.id&&b.field===t.field));if(t)setBindings([...bindings,{bodyId:t.body.id,featureId:t.feature.id,field:t.field,expression:parameters[0]?.name??'10'}])}}>Link dimension</button>
    {!targets.length&&<p>Create a solid feature first, then link its dimensions here.</p>}
    {(error||failure)&&<p role="alert" className="problem">{error||failure}</p>}
    <footer className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="primary-button" disabled={!!error} onClick={()=>{
      try{state.commit(d=>{d.parameters=structuredClone(parameters);d.bindings=structuredClone(bindings)});onClose()}catch(e){setFailure((e as Error).message)}
    }}>Apply & rebuild</button></footer>
  </dialog>
}

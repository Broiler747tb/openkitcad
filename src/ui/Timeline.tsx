import { useStore } from '../doc/store'
import { FEATURE_ICON, FEATURE_LABEL } from '../doc/types'
import { GridSettings } from './PrecisionTools'

export function Timeline({onEdit}:{onEdit:()=>void}) {
  const state=useStore()
  const selected=state.doc.bodies.flatMap(body=>body.features.map(feature=>({body,feature}))).find(x=>x.feature.id===state.selection.id)
  function edit() { if(!selected)return; if(selected.feature.kind==='sketch')state.openSketch(selected.body.id,selected.feature.id);else onEdit() }
  return <section className="design-timeline" aria-label="Feature timeline">
    <div className="timeline-label">TIMELINE<small>Body histories</small></div>
    <div className="timeline-track" role="toolbar" aria-label="Modelling features" onKeyDown={e=>{
      if(!['ArrowLeft','ArrowRight'].includes(e.key))return
      const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
      const i=buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowRight'?1:-1)))]?.focus();e.preventDefault()
    }}>
      {state.doc.bodies.map(body=><div className="timeline-body" key={body.id}><span>{body.name}</span>{body.features.map((f,i)=><button key={f.id} className={'timeline-feature '+(state.selection.id===f.id?'selected ':'')+(f.suppressed?'suppressed ':'')+(state.errors.some(e=>e.featureId===f.id)?'failed':'')} aria-label={`${body.name}: ${f.name||FEATURE_LABEL[f.kind]} ${i+1}`} aria-pressed={state.selection.id===f.id} title={`${body.name} · ${f.name||FEATURE_LABEL[f.kind]}${f.suppressed?' (suppressed)':''}\nDouble-click to edit`} onClick={()=>state.select({kind:'feature',bodyId:body.id,id:f.id})} onDoubleClick={()=>{state.select({kind:'feature',bodyId:body.id,id:f.id});if(f.kind==='sketch')state.openSketch(body.id,f.id);else onEdit()}}><span>{FEATURE_ICON[f.kind]}</span><small>{i+1}</small></button>)}</div>)}
      {!state.doc.bodies.length&&<span className="timeline-empty">Create a sketch or solid to begin feature history.</span>}
    </div>
    <div className="timeline-actions"><button disabled={!selected||!!state.activeSketch} onClick={edit}>Edit feature</button><button disabled={!selected||!!state.activeSketch} onClick={()=>selected&&state.updateFeature(selected.body.id,selected.feature.id,{suppressed:!selected.feature.suppressed})}>{selected?.feature.suppressed?'Unsuppress':'Suppress'}</button></div>
  </section>
}

export function NavigationBar() {
  const state=useStore()
  return <div className="navigation-bar" aria-label="View navigation"><button title="Home view" onClick={()=>window.dispatchEvent(new CustomEvent('okc:view',{detail:'iso'}))}>⌂</button><button title="Fit view (Home)" onClick={()=>window.dispatchEvent(new CustomEvent('okc:fit'))}>⤢ Fit</button><GridSettings/><button aria-pressed={state.section.enabled} onClick={()=>state.setSection({enabled:!state.section.enabled})}>Section</button></div>
}

import { useState } from 'react'
import { usePreferences, type Preferences } from '../doc/preferences'
import { activeSketchFeature, useStore } from '../doc/store'
import { sketchActions } from '../sketch/actions'
import { chooseSketchAction } from './ActionDialog'
import { quantity } from '../core/quantity'

export function GridSettings() {
  const {values:p,set,reset}=usePreferences()
  const [open,setOpen]=useState(false)
  const check=(key:keyof Preferences,label:string)=><label className="precision-check"><input type="checkbox" checked={Boolean(p[key])} onChange={e=>set({[key]:e.target.checked})}/>{label}</label>
  return <div className="grid-controls" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')setOpen(false)}}>
    <button aria-pressed={p.gridVisible} title="Show grid" onClick={()=>set({gridVisible:!p.gridVisible})}>▦ Grid</button>
    <button aria-pressed={p.snapGrid} title="Snap to grid (Alt temporarily disables snapping)" onClick={()=>set({snapGrid:!p.snapGrid})}>⌖ Snap {p.gridStep} mm</button>
    <button aria-expanded={open} onClick={()=>setOpen(!open)}>Grid settings</button>
    {open&&<section className="grid-settings" aria-label="Grid and snapping settings"><div className="dialog-heading"><h3>Grid & precision</h3><button aria-label="Close grid settings" onClick={()=>setOpen(false)}>×</button></div>
      <div className="precision-presets">{[0.1,0.5,1,5,10].map(step=><button key={step} onClick={()=>set({gridStep:step})}>{step} mm</button>)}</div>
      <Setting label="Grid spacing (mm)" value={p.gridStep} min={0.01} max={1000} onChange={gridStep=>set({gridStep})}/>
      <Setting label="Grid extent (mm)" value={p.gridExtent} min={10} max={10000} onChange={gridExtent=>set({gridExtent})}/>
      <Setting label="Major line every" value={p.majorEvery} min={2} max={20} onChange={majorEvery=>set({majorEvery})}/>
      <label className="precision-check">Grid contrast<input aria-label="Grid contrast" type="range" min="0.05" max="1" step="0.05" value={p.gridOpacity} onChange={e=>set({gridOpacity:Number(e.target.value)})}/></label>
      {check('gridVisible','Show grid')}{check('axesVisible','Show axes')}{check('snapGrid','Snap to grid')}{check('snapGeometry','Snap to endpoints / centres')}{check('snapMidpoints','Snap to midpoints')}{check('snapEdges','Snap to edges')}{check('snapAlignment','Infer horizontal / vertical')}
      <Setting label="Snap radius (pixels)" value={p.snapRadius} min={2} max={40} onChange={snapRadius=>set({snapRadius})}/>
      <Setting label="Gizmo move step (mm; 0 = free)" value={p.moveSnap} min={0} max={1000} onChange={moveSnap=>set({moveSnap})}/>
      <Setting label="Gizmo angle step (°; 0 = free)" value={p.angleSnap} min={0} max={180} onChange={angleSnap=>set({angleSnap})}/>
      <p className="hint">Grid follows the active sketch plane. Geometry snaps take priority over the grid. Hold Alt for free placement. Dimensions and constraints still take priority when dragging.</p>
      {p.gridExtent/p.gridStep>400&&<p className="hint">Some grid lines are hidden at this density; the snapping interval is unchanged.</p>}
      <button className="tb" onClick={reset}>Reset defaults</button><small>Saved locally, independently of your design.</small>
    </section>}
  </div>
}
function Setting({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(v:number)=>void}) {
  return <label className="precision-number"><span>{label}</span><input key={value} aria-label={label} type="number" step="any" min={min} max={max} defaultValue={value} onBlur={e=>{const n=Number(e.target.value);if(e.target.value.trim()&&Number.isFinite(n)&&n>=min&&n<=max)onChange(n);else e.target.value=String(value)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}}}/></label>
}

export function PrecisionSketchTools() {
  const state=useStore()
  const [x,setX]=useState('0'),[y,setY]=useState('0'),[relative,setRelative]=useState(false)
  const [polar,setPolar]=useState(false)
  const sketch=activeSketchFeature(state)
  if(!sketch)return null
  let px=0,py=0,valid=true
  try {const a=quantity(x,'mm'),b=quantity(y,polar?'°':'mm');px=polar?a*Math.cos(b*Math.PI/180):a;py=polar?a*Math.sin(b*Math.PI/180):b}catch{valid=false}
  const drawing=['line','rectangle','circle','arc'].includes(state.tool)
  const actions=sketchActions(sketch.sketch,state.sketchSelection,[px,py])
  return <section className="section precision-sketch"><h3>Precision construction</h3>
    <label>Coordinates<select value={polar?'polar':'cartesian'} onChange={e=>{setPolar(e.target.value==='polar');setX('0');setY('0')}}><option value="cartesian">Cartesian X / Y</option><option value="polar">Polar distance / angle</option></select></label>
    <form onSubmit={e=>{e.preventDefault();if(valid&&drawing)window.dispatchEvent(new CustomEvent('okc:coordinate',{detail:{x:px,y:py,relative}}))}}>
      <div className="coordinate-row"><label>{polar?'Distance (mm)':'X'} <input aria-label="Sketch X" type="text" required value={x} onChange={e=>setX(e.target.value)}/></label><label>{polar?'Angle (°)':'Y'} <input aria-label="Sketch Y" type="text" required value={y} onChange={e=>setY(e.target.value)}/></label></div>
      {!valid&&<p role="alert">Enter valid numbers or expressions with compatible units.</p>}
      <label className="precision-check"><input type="checkbox" checked={relative} onChange={e=>setRelative(e.target.checked)}/>Relative to previous drawing point</label>
      <button className="btn" disabled={!valid||!drawing}>Place exact point</button>
      <p className="hint">Choose Line, Rectangle, Circle or Arc. Coordinates are in the sketch plane, in mm; exact input bypasses snapping.</p>
    </form>
    <div className="precision-presets">{actions.filter(a=>['add-polygon','add-slot','linear-pattern','circular-pattern','mirror-vertical','mirror-horizontal'].includes(a.id)).map(a=><button key={a.id} disabled={!valid} onClick={()=>chooseSketchAction(a)}>{({'add-polygon':'Polygon at X/Y','add-slot':'Slot at X/Y','linear-pattern':'Linear pattern','circular-pattern':'Circular pattern','mirror-vertical':'Mirror X','mirror-horizontal':'Mirror Y'} as Record<string,string>)[a.id]}</button>)}</div>
    <p className="hint">Polygon and slot use absolute X/Y as their centre. Select edges to access patterns and mirrors.</p>
    <button className="btn" onClick={()=>state.setSketchSelection(sketch.sketch.entities.map(e=>({kind:'entity' as const,id:e.id})))}>Select all sketch geometry</button>
  </section>
}

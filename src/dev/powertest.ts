import { quantity } from '../core/quantity'
import { emptySketch } from '../sketch/types'
import { addExactShape, copyTransformed, setFixed, deleteGeometry, geometryLength, cleanUnusedPoints } from '../sketch/power'
import { activeSketchFeature, useStore } from '../doc/store'
import { emptyDocument } from '../doc/types'
import { powerActions } from '../ui/PowerTools'

export function runPowerTest() {
  const results:Array<{name:string;pass:boolean;detail:string}>=[]
  const check=(name:string,pass:boolean)=>results.push({name:'Workshop: '+name,pass,detail:pass?'passed':'unexpected result'})
  const throws=(fn:()=>unknown)=>{try{fn();return false}catch{return true}}
  const near=(a:number,b:number)=>Math.abs(a-b)<1e-8
  check('arithmetic precedence',quantity('2+3*4')===14)
  check('parentheses and unary signs',quantity('-(2+3)*-4')===20)
  check('inch conversion',near(quantity('2in + 5mm','mm'),55.8))
  check('metric conversion',quantity('1m + 2cm','mm')===1020)
  check('radians to degrees',near(quantity('(pi/2)rad','°'),90))
  check('scientific notation',quantity('1e-3')===0.001)
  check('reject division by zero',throws(()=>quantity('1/0')))
  check('reject mismatched units',throws(()=>quantity('1in','°')))
  check('reject executable expressions',throws(()=>quantity('window.alert(1)')))
  check('reject empty and overflow',throws(()=>quantity(''))&&throws(()=>quantity('1e999')))
  let counter=0
  const id=(prefix:string)=>`${prefix}-${++counter}`
  const s=emptySketch(), rect=addExactShape(s,'rectangle',[10,20],30,10,90,id)
  check('rectangle shares four vertices',s.points.length===5&&rect.length===4)
  check('rectangle exact perimeter',near(geometryLength(s,rect),80))
  check('rotated rectangle location',near(s.points[1].x,15)&&near(s.points[1].y,5))
  check('exact geometry is fixed',s.constraints.filter(c=>c.kind==='fix').length===5)
  const original=JSON.stringify(s),constraintCount=s.constraints.length
  const copies=copyTransformed(s,rect,{dx:40,dy:0,angle:0,scale:1,centre:[0,0],count:3},id)
  check('array count excludes originals',copies.length===12&&s.entities.length===16)
  check('copies share corners internally',s.points.length===17)
  check('copies do not inherit constraints',s.constraints.length===constraintCount)
  const prior=JSON.parse(original)
  check('original geometry unchanged',JSON.stringify(s.points.slice(0,5))===JSON.stringify(prior.points))
  check('array last step',near(s.points[13].x,135))
  check('reject fractional copy count',throws(()=>copyTransformed(s,rect,{dx:0,dy:0,angle:0,scale:1,centre:[0,0],count:1.5},id)))
  check('reject negative scale',throws(()=>copyTransformed(s,rect,{dx:0,dy:0,angle:0,scale:-1,centre:[0,0],count:1},id)))
  const ring=addExactShape(s,'ring',[0,0],20,10,0,id)
  check('ring has two concentric circles',s.entities.filter(e=>ring.includes(e.id)&&e.kind==='circle').length===2)
  check('ring total circumference',near(geometryLength(s,ring),30*Math.PI))
  check('reject inverted ring',throws(()=>addExactShape(s,'ring',[0,0],10,20,0,id)))
  const scaled=copyTransformed(s,ring,{dx:0,dy:0,angle:0,scale:2,centre:[0,0],count:1},id)
  check('scale copies circle radii',near(geometryLength(s,scaled),60*Math.PI))
  setFixed(s,rect,false,id)
  check('unfix keeps origin pinned',s.constraints.some(c=>c.kind==='fix'&&c.p==='origin'))
  setFixed(s,rect,true,id)
  setFixed(s,rect,true,id)
  check('fix is idempotent',s.constraints.filter(c=>c.kind==='fix'&&c.p===s.points[1].id).length===1)
  deleteGeometry(s,copies)
  check('batch delete removes every selected edge',!s.entities.some(e=>copies.includes(e.id)))
  s.points.push({id:'unused',x:1,y:2});cleanUnusedPoints(s)
  check('cleanup removes orphan point',!s.points.some(p=>p.id==='unused'))
  const arc=emptySketch()
  arc.points.push({id:'c',x:0,y:0},{id:'a',x:10,y:0},{id:'b',x:0,y:10})
  arc.entities.push({id:'arc',kind:'arc',c:'c',p1:'a',p2:'b',ccw:true,construction:false})
  const rotated=copyTransformed(arc,['arc'],{dx:0,dy:0,angle:90,scale:1,centre:[0,0],count:1},id)
  check('arc copies preserve sweep and length',near(geometryLength(arc,rotated),5*Math.PI))

  const saved=useStore.getState()
  try {
    useStore.setState({rebuild:()=>{},doc:emptyDocument(),past:[],future:[],selection:{kind:'none'},activeSketch:null,sketchSelection:[],shapes:[]})
    useStore.getState().startSketch({kind:'named',name:'XY',offset:0})
    const before=useStore.getState().past.length
    powerActions().find(a=>a.id==='exact-ring')!.run(20,10)
    check('create exact ring is one Undo step',useStore.getState().past.length===before+1)
    check('new geometry is selected',useStore.getState().sketchSelection.length===2)
    useStore.getState().undo()
    check('Undo removes full operation',activeSketchFeature(useStore.getState())!.sketch.entities.length===0)
    useStore.getState().redo()
    check('Redo restores full operation',activeSketchFeature(useStore.getState())!.sketch.entities.length===2)
    const stateBefore=JSON.stringify(useStore.getState().doc),pastBefore=useStore.getState().past.length
    check('invalid operation rejects',throws(()=>powerActions().find(a=>a.id==='exact-ring')!.run(5,20)))
    check('invalid operation leaves document and Undo untouched',stateBefore===JSON.stringify(useStore.getState().doc)&&pastBefore===useStore.getState().past.length)
  }finally {useStore.setState(saved,true)}
  return results
}

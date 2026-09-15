import { useStore } from '../doc/store'
import { emptyDocument } from '../doc/types'
import { objectActions } from '../ui/ObjectMenu'
import { createSketchAction, resolveCommand, toggleVisibility } from '../ui/fusionCommands'

/** Runs only on the isolated self-test page, never against an open design. */
export function runWorkflowTest() {
  const saved=useStore.getState()
  const results:Array<{name:string;pass:boolean;detail:string}>=[]
  const check=(name:string,pass:boolean)=>results.push({name:'Fusion workflow: '+name,pass,detail:pass?'passed':'unexpected state'})
  try {
    useStore.setState({rebuild:()=>{},doc:emptyDocument(),past:[],future:[],selection:{kind:'none'},activeSketch:null,subSelection:[],sketchSelection:[],shapes:[]})
    check('Fillet waits for selection',resolveCommand('fillet')===null)
    objectActions({kind:'none'}).find(a=>a.id==='add-box')!.run(40,30,20)
    const s=useStore.getState(), body=s.doc.bodies[0]
    check('primitive is one undo step',s.past.length===1&&body.features.length===1)
    const move=resolveCommand('move')!
    check('opening Move does not mutate history',useStore.getState().past.length===1&&!!move.prompt3)
    move.run(0,0,0)
    check('zero move is not a modelling step',useStore.getState().past.length===1)
    move.run(5,10,15)
    const feature=useStore.getState().doc.bodies[0].features[1]
    check('Move stores all three distances',feature.kind==='move'&&feature.offset.join(',')==='5,10,15')
    useStore.getState().undo()
    check('Undo removes Move and clears selection',useStore.getState().doc.bodies[0].features.length===1&&useStore.getState().selection.kind==='none')
    useStore.getState().select({kind:'body',id:body.id})
    toggleVisibility()
    check('V changes selected body visibility',!useStore.getState().doc.bodies[0].visible)
    createSketchAction().run(0,undefined,undefined,'XZ')
    const active=useStore.getState().activeSketch!
    check('new sketch starts in Select',!!active&&useStore.getState().tool==='select')
    const trim=resolveCommand('trim')
    check('Trim starts without preselection',!!trim)
    trim?.run(0)
    check('Trim enters click-to-trim mode',useStore.getState().tool==='trim')
    useStore.getState().closeSketch()
    check('Finish Sketch preserves profile selection',useStore.getState().activeSketch===null&&useStore.getState().selection.id===active.featureId)
    check('empty sketch cannot be extruded',resolveCommand('extrude')===null)
  } finally { useStore.setState(saved,true) }
  return results
}

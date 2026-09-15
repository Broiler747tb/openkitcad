import { findSnap } from '../sketch/inference'
import { emptySketch } from '../sketch/types'
import { normalizePreferences, DEFAULT_PREFERENCES } from '../doc/preferences'
import { circleRadius, continueLine, emptyDraft } from '../sketch/draft'
import { hitTestSketch } from '../sketch/inference'
import { sketchActions } from '../sketch/actions'
export function runPrecisionTest() {
  const results:Array<{name:string;pass:boolean;detail:string}>=[]
  const check=(name:string,pass:boolean)=>results.push({name:'Precision: '+name,pass,detail:pass?'passed':'unexpected result'})
  const sketch=emptySketch()
  const options={tolerance:1,gridStep:5,points:false,midpoints:false,edges:false,alignment:false}
  let snap=findSnap(sketch,[12.1,-8.1],options)
  check('5mm grid handles negative coordinates',snap.point[0]===10&&snap.point[1]===-10)
  snap=findSnap(sketch,[0.31,0.76],{...options,gridStep:0.25})
  check('fractional grid is exact',snap.point[0]===0.25&&snap.point[1]===0.75)
  snap=findSnap(sketch,[12.1,-8.1],{...options,gridStep:0})
  check('disabled grid preserves cursor',snap.point[0]===12.1&&snap.point[1]===-8.1)
  snap=findSnap(sketch,[0.2,0.2],{...options,points:true})
  check('origin snap takes priority',snap.snapToPointId==='origin')
  snap=findSnap(sketch,[12.1,0.2],{...options,alignment:true,from:[0,0]})
  check('alignment still rounds free axis',snap.align==='horizontal'&&snap.point[0]===10&&snap.point[1]===0)
  check('NaN settings fall back',normalizePreferences({gridStep:NaN}).gridStep===DEFAULT_PREFERENCES.gridStep)
  check('negative grid step is clamped',normalizePreferences({gridStep:-3}).gridStep===0.01)
  check('extent is bounded',normalizePreferences({gridExtent:1e12}).gridExtent===10000)
  check('major interval is integer',normalizePreferences({majorEvery:3.7}).majorEvery===4)
  check('zero disables gizmo snapping',normalizePreferences({moveSnap:0,angleSnap:0}).moveSnap===0)
  check('small exact circles retain radius',circleRadius([0,0],[0.2,0])===0.2)
  check('zero-radius circle is rejected',circleRadius([1,1],[1,1])===null)
  sketch.points.push({id:'a',x:10,y:10},{id:'b',x:20,y:10})
  sketch.entities.push({id:'line',kind:'line',p1:'a',p2:'b',construction:false})
  const chain=continueLine(sketch,'b')
  check('chained line reuses endpoint ID',chain.anchorIds[0]==='b')
  check('chained line uses solved endpoint',chain.anchors[0][0]===20&&chain.anchors[0][1]===10)
  check('deleted endpoint cancels chain',continueLine(sketch,'deleted').anchors.length===0)
  const draft1=emptyDraft(),draft2=emptyDraft()
  draft1.anchors.push([1,2]); draft1.anchorIds.push('a')
  check('new gesture does not inherit anchors',draft2.anchors.length===0&&draft2.anchorIds.length===0)
  const hit=hitTestSketch(sketch,[10,10],1,false)
  check('trim hits edge even near endpoint',hit?.kind==='entity'&&hit.id==='line')
  const trim=hit&&sketchActions(sketch,[hit],[15,10]).find(a=>a.id==='trim')
  const result=trim?.build(0)
  check('trim action includes clicked position',result?.kind==='trim'&&result.at[0]===15&&result.at[1]===10)
  return results
}

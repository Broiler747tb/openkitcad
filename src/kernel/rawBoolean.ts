import { cast, getOC } from 'replicad'
import { Scratch, type OcShape } from './naming'

export interface RawSolid {
  wrapped: OcShape
}

export function rawBoolean<T extends RawSolid>(
  kind: 'fuse' | 'cut',
  target: RawSolid,
  tools: readonly RawSolid[],
  failure: string,
  touching = false,
): T {
  const oc = getOC() as any
  const scratch = new Scratch()
  try {
    const builder = scratch.track(
      kind === 'fuse' ? new oc.BRepAlgoAPI_Fuse_1() : new oc.BRepAlgoAPI_Cut_1(),
    )
    const targets = scratch.track(new oc.TopTools_ListOfShape_1())
    scratch.track(targets.Append_1(target.wrapped))
    const list = scratch.track(new oc.TopTools_ListOfShape_1())
    for (const tool of tools) scratch.track(list.Append_1(tool.wrapped))
    builder.SetArguments(targets)
    builder.SetTools(list)
    builder.SetRunParallel(false)
    if (touching) builder.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull)
    const progress = scratch.track(new oc.Message_ProgressRange_1())
    builder.Build(progress)
    if (!builder.IsDone() || builder.HasErrors()) throw new Error(failure)
    return cast(builder.Shape()) as unknown as T
  } finally {
    scratch.release()
  }
}

import {
  getPart,
  refreshUserParts,
  upsertUserPart,
  userParts,
  type CataloguePart,
} from '../catalogue'
import { restoreDesign } from '../doc/boot'
import { getMeshData, putMeshData } from '../doc/meshData'
import { isKept, keepMesh, recallMeshes } from '../doc/meshVault'
import { replaceDesign } from '../doc/open'
import {
  adoptCustomParts,
  loadAutosave,
  makeShareLink,
  readShareLink,
  saveAutosaveNow,
  scheduleAutosave,
} from '../doc/persist'
import { useStore } from '../doc/store'
import { emptyDocument, type BoxFeature, type OkcDocument } from '../doc/types'
import { createMesh } from '../mesh/types'
import { useCommand } from '../ui/command/session'
import { boxCommand } from '../ui/command/specs/primitives'
import type { TestResult } from './selftest'

const AUTOSAVE = 'openkitcad.autosave.v2'
const ASIDE = `${AUTOSAVE}.unopened`
const PARTS = 'openkitcad.userparts.v1'
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function boxDocument(name: string): OkcDocument {
  const doc = emptyDocument(name)
  const feature: BoxFeature = {
    id: 'box',
    name: 'Box',
    kind: 'box',
    componentId: doc.rootComponentId,
    plane: { kind: 'named', name: 'XY', offset: 0 },
    origin: [0, 0],
    width: 10,
    depth: 10,
    height: 10,
    result: { kind: 'newBody', bodyId: 'solid' },
  }
  doc.timeline.push(feature)
  doc.components[0].bodies.push({ id: 'solid', name: 'Box', visible: true, colour: '#ffffff' })
  return doc
}

function board(width: number): CataloguePart {
  return {
    id: 'regression-board',
    name: 'Regression board',
    category: 'mcu',
    summary: 'A measured test board.',
    confidence: 'measured',
    source: 'Test measurements.',
    geometry: { kind: 'board', outline: { shape: 'rect', w: width, h: 10 }, thickness: 1.6 },
  }
}

function boardDocument(width: number): OkcDocument {
  const doc = emptyDocument('Board design')
  doc.customParts = [board(width)]
  doc.components.push({
    id: 'board',
    name: 'Board',
    source: { kind: 'catalogue', partId: board(width).id },
    bodies: [],
  })
  return doc
}

export async function runPersistenceTest(): Promise<TestResult[]> {
  const results: TestResult[] = []
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Persistence: ${name}`, pass, detail })
  const storage = new Map([AUTOSAVE, ASIDE, PARTS].map((key) => [key, localStorage.getItem(key)]))
  const store = useStore.getState()
  const command = useCommand.getState()
  const originalSetItem = Storage.prototype.setItem
  const quiet = (doc: OkcDocument) =>
    useStore.setState({
      doc,
      past: [],
      future: [],
      activeSketch: null,
      commandOpen: false,
      rebuild: () => {},
    })
  try {
    localStorage.setItem(PARTS, '[]')
    refreshUserParts()
    upsertUserPart(board(20))
    const incoming = boardDocument(40)
    const adoption = adoptCustomParts(incoming)
    const source = incoming.components[1].source
    const copied = source.kind === 'catalogue' ? getPart(source.partId) : undefined
    check(
      'a conflicting ID preserves both sets of measurements',
      adoption.copied.length === 1 &&
        copied?.geometry.kind === 'board' &&
        copied.geometry.outline.shape === 'rect' &&
        copied.geometry.outline.w === 40 &&
        getPart('regression-board')?.geometry.kind === 'board',
      `copied ${adoption.copied.length}, imported ${source.kind === 'catalogue' ? source.partId : ''}`,
    )
    const again = boardDocument(40)
    adoptCustomParts(again)
    check(
      'opening the same conflicting part again reuses the copy',
      userParts().length === 2 &&
        JSON.stringify(again.components[1].source) === JSON.stringify(source),
      `${userParts().length} parts`,
    )

    const link = makeShareLink(boardDocument(20))
    localStorage.setItem(PARTS, '[]')
    refreshUserParts()
    const shared = readShareLink(new URL(link).hash)
    check(
      'reading a link does not adopt parts before confirmation',
      !!shared?.customParts?.length && !getPart('regression-board'),
      `embedded ${shared?.customParts?.length}, stored ${userParts().length}`,
    )

    const original = boxDocument('My work')
    quiet(original)
    useStore.setState({ past: [emptyDocument('Before work')] })
    let asks = 0
    const declined = await replaceDesign(boardDocument(40), () => {
      asks++
      return false
    })
    check(
      'cancelling Open preserves work, history and the catalogue',
      !declined &&
        asks === 1 &&
        useStore.getState().doc === original &&
        useStore.getState().past.length === 1 &&
        !getPart('regression-board'),
      `asks ${asks}, document ${useStore.getState().doc.name}`,
    )
    useCommand.getState().start(boxCommand, { editing: original.timeline[0] })
    const accepted = await replaceDesign(boxDocument('Opened'), () => true)
    check(
      'accepting Open closes an old command before replacing the document',
      accepted &&
        useStore.getState().doc.name === 'Opened' &&
        !useCommand.getState().session &&
        !useStore.getState().commandOpen,
      `document ${useStore.getState().doc.name}`,
    )

    quiet(original)
    useStore.setState({ past: [emptyDocument('Before box')] })
    useCommand.getState().start(boxCommand, { editing: original.timeline[0] })
    useStore.getState().undo()
    const unchanged = useStore.getState().doc === original
    const edited = { ...original.timeline[0], width: 25 } as BoxFeature
    useCommand.getState().commit([edited])
    check(
      'Undo cannot remove the operation being edited',
      unchanged &&
        useStore.getState().doc.timeline[0]?.kind === 'box' &&
        (useStore.getState().doc.timeline[0] as BoxFeature).width === 25,
      `kept before OK ${unchanged}`,
    )
    useStore.getState().undo()
    check(
      'Undo works again after OK',
      (useStore.getState().doc.timeline[0] as BoxFeature).width === 10,
      `width ${(useStore.getState().doc.timeline[0] as BoxFeature).width}`,
    )
    useCommand.getState().start(boxCommand)
    useStore.getState().redo()
    check(
      'Redo is also blocked while a command is open',
      (useStore.getState().doc.timeline[0] as BoxFeature).width === 10 &&
        useStore.getState().future.length === 1,
      `future ${useStore.getState().future.length}`,
    )
    useCommand.getState().cancel()
    useStore.getState().redo()
    check(
      'Redo works again after Cancel',
      (useStore.getState().doc.timeline[0] as BoxFeature).width === 25,
      `width ${(useStore.getState().doc.timeline[0] as BoxFeature).width}`,
    )

    saveAutosaveNow(original)
    const incomingLink = makeShareLink(boxDocument('Shared work'))
    quiet(emptyDocument())
    await restoreDesign(new URL(incomingLink).hash, () => false)
    check(
      'declining a shared design restores existing autosave',
      useStore.getState().doc.name === 'My work' && loadAutosave()?.doc.name === 'My work',
      useStore.getState().doc.name,
    )
    await restoreDesign(new URL(incomingLink).hash, () => true)
    check(
      'accepting a shared design keeps the previous autosave aside',
      useStore.getState().doc.name === 'Shared work' &&
        JSON.parse(localStorage.getItem(ASIDE) ?? '{}')?.doc?.name === 'My work',
      useStore.getState().doc.name,
    )
    quiet(emptyDocument())
    await restoreDesign('#d=invalid', () => true)
    check(
      'a broken link falls back to the existing autosave',
      useStore.getState().doc.name === 'My work',
      useStore.getState().doc.name,
    )

    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError')
    }
    const now = saveAutosaveNow(boxDocument('Cannot save'))
    const later = await new Promise<boolean>((resolve) =>
      scheduleAutosave(boxDocument('Cannot save'), resolve),
    )
    Storage.prototype.setItem = originalSetItem
    check(
      'storage failures are reported and leave the last autosave intact',
      !now && !later && loadAutosave()?.doc.name === 'My work',
      `now ${now}, later ${later}`,
    )

    const mesh = createMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, Math.random(), 0, 1], [0, 1, 2])
    const id = putMeshData(mesh)
    const meshDoc = emptyDocument('Imported mesh')
    meshDoc.timeline.push({
      id: 'insert',
      name: 'Mesh',
      kind: 'meshInsert',
      componentId: 'root',
      bodyId: 'mesh-body',
      dataId: id,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      unit: 'mm',
      yUp: false,
      centre: false,
      ground: false,
    })
    const before = localStorage.getItem(AUTOSAVE)
    // Simulate quota failure only for the inline fallback, before IndexedDB has committed.
    Storage.prototype.setItem = function (key, value) {
      if (key === AUTOSAVE && value.includes('meshData'))
        throw new DOMException('full', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    }
    const premature = saveAutosaveNow(meshDoc)
    Storage.prototype.setItem = originalSetItem
    check(
      'an uncommitted mesh is never replaced by dangling references',
      !premature && localStorage.getItem(AUTOSAVE) === before,
      `saved prematurely ${premature}`,
    )
    const persisted = await keepMesh(id, getMeshData(id)!)
    const saved = saveAutosaveNow(meshDoc)
    const recalled = await recallMeshes([id])
    check(
      'mesh autosave uses IndexedDB and survives a storage read',
      persisted &&
        isKept(id) &&
        saved &&
        !JSON.parse(localStorage.getItem(AUTOSAVE) ?? '{}').doc.meshData &&
        recalled[id]?.positions === getMeshData(id)?.positions,
      `persisted ${persisted}, saved ${saved}`,
    )
  } catch (error) {
    check('regression suite completes', false, String(error))
  } finally {
    Storage.prototype.setItem = originalSetItem
    // Drain any pending save before restoring the user's test-page storage.
    saveAutosaveNow(store.doc)
    await delay(0)
    for (const [key, value] of storage) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    refreshUserParts()
    useCommand.setState(command)
    useStore.setState(store)
  }
  return results
}

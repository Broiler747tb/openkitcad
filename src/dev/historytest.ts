import { useStore } from '../doc/store'
import { emptyDocument } from '../doc/types'
import type { TestResult } from './selftest'

export function runHistoryTest(): TestResult[] {
  const saved = useStore.getState()
  const results: TestResult[] = []
  let builds = 0
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `History: ${name}`, pass, detail })
  const reset = () => {
    useStore.setState({
      doc: emptyDocument('Original'),
      past: [],
      future: [],
      transientBase: null,
      commandOpen: false,
      rebuild: () => {
        builds++
      },
    })
    useStore.getState().setDoc(emptyDocument('Original'))
    builds = 0
  }
  const rename = (name: string, transient = false) =>
    useStore.getState().commit(
      (doc) => {
        doc.name = name
      },
      { mergeKey: 'name', transient },
    )
  try {
    reset()
    rename('A')
    rename('B')
    check('rapid edits undo as one step', useStore.getState().past.length === 1, 'two edits')
    useStore.getState().undo()
    check(
      'undo restores the value before the edits',
      useStore.getState().doc.name === 'Original',
      useStore.getState().doc.name,
    )
    useStore.getState().redo()
    check(
      'redo restores the last edited value',
      useStore.getState().doc.name === 'B',
      useStore.getState().doc.name,
    )
    useStore.getState().undo()
    rename('C')
    check(
      'a new edit discards the redo branch',
      useStore.getState().future.length === 0,
      `${useStore.getState().future.length} redo steps`,
    )

    reset()
    rename('Old design edit')
    useStore.getState().setDoc(emptyDocument('New design'))
    rename('New design edit')
    useStore.getState().undo()
    check(
      'opening another design breaks edit coalescing',
      useStore.getState().doc.name === 'New design',
      useStore.getState().doc.name,
    )

    reset()
    rename('Before drag')
    useStore.getState().beginTransient()
    rename('During drag', true)
    useStore.getState().endTransient()
    rename('After drag')
    useStore.getState().undo()
    check(
      'an edit after a drag has its own undo step',
      useStore.getState().doc.name === 'During drag',
      useStore.getState().doc.name,
    )
    useStore.getState().undo()
    check(
      'a completed drag undoes in one step',
      useStore.getState().doc.name === 'Before drag',
      useStore.getState().doc.name,
    )

    reset()
    useStore.getState().beginTransient()
    rename('Cancelled preview', true)
    const beforeCancel = builds
    useStore.getState().cancelTransient()
    check(
      'cancel restores and rebuilds the original geometry',
      useStore.getState().doc.name === 'Original' &&
        builds === beforeCancel + 1 &&
        useStore.getState().past.length === 0,
      `${useStore.getState().doc.name}, ${builds - beforeCancel} rebuilds`,
    )

    reset()
    useStore.getState().beginTransient()
    rename('Old preview', true)
    useStore.getState().setDoc(emptyDocument('Replacement'))
    useStore.getState().cancelTransient()
    check(
      'an old preview cannot restore a replaced document',
      useStore.getState().doc.name === 'Replacement',
      useStore.getState().doc.name,
    )

    reset()
    rename('Committed')
    useStore.getState().beginTransient()
    rename('Live preview', true)
    useStore.getState().undo()
    check(
      'undo waits until the live edit finishes',
      useStore.getState().doc.name === 'Live preview' && useStore.getState().past.length === 1,
      useStore.getState().doc.name,
    )
    useStore.getState().cancelTransient()
    useStore.getState().undo()
    check(
      'undo works again after cancelling the live edit',
      useStore.getState().doc.name === 'Original',
      useStore.getState().doc.name,
    )
  } finally {
    useStore.getState().setDoc(emptyDocument())
    useStore.setState(saved, true)
  }
  return results
}

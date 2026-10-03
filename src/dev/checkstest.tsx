import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { identityMatrix } from '../doc/model'
import { useStore } from '../doc/store'
import { emptyDocument } from '../doc/types'
import type { Clash, Instance, KernelApi } from '../kernel/types'
import { DesignChecks } from '../ui/DesignChecks'
import type { TestResult } from './selftest'

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 20))
const instance = (id: string, patch: Partial<Instance> = {}): Instance => ({
  id,
  kind: 'body',
  path: [],
  componentId: 'root',
  bodyId: id,
  meshKey: id,
  matrix: identityMatrix(),
  visible: true,
  negative: false,
  ...patch,
})

export async function runChecksTest(): Promise<TestResult[]> {
  const saved = useStore.getState()
  const results: TestResult[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  let root = createRoot(host)
  const check = (name: string, pass: boolean, detail: string) =>
    results.push({ name: `Design checks: ${name}`, pass, detail })
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith(text))!
  const api: Pick<KernelApi, 'clearance' | 'printPrep'> = {
    clearance: async () => [{ aLabel: 'Plate', bLabel: 'Lid', overlap: 2, at: [0, 0, 0] }],
    printPrep: async () => [],
  }
  const mount = () => {
    flushSync(() => root.unmount())
    root = createRoot(host)
    useStore.setState({
      doc: emptyDocument('Checks'),
      instances: [
        instance('print'),
        instance('cut', { negative: true }),
        instance('hidden', { visible: false }),
        instance('board', { kind: 'catalogue' }),
      ],
      building: false,
      kernelReady: true,
      errors: [],
      commandOpen: false,
      rebuild: () => {},
    })
    flushSync(() => root.render(<DesignChecks api={() => api} />))
  }
  try {
    mount()
    let ids: string[] = []
    api.printPrep = async (requested) => {
      ids = requested
      return []
    }
    button('Check it will print').click()
    await delay()
    check('only visible printable bodies are checked', ids.join() === 'print', ids.join())
    check(
      'a completed print check displays its result',
      host.textContent!.includes('No printing problems spotted.'),
      host.textContent!,
    )
    flushSync(() => useStore.setState({ doc: { ...useStore.getState().doc, name: 'Edited' } }))
    check(
      'editing invalidates the previous print result',
      !host.textContent!.includes('No printing problems spotted.'),
      'edit after checking',
    )

    mount()
    button('Check for clashes').click()
    await delay()
    check(
      'a completed clash check displays the collision',
      host.textContent!.includes('Plate runs into Lid'),
      host.textContent!,
    )
    flushSync(() => useStore.setState({ instances: [...useStore.getState().instances] }))
    check(
      'a rebuilt scene invalidates the previous clash result',
      !host.textContent!.includes('Plate runs into Lid'),
      'rebuild after checking',
    )

    mount()
    let resolve!: (clashes: Clash[]) => void
    api.clearance = () =>
      new Promise((done) => {
        resolve = done
      })
    button('Check for clashes').click()
    await delay()
    flushSync(() =>
      useStore.setState({ doc: { ...useStore.getState().doc, name: 'Changed during check' } }),
    )
    resolve([{ aLabel: 'Old plate', bLabel: 'Old lid', overlap: 1, at: [0, 0, 0] }])
    await delay()
    check(
      'late results from an earlier model are ignored',
      !host.textContent!.includes('Old plate'),
      host.textContent!,
    )
    check(
      'a discarded result releases the buttons',
      !button('Check for clashes').disabled,
      'ready to check again',
    )

    mount()
    flushSync(() => useStore.setState({ building: true }))
    check(
      'checks wait for the geometry rebuild',
      button('Check for clashes').disabled && button('Check it will print').disabled,
      'rebuild in progress',
    )

    mount()
    api.clearance = async () => {
      throw new Error('Geometry check failed')
    }
    button('Check for clashes').click()
    await delay()
    check(
      'a failed check explains the failure',
      host.querySelector('.msg.error')?.textContent?.includes('Geometry check failed') === true,
      host.textContent!,
    )
    check('a failed check allows retrying', !button('Check for clashes').disabled, 'retry enabled')
    api.clearance = async () => []
    button('Check for clashes').click()
    await delay()
    check(
      'a successful retry replaces the error',
      !host.querySelector('.msg.error') &&
        host.textContent!.includes('Nothing overlaps. All clear.'),
      host.textContent!,
    )
    api.printPrep = async () => {
      throw new Error('Print check failed')
    }
    button('Check it will print').click()
    await delay()
    check(
      'print failures are reported too',
      host.querySelector('.msg.error')?.textContent?.includes('Print check failed') === true,
      host.textContent!,
    )
  } finally {
    flushSync(() => root.unmount())
    host.remove()
    useStore.setState(saved, true)
  }
  return results
}

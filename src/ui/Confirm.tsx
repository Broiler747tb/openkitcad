import { useEffect, useRef, useState } from 'react'

export interface ConfirmRequest {
  title: string
  message?: string
  confirm: string
  danger?: boolean
}

interface Pending extends ConfirmRequest {
  resolve: (confirmed: boolean) => void
}

let present: ((pending: Pending) => void) | null = null

export function ask(request: ConfirmRequest): Promise<boolean> {
  if (!present) {
    return Promise.resolve(confirm([request.title, request.message].filter(Boolean).join('\n\n')))
  }
  const show = present
  return new Promise((resolve) => show({ ...request, resolve }))
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    const previous = present
    const show = (next: Pending) => {
      setPending((current) => {
        current?.resolve(false)
        return next
      })
    }
    present = show
    return () => {
      if (present === show) present = previous
    }
  }, [])
  return pending ? (
    <ConfirmDialog
      key={pending.title}
      request={pending}
      onAnswer={(confirmed) => {
        pending.resolve(confirmed)
        setPending(null)
      }}
    />
  ) : null
}

function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: ConfirmRequest
  onAnswer: (confirmed: boolean) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ;(request.danger ? cancelRef : confirmRef).current?.focus()
  }, [request.danger])
  return (
    <dialog
      ref={ref}
      className="action-dialog command-dialog confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault()
        onAnswer(false)
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id="confirm-title">{request.title}</h2>
      {request.message && <p className="hint">{request.message}</p>}
      <footer className="dialog-footer">
        <button ref={cancelRef} type="button" className="tb" onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={`primary-button${request.danger ? ' danger' : ''}`}
          onClick={() => onAnswer(true)}
        >
          {request.confirm}
        </button>
      </footer>
    </dialog>
  )
}

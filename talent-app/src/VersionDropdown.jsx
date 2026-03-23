import { useDropdown } from './useDropdown.js'

export default function VersionDropdown({ versions, selectedVersionId, onSelectVersion }) {
  const { isOpen, setIsOpen, toggle, containerRef } = useDropdown()

  const selectedVersion = versions?.find((v) => v.id === selectedVersionId)
  const selectedLabel = selectedVersion?.label ?? selectedVersionId ?? '—'

  return (
    <div className="locale-dropdown" ref={containerRef}>
      <button
        type="button"
        className="locale-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <span className="locale-trigger-content">
          <span className="locale-trigger-label">{selectedLabel}</span>
        </span>
        <span className="locale-trigger-caret">▾</span>
      </button>

      {isOpen && (
        <div className="locale-menu" role="listbox" aria-label="Data version">
          {(versions ?? []).map((version) => {
            const isActive = version.id === selectedVersionId

            return (
              <button
                key={version.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`locale-option ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelectVersion(version.id)
                  setIsOpen(false)
                }}
              >
                <span>{version.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

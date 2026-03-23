import { createContext, useContext } from 'react'

/**
 * Provides loaded game data, locale strings, and modifier labels to the component tree.
 *
 * Value shape:
 *   data               — raw merged talents + blueprints dataset (or null while loading)
 *   models             — data.models lookup (convenience)
 *   ranks              — data.ranks lookup
 *   localeStrings      — flattened locale key-value map
 *   modifierLabels     — modifier display labels from en.json
 *   versionsIndex      — full versions.json object (or null before loaded)
 *   selectedVersionId  — currently selected version ID
 *   setSelectedVersionId — setter to trigger data reload for a different version
 */
const DataContext = createContext(null)

export function DataProvider({ value, children }) {
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) {
    throw new Error('useData must be used within a DataProvider')
  }
  return ctx
}

export default DataContext

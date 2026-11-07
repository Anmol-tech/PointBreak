import { api } from '../api'
import type { VaultState } from '../types'
import { Panel } from './ui'

export function DealSetup({ state }: { state: VaultState }) {
  function toggle(party: string, folder: string) {
    const p = state.parties.find((x) => x.name === party)
    if (!p) return
    const folders = p.folders.includes(folder) ? p.folders.filter((f) => f !== folder) : [...p.folders, folder]
    api.setFolders(party, folders)
  }

  return (
    <Panel title="Sharing" subtitle="Which folders each company's agents may ask about">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pb-2 font-medium">Folder</th>
            {state.parties.map((p) => <th key={p.name} className="pb-2 text-center font-medium">{p.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {state.folders.map((f) => (
            <tr key={f.name} className="border-t border-slate-800">
              <td className="py-1.5 text-slate-300" title={f.docs.join('\n')}>
                {f.name} <span className="text-slate-600">({f.docs.length})</span>
              </td>
              {state.parties.map((p) => (
                <td key={p.name} className="text-center">
                  <input
                    type="checkbox"
                    checked={p.folders.includes(f.name)}
                    onChange={() => toggle(p.name, f.name)}
                    className="h-3.5 w-3.5 accent-emerald-500"
                    aria-label={`Share ${f.name} with ${p.name}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

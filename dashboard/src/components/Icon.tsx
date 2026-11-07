import type { ReactNode } from 'react'

type IconName = 'shield' | 'agents' | 'answer' | 'blocked' | 'arrow' | 'lock' | 'key' | 'file' | 'check' | 'alert' | 'reset' | 'close' | 'trace' | 'folder' | 'play'
const paths: Record<IconName, ReactNode> = {
  shield: <><path d="M12 3 4.5 6v5c0 5 3.5 8 7.5 10 4-2 7.5-5 7.5-10V6L12 3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  agents: <><rect x="5" y="6" width="14" height="14" rx="4" /><path d="M9 3h6M12 3v3M9 11v2M15 11v2M9 16h6" /></>,
  answer: <><path d="M20 11a8 8 0 0 1-8 8H6l-4 3 1-7a8 8 0 1 1 17-4Z" /><path d="M7 9h8M7 13h5" /></>,
  blocked: <><path d="M12 3 4.5 6v5c0 5 3.5 8 7.5 10 4-2 7.5-5 7.5-10V6L12 3Z" /><path d="m9 9 6 6m0-6-6 6" /></>,
  arrow: <path d="M6 18 18 6M6 6h12v12" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" /></>,
  key: <><circle cx="8" cy="8" r="5" /><path d="m11.5 11.5 9 9M17 17l3-3M14 14l3-3" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17v.1" /></>,
  reset: <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  trace: <path d="M4 12a8 8 0 0 1 16 0M7 13v-1a5 5 0 0 1 10 0v3M10 20a15 15 0 0 0 1-8 1 1 0 0 1 2 0c0 5 0 7-2 10M4 16v2M7 17l-1 4M17 19l-1 3M20 16v3" />,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
}
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

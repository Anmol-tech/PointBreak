import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import VendorApp from './VendorApp.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VendorApp />
  </StrictMode>,
)

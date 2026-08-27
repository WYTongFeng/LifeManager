import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { init as initCloudSync } from './utils/cloudSync'

// HashRouter, not BrowserRouter — the Capacitor WebView serves dist/ through
// its local asset loader with no server-side rewrite for deep paths, so only
// hash-based navigation (everything after index.html#/...) survives a
// WebView reload/state-restore.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)

// Fire-and-forget: sync must never block first paint, and a failure here (no
// config, no network, signed out) leaves the app running exactly as before.
initCloudSync().catch(e => console.warn('Cloud sync unavailable:', e))

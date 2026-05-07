import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useWorkerStore } from './stores/workerStore'

// 起動時に作業者リストとキャッシュ済み選択を復元
useWorkerStore.getState().loadFromCache()
useWorkerStore.getState().loadWorkers().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

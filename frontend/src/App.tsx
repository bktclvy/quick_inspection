import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppHeader } from '@/components/app-header'
import { ToastContainer } from '@/components/layout/Toast'
import { InspectPage as InspectionPage } from '@/components/inspect-page'
import { SetupPageNew as SetupPage } from '@/components/setup-page'
import { StatsPage } from '@/components/stats-page'
import { SettingsPage } from '@/components/settings-page'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100vh',
        background: '#f7f5f2',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
        <AppHeader />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<InspectionPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </BrowserRouter>
  )
}

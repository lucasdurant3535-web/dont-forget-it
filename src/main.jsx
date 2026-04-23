import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ResetPassword from './ResetPassword.jsx'
import { registerSW } from 'virtual:pwa-register'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log("Nova versão disponível. Atualizando...");
    updateSW(true);
  },
  onOfflineReady() {
    console.log("App pronto para uso offline.");
  }
})
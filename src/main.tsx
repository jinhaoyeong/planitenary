import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css';
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './contexts/ThemeContext'
import { CurrencyProvider } from './contexts/CurrencyContext'
import { AuthProvider } from './contexts/AuthContext'
import { SmoothScroll } from './components/motion/SmoothScroll'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <CurrencyProvider>
        <ThemeProvider>
          <SmoothScroll>
            <App />
          </SmoothScroll>
        </ThemeProvider>
      </CurrencyProvider>
    </AuthProvider>
  </StrictMode>,
)

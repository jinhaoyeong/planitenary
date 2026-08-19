// MUST stay the first import. Supabase decides whether localStorage is usable
// inside createClient and memoises that answer; reclaiming space afterwards is
// too late and the session silently falls back to an empty memory store.
import './bootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
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

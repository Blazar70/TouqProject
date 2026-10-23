import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/AuthContext'
import { BranchProvider } from './lib/BranchContext'
import { LanguageProvider } from './lib/i18n/LanguageContext'
import { ThemeProvider } from './lib/ThemeContext'
import { ConfirmProvider } from './lib/ConfirmContext'
import { ToastProvider } from './lib/ToastContext'
import { PrintProvider } from './lib/PrintContext'
import { installArabicDigitInput } from './lib/arabicDigits'

installArabicDigitInput()
import OfflineBanner from './components/OfflineBanner'
import UpdatePrompt from './components/UpdatePrompt'

// A data router (rather than plain BrowserRouter) is required for
// useBlocker — the hook that lets a dirty form stop in-app navigation
// (e.g. clicking a different pet, or a different nav link) the same way
// beforeunload stops a tab close. App itself still does its own routing
// internally via <Routes>/<Route>; this is just the root wrapper.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ThemeProvider>
        <LanguageProvider>
          <OfflineBanner />
          <UpdatePrompt />
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                <PrintProvider>
                  <BranchProvider>
                    <App />
                  </BranchProvider>
                </PrintProvider>
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

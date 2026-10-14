import { Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import PetsPage from './pages/PetsPage'
import RegisterPetPage from './pages/RegisterPetPage'
import AppointmentsPage from './pages/AppointmentsPage'
import PaymentsPage from './pages/PaymentsPage'
import StaffPage from './pages/StaffPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminPage from './pages/AdminPage'
import AdminBillingPage from './pages/AdminBillingPage'
import AdminActivityPage from './pages/AdminActivityPage'
import { useAuth } from './lib/AuthContext'
import { supabase } from './lib/supabase'
import { useLanguage } from './lib/i18n/LanguageContext'
import AppShell from './components/AppShell'
import LoadingScreen from './components/LoadingScreen'
import './App.css'

function App() {
  const { session, profile, clinicName, clinicDisabled, loading, passwordRecovery } = useAuth()
  const { t } = useLanguage()

  // TEMP: animation preview, bypasses auth — remove before shipping
  if (window.location.pathname === '/test-loader') return <LoadingScreen />

  // Checked ahead of `loading`/`!session` — a recovery link signs the user
  // into a temporary session, so both of those already pass, but they
  // should see "set a new password" rather than falling through to
  // whatever their normal role would otherwise route them to.
  if (passwordRecovery) return <ResetPasswordPage />

  if (loading) return <LoadingScreen />

  if (!session) return <LoginPage />

  // profiles_select_own stays readable regardless of `disabled` specifically
  // so this screen can render — every other table is locked down by RLS the
  // moment an admin flips the switch, this is just making that state legible
  // instead of the app silently showing empty lists everywhere.
  if (profile?.disabled) {
    return (
      <div className="app">
        <main className="app-main">
          <h1>{t('admin.accountDisabledTitle')}</h1>
          <p>{t('admin.accountDisabledBody')}</p>
          <button type="button" className="secondary-button" onClick={() => supabase.auth.signOut()}>
            {t('nav.logout')}
          </button>
        </main>
      </div>
    )
  }

  // Independent of the profile.disabled screen above — an admin can disable
  // a whole clinic (0031) without touching any individual staff member's
  // own disabled flag, so this needs its own check and its own message.
  if (clinicDisabled) {
    return (
      <div className="app">
        <main className="app-main">
          <h1>{t('admin.clinicDisabledTitle')}</h1>
          <p>{t('admin.clinicDisabledBody')}</p>
          <button type="button" className="secondary-button" onClick={() => supabase.auth.signOut()}>
            {t('nav.logout')}
          </button>
        </main>
      </div>
    )
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <AppShell isAdmin={isAdmin} clinicName={clinicName} userName={profile?.full_name ?? session.user.email ?? ''}>
      <main className="app-main">
        <Routes>
          {isAdmin ? (
            <>
              <Route path="/" element={<AdminPage />} />
              <Route path="/billing" element={<AdminBillingPage />} />
              <Route path="/activity" element={<AdminActivityPage />} />
            </>
          ) : (
            <>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/pets" element={<PetsPage />} />
              <Route path="/pets/new" element={<RegisterPetPage />} />
              <Route path="/appointments" element={<AppointmentsPage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </>
          )}
        </Routes>
      </main>
    </AppShell>
  )
}

export default App

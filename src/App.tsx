import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import PetsPage from './pages/PetsPage'
import RegisterPetPage from './pages/RegisterPetPage'
import AppointmentsPage from './pages/AppointmentsPage'
import SessionPage from './pages/SessionPage'
import PaymentsPage from './pages/PaymentsPage'
import OwnersPage from './pages/OwnersPage'
import ReportsPage from './pages/ReportsPage'
import ManagerPage from './pages/ManagerPage'
import InpatientsPage from './pages/InpatientsPage'
import RemindersPage from './pages/RemindersPage'
import StaffPage from './pages/StaffPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import MfaPage from './pages/MfaPage'
import AdminPage from './pages/AdminPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import AdminBillingPage from './pages/AdminBillingPage'
import AdminActivityPage from './pages/AdminActivityPage'
import { useAuth } from './lib/AuthContext'
import { signOutThisDevice } from './lib/push'
import { useBranch } from './lib/BranchContext'
import { useLanguage } from './lib/i18n/LanguageContext'
import AppShell from './components/AppShell'
import LoadingScreen from './components/LoadingScreen'
import BranchPicker from './components/BranchPicker'
import './App.css'

function App() {
  const { session, profile, clinicName, clinicDisabled, handlesMoney, loading, passwordRecovery, mfaStep } = useAuth()
  const { t } = useLanguage()
  const branch = useBranch()

  // Checked ahead of `loading`/`!session` — a recovery link signs the user
  // into a temporary session, so both of those already pass, but they
  // should see "set a new password" rather than falling through to
  // whatever their normal role would otherwise route them to.
  if (passwordRecovery) return <ResetPasswordPage />

  if (loading || branch.loading) return <LoadingScreen />

  if (!session) return <LoginPage />

  // Before the profile opens: admins and managers must use a code (0095), others only if they turned it on.
  if (mfaStep) return <MfaPage step={mfaStep} />

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
          <button type="button" className="secondary-button" onClick={signOutThisDevice}>
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
          <button type="button" className="secondary-button" onClick={signOutThisDevice}>
            {t('nav.logout')}
          </button>
        </main>
      </div>
    )
  }

  const isAdmin = profile?.role === 'admin'
  // 2+ branches and none picked in this tab yet: pick before the app loads anything.
  if (branch.asking) return <BranchPicker />

  return (
    <AppShell isAdmin={isAdmin} clinicName={clinicName} userName={profile?.full_name ?? session.user.email ?? ''}>
      <main className="app-main">
        <Routes>
          {isAdmin ? (
            <>
              <Route path="/" element={<AdminDashboardPage />} />
              <Route path="/clinics" element={<AdminPage />} />
              <Route path="/billing" element={<AdminBillingPage />} />
              <Route path="/activity" element={<AdminActivityPage />} />
            </>
          ) : (
            <>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/pets" element={<PetsPage />} />
              <Route path="/pets/new" element={<RegisterPetPage />} />
              <Route path="/pets/:id" element={<PetsPage />} />
              <Route path="/owners" element={<OwnersPage />} />
              <Route path="/inpatients" element={<InpatientsPage />} />
              <Route path="/reminders" element={handlesMoney ? <RemindersPage /> : <Navigate to="/" replace />} />
              <Route path="/appointments" element={<AppointmentsPage />} />
              <Route path="/appointments/:id/session" element={<SessionPage />} />
              {/* Money: receptionists and managers only (0074); the DB refuses the rest too. */}
              <Route path="/payments" element={handlesMoney ? <PaymentsPage /> : <Navigate to="/" replace />} />
              <Route path="/reports" element={handlesMoney ? <ReportsPage /> : <Navigate to="/" replace />} />
              <Route path="/manager" element={profile?.clinic_role === 'manager' ? <ManagerPage /> : <Navigate to="/" replace />} />
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

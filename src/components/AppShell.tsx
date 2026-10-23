import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  Building2,
  CalendarDays,
  ContactRound,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PawPrint,
  Receipt,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { signOutThisDevice } from '../lib/push'
import { useAuth } from '../lib/AuthContext'
import { useBranch } from '../lib/BranchContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { clinicLogoUrl } from '../lib/imageUpload'
import type { TranslationKey } from '../lib/i18n/translations'
import LanguageToggle from './LanguageToggle'
import BranchMenu from './BranchMenu'
import ThemeToggle from './ThemeToggle'

type NavItem = { to: string; label: TranslationKey; icon: LucideIcon; end?: boolean }
type NavSection = { title?: TranslationKey; items: NavItem[] }

const ADMIN_SECTIONS: NavSection[] = [
  {
    title: 'nav.sectionPlatform',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
      { to: '/clinics', label: 'admin.clinics', icon: Building2 },
      { to: '/billing', label: 'nav.billing', icon: CreditCard },
      { to: '/activity', label: 'nav.activity', icon: Activity },
    ],
  },
]

// Settings sits in its own untitled group: a "Settings" heading over a single
// "Settings" link would just repeat itself.
const CLINIC_SECTIONS: NavSection[] = [
  {
    title: 'nav.sectionFrontDesk',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
      { to: '/appointments', label: 'nav.appointments', icon: CalendarDays },
      { to: '/pets', label: 'nav.pets', icon: PawPrint },
      { to: '/owners', label: 'nav.owners', icon: ContactRound },
    ],
  },
  {
    title: 'nav.sectionClinic',
    items: [
      { to: '/payments', label: 'nav.payments', icon: Receipt },
      { to: '/reports', label: 'nav.reports', icon: BarChart3 },
      { to: '/staff', label: 'nav.staff', icon: Users },
    ],
  },
  { items: [{ to: '/settings', label: 'nav.settings', icon: Settings }] },
]

// Must match the hover-rail media query in App.css. There the sidebar opens on
// hover, so an "open" menu left over from a touch layout must not make the page inert.
const DESKTOP_QUERY = '(min-width: 1024px) and (hover: hover)'
const RAIL_QUERY = '(min-width: 768px)'

function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

// "Al Rawda Veterinary Clinic" -> "AR", "Dr. Sara Ali" -> "SA" (titles like "Dr." / "د." skipped);
// Array.from keeps multi-byte letters whole.
function initials(name: string) {
  const words = name.trim().split(/\s+/)
  const named = words.filter((word) => !word.endsWith('.'))
  return (named.length > 0 ? named : words)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}

type Props = {
  isAdmin: boolean
  clinicName: string | null
  userName: string
  children: ReactNode
}

/**
 * Side navigation layout, chosen by CSS width and pointer type:
 * - >= 1024px with a mouse: icon rail that expands over the content on hover or keyboard focus.
 * - >= 768px touch (tablets, either orientation): 72px icon rail; tapping the rail or
 *   the toggle expands it over the content.
 * - < 768px: top bar with a menu button; the sidebar opens as a drawer.
 * When expanded over content (rail or drawer) it behaves as a modal dialog.
 */
function AppShell({ isAdmin, clinicName, userName, children }: Props) {
  const { t } = useLanguage()
  const { profile, clinicLogoUrl: logo } = useAuth()
  const { branchId, branchName, pickable, branches } = useBranch()
  const [menuOpen, setMenuOpen] = useState(false)
  const isDesktop = useSyncExternalStore(subscribeDesktop, getIsDesktop)
  const overlayOpen = menuOpen && !isDesktop
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  function openMenu(opener: HTMLElement) {
    openerRef.current = opener
    setMenuOpen(true)
  }

  function closeMenu() {
    setMenuOpen(false)
    openerRef.current?.focus()
  }

  useEffect(() => {
    if (!overlayOpen) return
    closeButtonRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        openerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen])

  const sections = isAdmin ? ADMIN_SECTIONS : CLINIC_SECTIONS
  const roleLabel = isAdmin
    ? t('role.admin')
    : profile?.clinic_role && t(`staff.role.${profile.clinic_role}` as TranslationKey)
  const hasBranchMenu = !isAdmin && pickable.length > 1
  // With 2+ branches the branch shows in the dropdown instead.
  const branchLabel = isAdmin || hasBranchMenu ? null : branchName(branchId)
  const userMeta = [roleLabel, branchLabel].filter(Boolean).join(' · ')
  // Saves go to this branch: keep it in sight, also in the collapsed rail.
  const workingBranch = !isAdmin && branches.filter((b) => b.active).length > 1 ? branchName(branchId) : null

  return (
    <div className={`app app-shell${overlayOpen ? ' menu-open' : ''}`}>
      <a href="#main-content" className="skip-link">
        {t('nav.skipToContent')}
      </a>
      <header className="app-topbar" inert={overlayOpen}>
        <button
          type="button"
          className="app-menu-button"
          aria-label={t('nav.openMenu')}
          aria-expanded={overlayOpen}
          aria-controls="app-sidebar"
          onClick={(e) => openMenu(e.currentTarget)}
        >
          <Menu size={24} aria-hidden />
        </button>
        <span className="app-brand">{t('auth.brand')}</span>
        {clinicName && <span className="app-clinic-name">{clinicName}</span>}
      </header>

      {overlayOpen && <div className="app-backdrop" onClick={closeMenu} aria-hidden />}

      {/* Tapping empty rail space opens it on tablets; the toggle button is the keyboard path. */}
      <aside
        onClick={(e) => {
          if (isDesktop || overlayOpen || !window.matchMedia(RAIL_QUERY).matches) return
          if ((e.target as Element).closest('a, button')) return
          openMenu(e.currentTarget)
        }}
        id="app-sidebar"
        className={`app-sidebar${overlayOpen ? ' is-open' : ''}`}
        role={overlayOpen ? 'dialog' : undefined}
        aria-modal={overlayOpen ? true : undefined}
        aria-label={overlayOpen ? t('nav.menu') : undefined}
      >
        <div className="app-sidebar-header">
          <button
            ref={closeButtonRef}
            type="button"
            className="app-sidebar-toggle"
            aria-label={overlayOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={overlayOpen}
            aria-controls="app-sidebar"
            onClick={(e) => (overlayOpen ? closeMenu() : openMenu(e.currentTarget))}
          >
            {overlayOpen ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
          </button>
          <span className="app-brand-mark" aria-hidden>
            <PawPrint size={20} />
          </span>
          <span className="app-brand-group">
            <span className="app-brand">{t('auth.brand')}</span>
          </span>
        </div>

        {clinicName && (
          <div className="app-clinic" title={clinicName}>
            <span className="app-clinic-badge-wrap">
              {logo ? (
                <img className="app-clinic-badge app-clinic-logo" src={clinicLogoUrl(logo)} alt="" />
              ) : (
                <span className="app-clinic-badge" aria-hidden>
                  {initials(clinicName)}
                </span>
              )}
              {workingBranch && (
                <span className="app-clinic-branch" title={t('branch.workingAt', { name: workingBranch })}>
                  {workingBranch}
                </span>
              )}
            </span>
            <span className="app-clinic-name">{clinicName}</span>
          </div>
        )}

        <nav className="app-sidebar-nav" aria-label={t('nav.main')}>
          {sections.map((section, i) => (
            <div className="nav-section" key={section.title ?? i}>
              {section.title && <h2 className="nav-section-title">{t(section.title)}</h2>}
              <ul>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className="nav-item"
                      title={t(item.label)}
                      onClick={() => setMenuOpen(false)}
                    >
                      <item.icon className="nav-item-icon" size={24} aria-hidden />
                      <span className="nav-item-label">{t(item.label)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-user">
            <span className="app-user-avatar" aria-hidden>
              {initials(userName)}
            </span>
            <span className="app-user-text">
              <span className="app-user-name">{userName}</span>
              {userMeta && <span className="app-user-meta">{userMeta}</span>}
            </span>
          </div>
          {hasBranchMenu && <BranchMenu onPicked={() => setMenuOpen(false)} />}
          <div className="app-sidebar-toggles">
            <ThemeToggle />
            <LanguageToggle />
          </div>
          <button type="button" className="logout-button" onClick={signOutThisDevice}>
            <LogOut className="nav-icon-flip" size={18} aria-hidden />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="app-content" id="main-content" tabIndex={-1} inert={overlayOpen}>
        {children}
      </div>
    </div>
  )
}

export default AppShell

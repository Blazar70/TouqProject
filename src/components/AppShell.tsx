import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Building2,
  CalendarDays,
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
import { supabase } from '../lib/supabase'
import { useLanguage } from '../lib/i18n/LanguageContext'
import type { TranslationKey } from '../lib/i18n/translations'
import LanguageToggle from './LanguageToggle'
import ThemeToggle from './ThemeToggle'

type NavItem = { to: string; label: TranslationKey; icon: LucideIcon; end?: boolean }
type NavSection = { title?: TranslationKey; items: NavItem[] }

const ADMIN_SECTIONS: NavSection[] = [
  {
    title: 'nav.sectionPlatform',
    items: [
      { to: '/', label: 'nav.admin', icon: Building2, end: true },
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
    ],
  },
  {
    title: 'nav.sectionClinic',
    items: [
      { to: '/payments', label: 'nav.payments', icon: Receipt },
      { to: '/staff', label: 'nav.staff', icon: Users },
    ],
  },
  { items: [{ to: '/settings', label: 'nav.settings', icon: Settings }] },
]

// Must match the desktop breakpoint in App.css. At this width the sidebar is
// always visible, so an "open" menu left over from a narrower width (e.g. the
// tablet was rotated) must not make the page inert.
const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

type Props = {
  isAdmin: boolean
  clinicName: string | null
  userName: string
  children: ReactNode
}

/**
 * Side navigation layout. Three modes, chosen purely by CSS width:
 * - >= 1024px: persistent 240px sidebar.
 * - 768-1023px: 72px icon rail; the toggle expands it over the content.
 * - < 768px: top bar with a menu button; the sidebar opens as a drawer.
 * When expanded over content (rail or drawer) it behaves as a modal dialog.
 */
function AppShell({ isAdmin, clinicName, userName, children }: Props) {
  const { t } = useLanguage()
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

  return (
    <div className={`app app-shell${overlayOpen ? ' menu-open' : ''}`}>
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

      <aside
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
          <span className="app-brand-group">
            <span className="app-brand">{t('auth.brand')}</span>
            {clinicName && <span className="app-clinic-name">{clinicName}</span>}
          </span>
        </div>

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
                      <item.icon className="nav-item-icon" size={22} aria-hidden />
                      <span className="nav-item-label">{t(item.label)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          {!clinicName && <span className="app-user">{userName}</span>}
          <div className="app-sidebar-toggles">
            <ThemeToggle />
            <LanguageToggle />
          </div>
          <button type="button" className="logout-button" onClick={() => supabase.auth.signOut()}>
            <LogOut className="nav-icon-flip" size={18} aria-hidden />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="app-content" inert={overlayOpen}>
        {children}
      </div>
    </div>
  )
}

export default AppShell

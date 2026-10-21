import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useLanguage } from '../lib/i18n/LanguageContext'
import { useConfirm } from '../lib/ConfirmContext'
import { useToast } from '../lib/ToastContext'
import { speciesLabel } from '../lib/species'
import type { Database } from '../lib/database.types'
import PetDetail from '../components/PetDetail'
import PetAvatar from '../components/PetAvatar'
import VaccinationBadge from '../components/VaccinationBadge'
import Ltr from '../components/Ltr'
import LoadingScreen from '../components/LoadingScreen'
import RefreshButton from '../components/RefreshButton'
import { vaccinationStatus, nextVaccinationDateAfterDose } from '../lib/vaccination'
import { formatDate } from '../lib/format'
import { matchesPetSearch } from '../lib/appointmentSearch'

type Pet = Database['public']['Tables']['pets']['Row']

const TRASH_RETENTION_DAYS = 7

function PetsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const [pets, setPets] = useState<Pet[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedPetId, setExpandedPetId] = useState<string | null>(null)
  const [expandedPetDirty, setExpandedPetDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [refreshing, setRefreshing] = useState(false)

  const [trashModalOpen, setTrashModalOpen] = useState(false)
  const [trashedPets, setTrashedPets] = useState<Pet[]>([])
  const [loadingTrash, setLoadingTrash] = useState(false)
  const [restoringPetId, setRestoringPetId] = useState<string | null>(null)
  const [purgingPetId, setPurgingPetId] = useState<string | null>(null)

  async function loadPets() {
    setLoading(true)
    const { data, error } = await supabase
      .from('pets')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setPets(data ?? [])
    setLoading(false)
  }

  // Re-fetches without the full-page LoadingScreen (which would unmount an
  // expanded pet's detail view) — for catching up on changes another staff
  // member made while this tab sat open.
  async function handleRefresh() {
    setRefreshing(true)
    const { data, error } = await supabase
      .from('pets')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setPets(data ?? [])
    setRefreshing(false)
  }

  useEffect(() => {
    loadPets()
  }, [])

  // Deep link from the Dashboard's "recent medical records" list — expand
  // the referenced pet and scroll it into view, then drop the query param
  // so it doesn't re-trigger on a later manual collapse/re-expand.
  useEffect(() => {
    if (loading) return
    const highlightId = searchParams.get('highlight')
    if (!highlightId) return
    if (pets.some((pet) => pet.id === highlightId)) {
      setExpandedPetId(highlightId)
      requestAnimationFrame(() => {
        document.getElementById(`pet-row-${highlightId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, pets])

  async function handleDeletePet(pet: Pet) {
    const ok = await confirm(t('pets.deleteConfirm', { name: pet.name, days: String(TRASH_RETENTION_DAYS) }), {
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return

    const { error } = await supabase.from('pets').update({ deleted_at: new Date().toISOString() }).eq('id', pet.id)
    if (error) {
      toast.error(error.message)
      return
    }
    setPets((current) => current.filter((p) => p.id !== pet.id))
    if (expandedPetId === pet.id) {
      setExpandedPetId(null)
      setExpandedPetDirty(false)
    }
    toast.success(t('pets.deleted', { name: pet.name }))
  }

  async function openTrash() {
    setTrashModalOpen(true)
    setLoadingTrash(true)
    const { data, error } = await supabase
      .from('pets')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) toast.error(error.message)
    else setTrashedPets(data ?? [])
    setLoadingTrash(false)
  }

  async function handleRestorePet(pet: Pet) {
    setRestoringPetId(pet.id)
    const { error } = await supabase.from('pets').update({ deleted_at: null }).eq('id', pet.id)
    if (error) {
      toast.error(error.message)
      setRestoringPetId(null)
      return
    }
    setTrashedPets((current) => current.filter((p) => p.id !== pet.id))
    toast.success(t('trash.restored', { name: pet.name }))
    setRestoringPetId(null)
    await loadPets()
  }

  async function handlePurgePet(pet: Pet) {
    const ok = await confirm(t('trash.purgeConfirm', { name: pet.name }), { danger: true, confirmLabel: t('trash.purgeNow') })
    if (!ok) return

    setPurgingPetId(pet.id)
    const { error } = await supabase.from('pets').delete().eq('id', pet.id)
    if (error) {
      toast.error(error.message)
      setPurgingPetId(null)
      return
    }
    setTrashedPets((current) => current.filter((p) => p.id !== pet.id))
    toast.success(t('trash.purged', { name: pet.name }))
    setPurgingPetId(null)
  }

  function handlePetUpdated(updated: Pet) {
    setPets((current) => current.map((p) => (p.id === updated.id ? updated : p)))
  }

  async function handleQuickMarkGiven(pet: Pet) {
    if (!pet.vaccination_interval_days) return
    const nextDateStr = nextVaccinationDateAfterDose(pet.vaccination_interval_days)
    const { data, error } = await supabase
      .from('pets')
      .update({ next_vaccination_date: nextDateStr })
      .eq('id', pet.id)
      .select()
      .single()
    if (error || !data) {
      toast.error(error?.message ?? t('common.couldNotSave'))
      return
    }
    handlePetUpdated(data)
    toast.success(t('vaccination.markedGiven'))
  }

  function collapsePet(petId: string) {
    setExpandedPetId(null)
    setExpandedPetDirty(false)
    requestAnimationFrame(() => {
      document.getElementById(`pet-row-${petId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }

  // Switching which pet is expanded swaps the mounted PetDetail entirely —
  // no route change involved, so useBlocker (which only sees real
  // navigation) can't catch this. Guard it here instead.
  async function handleRowToggle(pet: Pet) {
    if (expandedPetId === pet.id) {
      if (expandedPetDirty) {
        const leave = await confirm(t('common.unsavedChangesConfirm'), {
          confirmLabel: t('common.leaveWithoutSaving'),
          cancelLabel: t('common.stay'),
        })
        if (!leave) return
      }
      collapsePet(pet.id)
      return
    }

    if (expandedPetDirty) {
      const leave = await confirm(t('common.unsavedChangesConfirm'), {
        confirmLabel: t('common.leaveWithoutSaving'),
        cancelLabel: t('common.stay'),
      })
      if (!leave) return
    }
    setExpandedPetDirty(false)
    setExpandedPetId(pet.id)
  }

  const filteredPets = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return pets
    return pets.filter((pet) => matchesPetSearch(pet, query))
  }, [pets, search])

  if (loading) return <LoadingScreen />

  return (
    <div>
      <div className="page-header">
        <h1>{t('pets.title')}</h1>
        <div className="page-header-actions">
          <RefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
          {profile?.role === 'vet' && (
            <Link to="/pets/new" className="primary-button">
              {t('pets.registerPet')}
            </Link>
          )}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <input
        type="search"
        className="search-input"
        placeholder={t('pets.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search.trim() && (
        <p className="search-result-count">
          {t('pets.resultCount', { count: String(filteredPets.length), total: String(pets.length) })}
        </p>
      )}

      {filteredPets.length === 0 ? (
        pets.length === 0 ? (
          <div className="empty-state">
            <p>{t('pets.noneRegistered')}</p>
            {profile?.role === 'vet' && (
              <Link to="/pets/new" className="primary-button">
                {t('pets.registerPet')}
              </Link>
            )}
          </div>
        ) : (
          <p>{t('pets.noneMatch')}</p>
        )
      ) : (
        <ul className="pet-list data-table data-pets">
          <li className="data-head" aria-hidden>
            <span>{t('list.pet')}</span>
            <span>{t('pets.petId')}</span>
            <span>{t('list.owner')}</span>
            <span>{t('list.vaccination')}</span>
            <span />
          </li>
          {filteredPets.map((pet) => (
            <li key={pet.id} id={`pet-row-${pet.id}`} className={`pet-list-item${expandedPetId === pet.id ? ' is-open' : ''}`}>
              <div className="pet-row data-row">
                <div className="pet-row-toggle-with-avatar data-cell-wide">
                  <PetAvatar pet={pet} size={40} />
                  <button type="button" className="pet-row-toggle" onClick={() => handleRowToggle(pet)}>
                    <strong>{pet.name}</strong>
                    <div className="pet-owner">
                      {speciesLabel(t, pet.species)}
                      {pet.breed ? ` · ${pet.breed}` : ''}
                    </div>
                  </button>
                </div>
                <div className="data-muted">
                  <span className="data-label">{t('pets.petId')}: </span>
                  <Ltr>{pet.pet_number}</Ltr>
                </div>
                <div className="data-cell-wide">
                  <span className="data-label">{t('pets.owner')}: </span>
                  {pet.owner_name}
                  {pet.owner_phone && (
                    <div className="pet-owner">
                      <Ltr>{pet.owner_phone}</Ltr>
                    </div>
                  )}
                </div>
                <div>
                  <VaccinationBadge nextDate={pet.next_vaccination_date} />
                </div>
                <div className="data-end">
                  {profile?.role === 'vet' && pet.vaccination_interval_days && ['due-soon', 'overdue'].includes(vaccinationStatus(pet.next_vaccination_date)) && (
                    <button type="button" className="secondary-button" onClick={() => handleQuickMarkGiven(pet)}>
                      {t('vaccination.markGiven')}
                    </button>
                  )}
                </div>
              </div>
              {expandedPetId === pet.id && (
                <PetDetail
                  pet={pet}
                  onUpdated={handlePetUpdated}
                  onDirtyChange={setExpandedPetDirty}
                  onDelete={() => handleDeletePet(pet)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {profile?.role === 'vet' && (
        <button type="button" className="admin-trash-fab" onClick={openTrash} aria-label={t('trash.title')}>
          <Trash2 size={20} aria-hidden />
        </button>
      )}

      {trashModalOpen && (
        <div className="admin-modal-backdrop" onClick={() => setTrashModalOpen(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>
              {t('trash.title')} ({trashedPets.length})
            </h2>
            {loadingTrash ? (
              <p>{t('common.loading')}</p>
            ) : trashedPets.length === 0 ? (
              <p>{t('trash.empty')}</p>
            ) : (
              <ul className="record-list">
                {trashedPets.map((pet) => {
                  const deletedAt = new Date(pet.deleted_at!)
                  const daysLeft = Math.max(
                    0,
                    TRASH_RETENTION_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000)),
                  )
                  return (
                    <li key={pet.id}>
                      <div className="record-row">
                        <div>
                          <strong>{pet.name}</strong>
                          <div className="pet-owner">
                            {t('trash.trashedOn')}: <Ltr>{formatDate(deletedAt)}</Ltr> ·{' '}
                            {t('trash.daysUntilPurge', { count: String(daysLeft) })}
                          </div>
                        </div>
                        <div className="record-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleRestorePet(pet)}
                            disabled={restoringPetId === pet.id}
                          >
                            {restoringPetId === pet.id ? t('common.saving') : t('trash.restore')}
                          </button>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => handlePurgePet(pet)}
                            disabled={purgingPetId === pet.id}
                          >
                            {purgingPetId === pet.id ? t('common.saving') : t('trash.purgeNow')}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="record-edit-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="cancel-button" onClick={() => setTrashModalOpen(false)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PetsPage

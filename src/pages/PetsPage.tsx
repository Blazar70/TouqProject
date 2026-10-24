import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { formatDate } from '../lib/format'
import { matchesPetSearch } from '../lib/appointmentSearch'
import FormError from '../components/FormError'
import Modal from '../components/Modal'

type Pet = Database['public']['Tables']['pets']['Row']

const TRASH_RETENTION_DAYS = 7

function PetsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const confirm = useConfirm()
  const toast = useToast()
  const [pets, setPets] = useState<Pet[]>([])
  const [loading, setLoading] = useState(true)
  // The open pet file lives in the URL (/pets/<id>): Back closes it, links and reloads reopen it.
  const { id: expandedPetId = null } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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

  // Opened by URL (link, Back/Forward, reload): bring the pet into view; an unknown or deleted pet falls back to the list.
  useEffect(() => {
    if (loading || !expandedPetId) return
    if (!pets.some((pet) => pet.id === expandedPetId)) {
      navigate('/pets', { replace: true })
      return
    }
    requestAnimationFrame(() => {
      document.getElementById(`pet-row-${expandedPetId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, expandedPetId])

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
    if (expandedPetId === pet.id) navigate('/pets', { replace: true })
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
    // Photo paths first: records cascade with the pet, and deleting rows leaves the files (nightly S9).
    const { data: records } = await supabase.from('medical_records').select('photo_url').eq('pet_id', pet.id).not('photo_url', 'is', null)
    const photoPaths = [pet.photo_url, ...(records ?? []).map((r) => r.photo_url)]
      .filter((path): path is string => !!path)
      .map((path) => path.split('?')[0])
    const { error } = await supabase.from('pets').delete().eq('id', pet.id)
    if (error) {
      toast.error(error.message)
      setPurgingPetId(null)
      return
    }
    const { error: removeError } = photoPaths.length ? await supabase.storage.from('pet-photos').remove(photoPaths) : { error: null }
    setTrashedPets((current) => current.filter((p) => p.id !== pet.id))
    if (removeError) toast.error(t('trash.purgedPhotosLeft', { name: pet.name }))
    else toast.success(t('trash.purged', { name: pet.name }))
    setPurgingPetId(null)
  }

  function handlePetUpdated(updated: Pet) {
    setPets((current) => current.map((p) => (p.id === updated.id ? updated : p)))
  }

  // Real navigation now, so PetDetail's unsaved-changes guard (useBlocker) asks before leaving a dirty file.
  function handleRowToggle(pet: Pet) {
    if (expandedPetId === pet.id) {
      navigate('/pets')
      requestAnimationFrame(() => {
        document.getElementById(`pet-row-${pet.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
      return
    }
    navigate(`/pets/${pet.id}`)
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

      <FormError message={error} />

      <input
        type="search"
        className="search-input"
        placeholder={t('pets.searchPlaceholder')}
        aria-label={t('pets.searchPlaceholder')}
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
                </div>
              </div>
              {expandedPetId === pet.id && (
                <PetDetail
                  pet={pet}
                  onUpdated={handlePetUpdated}
                  onDelete={() => handleDeletePet(pet)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {profile?.role === 'vet' && (
        <button type="button" className="secondary-button pets-trash-button" onClick={openTrash}>
          <Trash2 size={16} aria-hidden /> {t('trash.deletedPets')}
        </button>
      )}

      {trashModalOpen && (
        <Modal onClose={() => setTrashModalOpen(false)} labelledBy="pets-trash-title">
            <h2 id="pets-trash-title">
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
                          {/* Nurses can't delete pets (0075). */}
                          {profile?.clinic_role !== 'nurse' && (
                            <button
                              type="button"
                              className="delete-button"
                              onClick={() => handlePurgePet(pet)}
                              disabled={purgingPetId === pet.id}
                            >
                              {purgingPetId === pet.id ? t('common.saving') : t('trash.purgeNow')}
                            </button>
                          )}
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
        </Modal>
      )}
    </div>
  )
}

export default PetsPage

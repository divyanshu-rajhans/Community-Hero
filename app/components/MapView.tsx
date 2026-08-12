'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import type { Report, ClusterGroup, Status } from '@/lib/types'
import { CATEGORY_ICONS, CATEGORY_LABELS, SEVERITY_COLORS, STATUS_LABELS, STATUS_NEXT } from '@/lib/types'
import SeverityIndicator from './SeverityIndicator'
import StatusBadge from './StatusBadge'

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!
const DEFAULT_CENTER = { lat: 28.6139, lng: 77.209 }

// ── Cluster grouping logic ─────────────────────────────────────────────────────
function groupIntoClusters(reports: Report[]): ClusterGroup[] {
  const clusterMap: Record<string, Report[]> = {}

  for (const r of reports) {
    const key = r.cluster_id ?? r.id
    if (!clusterMap[key]) clusterMap[key] = []
    clusterMap[key].push(r)
  }

  const groups: ClusterGroup[] = []
  for (const clusterId of Object.keys(clusterMap)) {
    const members = clusterMap[clusterId]
    // Root = the member that IS the cluster root (cluster_id === null && id === clusterId)
    // or just the first member sorted by created_at
    const root =
      members.find((r) => r.id === clusterId && r.cluster_id === null) ??
      members.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]

    const totalConfirmations = members.reduce((sum, r) => sum + (r.verification_count ?? 0), 0)
    // At minimum show the member count itself
    const confirmations = Math.max(members.length, totalConfirmations)

    groups.push({ clusterId, root, confirmations })
  }

  return groups
}

// ── Marker color by severity ───────────────────────────────────────────────────
function markerColor(severity: string): string {
  return SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ?? '#888'
}

// ── InfoWindow content ─────────────────────────────────────────────────────────
function ClusterInfoWindow({
  group,
  onStatusChange,
  onClose,
}: {
  group: ClusterGroup
  onStatusChange: (id: string, status: Status) => void
  onClose: () => void
}) {
  const { root, confirmations } = group
  const nextStatus = STATUS_NEXT[root.status]
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [updatingConfirm, setUpdatingConfirm] = useState(false)
  const [hasConfirmed, setHasConfirmed] = useState(false)
  const [localCount, setLocalCount] = useState(confirmations)

  const handleConfirm = async () => {
    if (hasConfirmed) return
    setUpdatingConfirm(true)
    // Optimistic UI — bump count immediately
    setLocalCount((n) => n + 1)
    setHasConfirmed(true)
    try {
      const supabase = getSupabaseBrowserClient()
      await (supabase as any)
        .from('reports')
        .update({ verification_count: (root.verification_count ?? 1) + 1 })
        .eq('id', root.id)
    } catch (err) {
      console.error('Failed to confirm report:', err)
      // Roll back on failure
      setLocalCount((n) => n - 1)
      setHasConfirmed(false)
    } finally {
      setUpdatingConfirm(false)
    }
  }

  const handleStatusChange = async () => {
    if (!nextStatus) return
    setUpdatingStatus(true)
    try {
      const res = await fetch('/api/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: root.id, status: nextStatus }),
      })
      if (res.ok) {
        onStatusChange(root.id, nextStatus)
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <div className="info-panel">
      {/* Accent bar */}
      <div className="info-panel-accent-bar" />

      {/* Header */}
      <div className="info-panel-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span className="category-tag" style={{ fontSize: '0.6875rem' }}>
              {CATEGORY_ICONS[root.category]} {CATEGORY_LABELS[root.category]}
            </span>
            <SeverityIndicator severity={root.severity} size="sm" />
          </div>
          {localCount > 1 && (
            <div className="info-confirm-badge">
              ◈ {localCount} {localCount === 1 ? 'confirmation' : 'confirmations'}
            </div>
          )}
        </div>
        <button
          className="info-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Photo */}
      {root.image_url && (
        <div className="info-panel-image-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={root.image_url}
            alt={CATEGORY_LABELS[root.category]}
          />
        </div>
      )}

      {/* Body */}
      <div className="info-panel-body">
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'var(--color-paper)',
            margin: '0',
            lineHeight: 1.55,
            fontWeight: 400,
          }}
        >
          {root.description}
        </p>

        <div className="info-panel-meta">
          <StatusBadge status={root.status} size="sm" />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              color: 'rgba(184,180,172,0.5)',
              letterSpacing: '0.05em',
            }}
          >
            {new Date(root.created_at).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="info-panel-actions">
        <button
          className={`info-btn-secondary${hasConfirmed ? ' is-confirmed' : ''}`}
          onClick={handleConfirm}
          disabled={updatingConfirm || hasConfirmed}
        >
          {updatingConfirm ? (
            <><span className="spinner" style={{ width: 14, height: 14 }} /> Confirming…</>
          ) : hasConfirmed ? (
            <span className="confirm-success-label">
              <span className="confirm-check">✓</span>
              <span className="confirm-count" key={localCount}>{localCount}</span>
              <span className="confirm-text">people see this</span>
            </span>
          ) : (
            <span className="confirm-idle-label">
              <span>👁</span>
              <span className="confirm-count-idle">{localCount}</span>
              <span>see this · I see it too</span>
            </span>
          )}
        </button>

        {nextStatus && (
          <button
            className="info-btn-primary"
            onClick={handleStatusChange}
            disabled={updatingStatus}
            id={`status-btn-${root.id}`}
          >
            {updatingStatus ? (
              <><span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> Updating…</>
            ) : (
              <>→ Mark as {STATUS_LABELS[nextStatus]}</>
            )}
          </button>
        )}
      </div>

      {/* ID footer */}
      <div className="info-panel-footer">
        <span>#{root.id.slice(0, 8).toUpperCase()}</span>
        <span>{root.lat.toFixed(4)}, {root.lng.toFixed(4)}</span>
      </div>
    </div>
  )
}

// ── Map markers layer ──────────────────────────────────────────────────────────
function MarkersLayer({
  clusters,
  selectedId,
  onSelect,
  onStatusChange,
}: {
  clusters: ClusterGroup[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onStatusChange: (id: string, status: Status) => void
}) {
  const selected = clusters.find((c) => c.clusterId === selectedId) ?? null

  return (
    <>
      {clusters.map((group) => {
        const { root, confirmations, clusterId } = group
        const color = markerColor(root.severity)
        const isSelected = clusterId === selectedId
        const showCount = confirmations > 1

        return (
          <AdvancedMarker
            key={clusterId}
            position={{ lat: root.lat, lng: root.lng }}
            title={`${CATEGORY_LABELS[root.category]} — ${root.severity} severity`}
            onClick={() => onSelect(isSelected ? null : clusterId)}
          >
            <div
              className="glowing-marker-wrapper"
              style={{ '--marker-color': color } as React.CSSProperties}
            >
              {/* Dual Pulsing Radar Aura Rings */}
              <div className="marker-pulse-aura" />
              <div className="marker-pulse-aura marker-pulse-aura-delay" />

              {/* Small Hover Image Preview Badge */}
              {!isSelected && (
                <div className="marker-hover-card">
                  <div className="marker-hover-img-wrapper">
                    {root.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={root.image_url}
                        alt={CATEGORY_LABELS[root.category]}
                        className="marker-hover-img"
                      />
                    ) : (
                      <div className="marker-hover-no-img">
                        <span style={{ fontSize: '18px' }}>{CATEGORY_ICONS[root.category]}</span>
                        <span>No photo</span>
                      </div>
                    )}
                    <div className="marker-hover-badge">
                      {CATEGORY_ICONS[root.category]} {CATEGORY_LABELS[root.category]}
                    </div>
                  </div>
                  <div className="marker-hover-arrow" />
                </div>
              )}

              {/* Glowing Pin */}
              <div
                className="glowing-marker-pin"
                style={{
                  width: isSelected ? 42 : 34,
                  height: isSelected ? 42 : 34,
                  background: color,
                  border: `2px solid ${isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'}`,
                  boxShadow: isSelected
                    ? `0 0 16px ${color}, 0 0 32px ${color}, 0 4px 20px rgba(0,0,0,0.8)`
                    : `0 0 10px ${color}99, 0 3px 10px rgba(0,0,0,0.6)`,
                }}
              >
                <span
                  style={{
                    transform: 'rotate(45deg)',
                    fontSize: isSelected ? '16px' : '13px',
                    lineHeight: 1,
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))',
                  }}
                >
                  {CATEGORY_ICONS[root.category]}
                </span>
              </div>

              {/* Count badge */}
              {showCount && (
                <div
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -8,
                    background: 'var(--color-orange)',
                    color: 'white',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: '10px',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid #ffffff',
                    boxShadow: '0 0 10px rgba(212,80,42,0.9), 0 2px 6px rgba(0,0,0,0.6)',
                    zIndex: 2,
                  }}
                >
                  {confirmations > 9 ? '9+' : confirmations}
                </div>
              )}
            </div>
          </AdvancedMarker>
        )
      })}

      {/* Custom floating panel — pointer-events:none on wrapper so map/markers stay clickable */}
      {selected && (
        <AdvancedMarker
          position={{ lat: selected.root.lat, lng: selected.root.lng }}
          zIndex={999}
        >
          {/* Outer shell: pass ALL events to the map beneath */}
          <div style={{ pointerEvents: 'none' }}>
            {/* Inner card: restore events + stop propagation so POI clicks don't fire */}
            <div
              className="info-panel-float"
              style={{
                filter: 'drop-shadow(0 20px 48px rgba(0,0,0,0.85))',
                pointerEvents: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <ClusterInfoWindow
                group={selected}
                onStatusChange={onStatusChange}
                onClose={() => onSelect(null)}
              />
              {/* Caret arrow */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 0,
                  height: 0,
                  borderLeft: '9px solid transparent',
                  borderRight: '9px solid transparent',
                  borderTop: '9px solid #232220',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>
        </AdvancedMarker>
      )}
    </>
  )
}

// ── Main MapView ───────────────────────────────────────────────────────────────
interface MapViewProps {
  initialReports?: Report[]
}

export default function MapView({ initialReports = [] }: MapViewProps) {
  const [reports, setReports] = useState<Report[]>(initialReports)
  const [clusters, setClusters] = useState<ClusterGroup[]>([])
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER)
  const [liveCount, setLiveCount] = useState(0)
  const supabaseRef = useRef(getSupabaseBrowserClient())

  // Re-cluster when reports change
  useEffect(() => {
    setClusters(groupIntoClusters(reports))
  }, [reports])

  // Center on user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMapCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {} // silent fallback to default center
      )
    }
  }, [])

  // Supabase Realtime subscription
  useEffect(() => {
    const supabase = supabaseRef.current
    try {
      const channel = supabase
        .channel('reports-live')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'reports' },
          (payload) => {
            const newReport = payload.new as Report
            setReports((prev) => [newReport, ...prev])
            setLiveCount((n) => n + 1)
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'reports' },
          (payload) => {
            const updated = payload.new as Report
            setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
          }
        )
        .subscribe((status, err) => {
          if (err || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Realtime subscription issue:', err || status)
          }
        })

      return () => {
        supabase.removeChannel(channel)
      }
    } catch (err) {
      console.warn('Realtime channel setup error:', err)
    }
  }, [])

  const handleStatusChange = useCallback((id: string, status: Status) => {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
  }, [])

  const statusCounts = {
    reported: reports.filter((r) => r.status === 'reported').length,
    verified: reports.filter((r) => r.status === 'verified').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Stats bar */}
      <div
        style={{
          background: 'var(--color-asphalt-light)',
          borderBottom: '1px solid var(--color-asphalt-mid)',
          padding: '0.5rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          flexWrap: 'wrap',
          fontSize: '0.75rem',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span className="live-dot" />
          <span style={{ color: 'var(--color-paper-dim)' }}>LIVE</span>
          {liveCount > 0 && (
            <span style={{ color: 'var(--color-orange)' }}>+{liveCount} new</span>
          )}
        </div>
        <span style={{ color: 'var(--color-paper-dark)' }}>
          {clusters.length} unique issues
        </span>
        <span style={{ color: 'var(--color-status-reported)' }}>
          {statusCounts.reported} reported
        </span>
        <span style={{ color: 'var(--color-status-verified)' }}>
          {statusCounts.verified} verified
        </span>
        <span style={{ color: 'var(--color-status-resolved)' }}>
          {statusCounts.resolved} resolved
        </span>

        {/* Legend */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            color: 'var(--color-paper-dark)',
          }}
        >
          {(['low', 'medium', 'high'] as const).map((sev) => (
            <span key={sev} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: SEVERITY_COLORS[sev],
                }}
              />
              {sev}
            </span>
          ))}
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        {reports.length === 0 && (
          <div
            className="empty-state"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              background: 'rgba(28,27,25,0.7)',
              pointerEvents: 'none',
            }}
          >
            <span className="empty-state-icon">🗺️</span>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.25rem',
                letterSpacing: '0.06em',
              }}
            >
              No Reports Yet
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem' }}>
              Be the first to report an issue in your area.
            </p>
          </div>
        )}

        <APIProvider apiKey={MAPS_API_KEY}>
          <Map
            defaultCenter={mapCenter}
            center={mapCenter}
            defaultZoom={13}
            mapId="community-hero-map"
            colorScheme="DARK"
            disableDefaultUI={false}
            gestureHandling="greedy"
            style={{ width: '100%', height: '100%' }}
            onCameraChanged={(ev) => setMapCenter(ev.detail.center)}
          >
            <MarkersLayer
                clusters={clusters}
                selectedId={selectedClusterId}
                onSelect={setSelectedClusterId}
                onStatusChange={handleStatusChange}
              />
          </Map>
        </APIProvider>
      </div>
    </div>
  )
}

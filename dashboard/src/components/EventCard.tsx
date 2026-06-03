import { formatDistanceToNow } from 'date-fns';
import type { Event } from '../lib/supabase';

// ── Severity config ───────────────────────────────────────────

const SEVERITY: Record<number, { label: string; color: string; bg: string; dot: string }> = {
  1: { label: 'Info',     color: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
  2: { label: 'Minor',    color: '#0369a1', bg: '#e0f2fe', dot: '#38bdf8' },
  3: { label: 'Moderate', color: '#b45309', bg: '#fef3c7', dot: '#fbbf24' },
  4: { label: 'Major',    color: '#b91c1c', bg: '#fee2e2', dot: '#f87171' },
  5: { label: 'Critical', color: '#7c2d12', bg: '#fecdd3', dot: '#ef4444' },
};

// ── Event type labels ─────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  upgrade:          'Upgrade',
  migration:        'Migration',
  airdrop:          'Airdrop',
  token_burn:       'Token Burn',
  listing:          'Listing',
  partnership:      'Partnership',
  governance:       'Governance',
  mainnet_launch:   'Mainnet Launch',
  testnet:          'Testnet',
  vesting_unlock:   'Vesting Unlock',
  relaunch:         'Relaunch',
  hardware_update:  'Hardware Update',
  product_launch:   'Product Launch',
  security_breach:  'Security Breach',
  exploit:          'Exploit',
  downtime:         'Downtime',
  regulatory_action:'Regulatory',
  controversy:      'Controversy',
  delisting:        'Delisting',
  emergency_patch:  'Emergency Patch',
  community_revolt: 'Community',
  rug_pull:         'Rug Pull',
  incident:         'Incident',
  market_anomaly:   'Market Anomaly',
};

const PLATFORM_ICONS: Record<string, string> = {
  'Twitter/X':     '𝕏',
  'GitHub':        'GH',
  'GitHub Security': '⚠',
  'CoinDesk':      'CD',
  'Cointelegraph': 'CT',
  'The Block':     'TB',
  'Decrypt':       'DC',
};

interface EventCardProps {
  event:    Event;
  isNew?:   boolean;
  onFilter?: (field: string, value: string) => void;
}

export function EventCard({ event, isNew, onFilter }: EventCardProps) {
  const sev      = SEVERITY[event.severity] ?? SEVERITY[3];
  const project  = event.project;
  const timeAgo  = formatDistanceToNow(new Date(event.detected_at), { addSuffix: true });
  const typeLabel= EVENT_LABELS[event.event_type] ?? event.event_type;
  const platIcon = PLATFORM_ICONS[event.source_platform] ?? event.source_platform.slice(0, 2).toUpperCase();

  return (
    <article
      className={`event-card${isNew ? ' event-card--new' : ''}${event.event_category === 'unplanned' ? ' event-card--unplanned' : ''}`}
      style={{
        borderLeft: `3px solid ${sev.dot}`,
        animation: isNew ? 'slideIn 0.4s ease' : undefined,
      }}
    >
      {/* Header row */}
      <div className="event-card__header">
        <div className="event-card__badges">
          {/* Severity badge */}
          <span
            className="badge"
            style={{ color: sev.color, background: sev.bg }}
          >
            <span
              className="badge__dot"
              style={{
                background: sev.dot,
                boxShadow: event.severity >= 4 ? `0 0 6px ${sev.dot}` : undefined,
              }}
            />
            {sev.label}
          </span>

          {/* Category */}
          <span className={`badge badge--category badge--${event.event_category}`}>
            {event.event_category === 'planned' ? '📅 Planned' : '⚡ Unplanned'}
          </span>

          {/* Type */}
          <button
            className="badge badge--type badge--clickable"
            onClick={() => onFilter?.('event_type', event.event_type)}
            title="Filter by this type"
          >
            {typeLabel}
          </button>
        </div>

        <div className="event-card__meta-right">
          {/* Source platform chip */}
          <a
            href={event.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
            title={`View original on ${event.source_platform}`}
          >
            <span className="source-link__icon">{platIcon}</span>
            <span className="source-link__label">{event.source_platform}</span>
            <span className="source-link__arrow">↗</span>
          </a>

          <time className="event-card__time" title={event.detected_at}>
            {timeAgo}
          </time>
        </div>
      </div>

      {/* Project row */}
      {project && (
        <button
          className="event-card__project"
          onClick={() => onFilter?.('project_id', event.project_id)}
          title="Filter by this project"
        >
          {project.logo_url && (
            <img
              src={project.logo_url}
              alt={project.name}
              className="event-card__logo"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span className="event-card__project-name">{project.name}</span>
          <span className="event-card__category-badge">{project.category}</span>
        </button>
      )}

      {/* Title */}
      <h3 className="event-card__title">{event.title}</h3>

      {/* Description */}
      <p className="event-card__description">{event.description}</p>

      {/* Tags */}
      {event.tags?.length > 0 && (
        <div className="event-card__tags">
          {event.tags.map(tag => (
            <span key={tag} className="tag">#{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
}

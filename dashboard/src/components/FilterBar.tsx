import type { Project, EventFilter } from '../lib/supabase';

const EVENT_TYPES = [
  { value: '',                  label: 'All types' },
  { value: 'security_breach',  label: '🔴 Security breach' },
  { value: 'exploit',          label: '🔴 Exploit' },
  { value: 'downtime',         label: '🔴 Downtime' },
  { value: 'rug_pull',         label: '🔴 Rug pull' },
  { value: 'emergency_patch',  label: '🟠 Emergency patch' },
  { value: 'regulatory_action',label: '🟠 Regulatory action' },
  { value: 'controversy',      label: '🟡 Controversy' },
  { value: 'delisting',        label: '🟡 Delisting' },
  { value: 'upgrade',          label: '🟢 Upgrade' },
  { value: 'mainnet_launch',   label: '🟢 Mainnet launch' },
  { value: 'listing',          label: '🟢 Listing' },
  { value: 'airdrop',          label: '🟢 Airdrop' },
  { value: 'governance',       label: '🔵 Governance' },
  { value: 'partnership',      label: '🔵 Partnership' },
  { value: 'token_burn',       label: '🔵 Token burn' },
  { value: 'vesting_unlock',   label: '🔵 Vesting unlock' },
  { value: 'product_launch',   label: '🔵 Product launch' },
];

interface FilterBarProps {
  filter:     EventFilter;
  projects:   Project[];
  totalCount: number;
  liveCount:  number;
  onFilterChange: (filter: Partial<EventFilter>) => void;
  onClear:    () => void;
}

export function FilterBar({
  filter, projects, totalCount, liveCount,
  onFilterChange, onClear,
}: FilterBarProps) {
  const hasActiveFilter =
    filter.project_id ||
    (filter.event_category && filter.event_category !== 'all') ||
    filter.event_type ||
    (filter.min_severity && filter.min_severity > 1) ||
    filter.search;

  return (
    <div className="filter-bar">
      {/* Search */}
      <div className="filter-bar__search-wrap">
        <span className="filter-bar__search-icon">⌕</span>
        <input
          type="text"
          className="filter-bar__search"
          placeholder="Search events…"
          value={filter.search ?? ''}
          onChange={e => onFilterChange({ search: e.target.value })}
        />
      </div>

      {/* Project selector */}
      <select
        className="filter-bar__select"
        value={filter.project_id ?? ''}
        onChange={e => onFilterChange({ project_id: e.target.value || undefined })}
      >
        <option value="">All projects ({projects.length})</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.category})
          </option>
        ))}
      </select>

      {/* Category */}
      <select
        className="filter-bar__select"
        value={filter.event_category ?? 'all'}
        onChange={e => onFilterChange({
          event_category: (e.target.value as EventFilter['event_category']) || 'all'
        })}
      >
        <option value="all">All categories</option>
        <option value="planned">📅 Planned</option>
        <option value="unplanned">⚡ Unplanned</option>
      </select>

      {/* Event type */}
      <select
        className="filter-bar__select"
        value={filter.event_type ?? ''}
        onChange={e => onFilterChange({ event_type: e.target.value || undefined })}
      >
        {EVENT_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* Min severity */}
      <div className="filter-bar__severity">
        <span className="filter-bar__severity-label">Min severity</span>
        <div className="filter-bar__severity-buttons">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              className={`sev-btn sev-btn--${s}${(filter.min_severity ?? 1) === s ? ' sev-btn--active' : ''}`}
              onClick={() => onFilterChange({ min_severity: s })}
              title={['Info', 'Minor', 'Moderate', 'Major', 'Critical'][s - 1]}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Stats + Clear */}
      <div className="filter-bar__right">
        {liveCount > 0 && (
          <span className="live-indicator">
            <span className="live-indicator__dot" />
            {liveCount} new
          </span>
        )}
        <span className="filter-bar__count">{totalCount} events</span>
        {hasActiveFilter && (
          <button className="filter-bar__clear" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

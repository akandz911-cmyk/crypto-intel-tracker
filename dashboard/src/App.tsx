import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import type { Event, Project, EventFilter } from './lib/supabase';
import { EventCard } from './components/EventCard';
import { FilterBar } from './components/FilterBar';
import './App.css';

const PAGE_SIZE = 30;

// ── Main App ──────────────────────────────────────────────────

export default function App() {
  const [events,   setEvents]   = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter,   setFilter]   = useState<EventFilter>({ event_category: 'all', min_severity: 1 });
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [newIds,   setNewIds]   = useState<Set<string>>(new Set());
  const [liveCount, setLiveCount] = useState(0);
  const [page,     setPage]     = useState(0);
  const [hasMore,  setHasMore]  = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Build Supabase query from filter ─────────────────────────

  const buildQuery = useCallback((f: EventFilter, pageNum: number) => {
    let q = supabase
      .from('events')
      .select(`
        *,
        project:projects (
          id, name, slug, category, ecosystem, logo_url, significance_score, tvl_usd
        )
      `, { count: 'exact' })
      .order('detected_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

    if (f.project_id)    q = q.eq('project_id', f.project_id);
    if (f.event_category && f.event_category !== 'all')
                         q = q.eq('event_category', f.event_category);
    if (f.event_type)    q = q.eq('event_type', f.event_type);
    if (f.min_severity && f.min_severity > 1)
                         q = q.gte('severity', f.min_severity);
    if (f.search)        q = q.or(`title.ilike.%${f.search}%,description.ilike.%${f.search}%`);

    return q;
  }, []);

  // ── Fetch events ──────────────────────────────────────────────

  const fetchEvents = useCallback(async (f: EventFilter, pageNum: number, append = false) => {
    setLoading(!append);
    try {
      const { data, error: err, count } = await buildQuery(f, pageNum);
      if (err) throw err;
      const fetched = (data ?? []) as unknown as Event[];
      setEvents(prev => append ? [...prev, ...fetched] : fetched);
      setHasMore((count ?? 0) > (pageNum + 1) * PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  // ── Fetch projects (for filter dropdown) ─────────────────────

  const fetchProjects = useCallback(async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, name, slug, category, ecosystem, logo_url, significance_score, tvl_usd')
      .eq('is_active', true)
      .order('significance_score', { ascending: false })
      .limit(300);
    setProjects((data ?? []) as Project[]);
  }, []);

  // ── Initial load ──────────────────────────────────────────────

  useEffect(() => {
    fetchProjects();
    fetchEvents(filter, 0);
  }, []); // eslint-disable-line

  // ── Re-fetch on filter change ─────────────────────────────────

  useEffect(() => {
    setPage(0);
    setLiveCount(0);
    fetchEvents(filter, 0);
  }, [filter, fetchEvents]);

  // ── Supabase Realtime subscription ───────────────────────────

  useEffect(() => {
    // Unsubscribe from any previous channel
    channelRef.current?.unsubscribe();

    const channel = supabase
      .channel('public:events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        async (payload) => {
          const newEvent = payload.new as Event;

          // Check if the new event matches current filters
          const passesSeverity = !filter.min_severity || newEvent.severity >= filter.min_severity;
          const passesCategory = !filter.event_category || filter.event_category === 'all'
            || newEvent.event_category === filter.event_category;
          const passesProject  = !filter.project_id || newEvent.project_id === filter.project_id;
          const passesType     = !filter.event_type || newEvent.event_type === filter.event_type;

          if (!passesSeverity || !passesCategory || !passesProject || !passesType) {
            return;
          }

          // Hydrate project info
          const { data: projectData } = await supabase
            .from('projects')
            .select('id, name, slug, category, ecosystem, logo_url, significance_score, tvl_usd')
            .eq('id', newEvent.project_id)
            .single();

          const hydratedEvent = {
            ...newEvent,
            project: projectData as Project,
          };

          // Prepend to list, mark as new for animation
          setEvents(prev => [hydratedEvent, ...prev]);
          setNewIds(prev => new Set([...prev, newEvent.id]));
          setLiveCount(prev => prev + 1);

          // Remove the "new" highlight after 5 seconds
          setTimeout(() => {
            setNewIds(prev => {
              const next = new Set(prev);
              next.delete(newEvent.id);
              return next;
            });
          }, 5000);
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [filter]);

  // ── Filter change handlers ────────────────────────────────────

  const handleFilterChange = useCallback((partial: Partial<EventFilter>) => {
    setFilter(prev => ({ ...prev, ...partial }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilter({ event_category: 'all', min_severity: 1 });
  }, []);

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchEvents(filter, nextPage, true);
  }, [page, filter, fetchEvents]);

  // ── Field-click filtering (from EventCard) ────────────────────

  const handleCardFilter = useCallback((field: string, value: string) => {
    setFilter(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="app-header__brand">
            <div className="app-header__logo">⬡</div>
            <div>
              <h1 className="app-header__title">Crypto Intelligence</h1>
              <p className="app-header__subtitle">
                Automated tracking across {projects.length} projects · Updates every 15 min
              </p>
            </div>
          </div>
          <div className="app-header__status">
            <span className="status-dot status-dot--live" />
            <span className="status-text">Live</span>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="filter-bar-wrap">
        <FilterBar
          filter={filter}
          projects={projects}
          totalCount={events.length}
          liveCount={liveCount}
          onFilterChange={handleFilterChange}
          onClear={handleClearFilters}
        />
      </div>

      {/* Timeline */}
      <main className="timeline">
        {error && (
          <div className="error-banner">
            ⚠ Failed to load events: {error}
            <button onClick={() => fetchEvents(filter, 0)}>Retry</button>
          </div>
        )}

        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <span>Loading events…</span>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__icon">⬡</span>
            <p>No events match the current filters.</p>
            <button onClick={handleClearFilters}>Clear filters</button>
          </div>
        )}

        <div className="event-list">
          {events.map(event => (
            <EventCard
              key={event.id}
              event={event}
              isNew={newIds.has(event.id)}
              onFilter={handleCardFilter}
            />
          ))}
        </div>

        {hasMore && !loading && events.length > 0 && (
          <div className="load-more-wrap">
            <button className="load-more-btn" onClick={handleLoadMore}>
              Load more events
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

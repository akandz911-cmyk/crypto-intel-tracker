async function resolveProjectId(rawItem: RawContent): Promise<string | null> {
  if (rawItem.project_id) return rawItem.project_id;

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug, token_symbol')
    .eq('is_active', true)
    .order('significance_score', { ascending: false })
    .limit(250);

  if (!projects) return null;
  const text = rawItem.raw_text.toLowerCase();

  for (const p of projects) {
    const name   = p.name?.toLowerCase() ?? '';
    const symbol = p.token_symbol?.toLowerCase() ?? '';
    const slug   = p.slug?.toLowerCase() ?? '';
    if (name.length   > 2 && text.includes(name))   return p.id;
    if (symbol.length > 2 && text.includes(symbol)) return p.id;
    if (slug.length   > 3 && text.includes(slug))   return p.id;
  }

  // Fallback — link to general crypto news project rather than discard the event
  const { data: fallback } = await supabase
    .from('projects').select('id').eq('slug', 'general-crypto-news').single();
  return fallback?.id ?? null;
}

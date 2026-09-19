-- Enable only after the deployed fixed-purpose endpoint has passed a signed refresh.
-- pg_cron replaces the existing named job rather than adding duplicates.
select cron.schedule(
  'hou-match-current-context',
  '*/15 * * * *',
  'select hou_match_private.request_context_refresh();'
);

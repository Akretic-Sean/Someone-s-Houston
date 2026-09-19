# Private saved reports

Apply the private_saved_reports migration before deploying this frontend. No migration or deployment is performed by this PR.

Dashboard identity comes from the signed-in account, falling back to email. Reports and counts come from Supabase, with ownership enforced by RLS. Latest 100 reports are listed; the count includes all saved reports. No invented engagement metrics remain.

Successful generation saves preferences and the complete original snapshot privately. Save failure leaves the report visible with a retry button using the same UUID. Reopening restores preferences, retrieves current evidence, and recomputes scores without another AI call. The original snapshot is retained, but there is no historical snapshot viewer in this release. Connector controls remain demonstrations.

Frontend handoff: use src/data/savedReports.ts and the authenticated client. Never use a service-role key in the frontend. Verify generation, save, reload, dashboard, reopen, and isolation between two accounts after applying the migration. Candidate preferences are private; deleting the auth account cascades to its saved reports.

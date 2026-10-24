import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** Records an action in the audit_log table. */
export function audit(accountId, userId, action, details = {}) {
	return pool.query(
		'INSERT INTO audit_log (account_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
		[accountId, userId, action, details]
	);
}

import express from 'express';
import { pool } from '../db/pool.js';

export const invoicesRouter = express.Router();

invoicesRouter.get('/', async (req, res) => {
	const { rows } = await pool.query(
		`SELECT id, number, issue_date, status, customer_name, total, currency
		   FROM invoices WHERE account_id = $1 ORDER BY issue_date DESC LIMIT 100`,
		[req.user.accountId]
	);
	res.json(rows);
});

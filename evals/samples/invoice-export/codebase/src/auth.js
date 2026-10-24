/** Rejects requests without a valid session cookie; sets req.user. */
export function requireSession(req, res, next) {
	const user = req.session?.user;
	if (!user) return res.status(401).json({ error: 'Sign in first' });
	req.user = user;
	next();
}

const RANK = { member: 1, accountant: 2, owner: 3 };

/** Allows users whose role is at least `role`. */
export function requireRole(role) {
	return (req, res, next) =>
		RANK[req.user.role] >= RANK[role]
			? next()
			: res.status(403).json({ error: 'Not allowed' });
}

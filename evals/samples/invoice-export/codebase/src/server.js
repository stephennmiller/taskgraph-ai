import express from 'express';
import { requireRole, requireSession } from './auth.js';
import { invoicesRouter } from './routes/invoices.js';

const app = express();
app.use(express.json());
app.use(requireSession);
app.use('/invoices', requireRole('member'), invoicesRouter);

app.listen(process.env.PORT ?? 3000);

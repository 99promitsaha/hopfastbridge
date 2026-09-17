import { Router } from 'express';
import healthRoutes from './health.routes.js';
import quotesRoutes from './quotes.routes.js';
import swapsRoutes from './swaps.routes.js';
import transactionsRoutes from './transactions.routes.js';
import walletsRoutes from './wallets.routes.js';
import statusRoutes from './status.routes.js';
import earnRoutes from './earn.routes.js';
import statsRoutes from './stats.routes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/', quotesRoutes);
router.use('/', swapsRoutes);
router.use('/', transactionsRoutes);
router.use('/', walletsRoutes);
router.use('/', statusRoutes);
router.use('/', earnRoutes);
router.use('/', statsRoutes);

export default router;

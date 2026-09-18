import { Router } from 'express';
import architectsRoutes from './architects.routes.js';
import architectDeploymentRoutes from './architectDeployment.routes.js';
import healthRoutes from './health.routes.js';
import quotesRoutes from './quotes.routes.js';
import swapsRoutes from './swaps.routes.js';
import transactionsRoutes from './transactions.routes.js';
import walletsRoutes from './wallets.routes.js';
import statusRoutes from './status.routes.js';
import statsRoutes from './stats.routes.js';
import grantsRoutes from './grants.routes.js';

import paymentRoutes from './payments.routes.js';

import priceRoutes from './prices.routes.js';

const router = Router();
router.use('/', architectDeploymentRoutes);
router.use('/', architectsRoutes);
router.use('/', grantsRoutes);
router.use('/', priceRoutes);
router.use('/', paymentRoutes);

router.use('/', healthRoutes);
router.use('/', quotesRoutes);
router.use('/', swapsRoutes);
router.use('/', transactionsRoutes);
router.use('/', walletsRoutes);
router.use('/', statusRoutes);
router.use('/', statsRoutes);

export default router;

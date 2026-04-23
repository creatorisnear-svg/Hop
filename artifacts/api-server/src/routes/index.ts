import { Router, type IRouter } from "express";
import healthRouter from "./health";
import regionsRouter from "./regions";
import runsRouter from "./runs";
import insightsRouter from "./insights";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regionsRouter);
router.use(runsRouter);
router.use(insightsRouter);

export default router;

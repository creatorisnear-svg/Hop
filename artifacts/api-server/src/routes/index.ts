import { Router, type IRouter } from "express";
import healthRouter from "./health";
import regionsRouter from "./regions";
import runsRouter from "./runs";
import insightsRouter from "./insights";
import synapsesRouter from "./synapses";
import toolsRouter from "./tools";
import sleepRouter from "./sleep";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regionsRouter);
router.use(runsRouter);
router.use(insightsRouter);
router.use(synapsesRouter);
router.use(toolsRouter);
router.use(sleepRouter);

export default router;

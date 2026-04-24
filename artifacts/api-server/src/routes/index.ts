import { Router, type IRouter } from "express";
import healthRouter from "./health";
import regionsRouter from "./regions";
import runsRouter from "./runs";
import insightsRouter from "./insights";
import synapsesRouter from "./synapses";
import toolsRouter from "./tools";
import sleepRouter from "./sleep";
import modulatorsRouter from "./modulators";
import webhooksRouter from "./webhooks";
import pluginsRouter from "./plugins";
import jarvisChatRouter from "./jarvisChat";
import jarvisMemoryRouter from "./jarvisMemory";
import imagesRouter from "./images";
import keysRouter from "./keys";
import jarvisActionsRouter from "./jarvisActions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(regionsRouter);
router.use(runsRouter);
router.use(insightsRouter);
router.use(synapsesRouter);
router.use(toolsRouter);
router.use(sleepRouter);
router.use(modulatorsRouter);
router.use(webhooksRouter);
router.use(pluginsRouter);
router.use(jarvisChatRouter);
router.use(jarvisMemoryRouter);
router.use(imagesRouter);
router.use(keysRouter);
router.use(jarvisActionsRouter);

export default router;

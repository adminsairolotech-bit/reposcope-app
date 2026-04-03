import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reposRouter from "./repos";
import playstoreRouter from "./playstore";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reposRouter);
router.use(playstoreRouter);

export default router;

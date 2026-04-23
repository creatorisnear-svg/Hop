import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the built SPA from the colocated dist/public folder.
// The Docker build copies the vite build output here.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(__dirname, "public"),
  path.resolve(__dirname, "..", "public"),
  path.resolve(__dirname, "..", "..", "neuro-brain", "dist", "public"),
];
const spaRoot = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));

if (spaRoot) {
  logger.info({ spaRoot }, "Serving SPA static files");
  app.use(express.static(spaRoot));
  app.get(/^(?!\/api).*/, (_req: Request, res: Response, next: NextFunction) => {
    const indexPath = path.join(spaRoot, "index.html");
    res.sendFile(indexPath, (err) => {
      if (err) next(err);
    });
  });
}

export default app;

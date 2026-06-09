import { createServer } from "http";

/** Minimal health-check server on PORT (default 3000) for Fly.io TCP checks. */
export function startHealthServer(): void {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  createServer((_, res) => {
    res.writeHead(200);
    res.end("ok");
  }).listen(port, () => {
    console.log(`[health] listening on :${port}`);
  });
}

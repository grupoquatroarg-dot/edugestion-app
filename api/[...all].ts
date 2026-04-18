import { createVercelApp } from "../server/app.vercel.js";

let cachedApp: ReturnType<typeof createVercelApp> | null = null;

export default function handler(req: any, res: any) {
  if (!cachedApp) {
    cachedApp = createVercelApp();
  }

  return cachedApp(req, res);
}

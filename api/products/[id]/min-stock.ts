import { handleProductInventoryAction } from "../../../server/services/vercel/productInventoryApiHelpers.js";

export default async function handler(req: any, res: any) {
  return handleProductInventoryAction(req, res, "min-stock");
}

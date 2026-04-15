import { Router } from "express";
import db from "../db.js";
import { requirePermission } from "../middleware/authMiddleware.js";
import { getIo } from "../socket.js";
import { sendSuccess } from "../utils/response.js";

const router = Router();

router.get("/preview", requirePermission('products', 'view'), (req, res) => {
  const { scope, family_id, company, active_only, product_id } = req.query;
  let query = "SELECT p.*, f.name as family_name FROM products p LEFT JOIN product_families f ON p.family_id = f.id WHERE p.eliminado = 0";
  const params: any[] = [];

  if (scope === 'family' && family_id) {
    query += " AND p.family_id = ?";
    params.push(family_id);
  } else if (scope === 'company' && company) {
    query += " AND p.company = ?";
    params.push(company);
  } else if (scope === 'manual' && product_id) {
    query += " AND p.id = ?";
    params.push(product_id);
  }

  if (active_only === 'true') {
    query += " AND p.estado = 'activo'";
  }

  const products = db.prepare(query).all(...params);
  return sendSuccess(res, products);
});

router.post("/apply", requirePermission('products', 'edit'), (req, res) => {
  const { scope, family_id, company, active_only, product_id, target_field, change_type, value, update_sale_price, new_margin, user_email } = req.body;
  const numericValue = Number(value);
  const io = getIo();

  const updatedProducts: any[] = [];
  const transaction = db.transaction(() => {
    let selectQuery = "SELECT id, sale_price, cost FROM products WHERE eliminado = 0";
    const params: any[] = [];

    if (scope === 'family' && family_id) {
      selectQuery += " AND family_id = ?";
      params.push(family_id);
    } else if (scope === 'company' && company) {
      selectQuery += " AND company = ?";
      params.push(company);
    } else if (scope === 'manual' && product_id) {
      selectQuery += " AND id = ?";
      params.push(product_id);
    }

    if (active_only) {
      selectQuery += " AND estado = 'activo'";
    }

    const productsToUpdate = db.prepare(selectQuery).all(...params) as any[];
    
    for (const product of productsToUpdate) {
      let newCost = product.cost;
      let newSalePrice = product.sale_price;

      if (target_field === 'cost') {
        if (change_type === 'increase_pct') {
          newCost = product.cost * (1 + numericValue / 100);
        } else if (change_type === 'decrease_pct') {
          newCost = product.cost * (1 - numericValue / 100);
        } else if (change_type === 'increase_fixed') {
          newCost = product.cost + numericValue;
        } else if (change_type === 'decrease_fixed') {
          newCost = product.cost - numericValue;
        }

        if (update_sale_price) {
          const margin = Number(new_margin) / 100;
          if (margin < 1) {
            newSalePrice = newCost / (1 - margin);
          }
        }
      } else {
        if (change_type === 'increase_pct') {
          newSalePrice = product.sale_price * (1 + numericValue / 100);
        } else if (change_type === 'decrease_pct') {
          newSalePrice = product.sale_price * (1 - numericValue / 100);
        } else if (change_type === 'increase_fixed') {
          newSalePrice = product.sale_price + numericValue;
        } else if (change_type === 'decrease_fixed') {
          newSalePrice = product.sale_price - numericValue;
        } else if (change_type === 'replace_margin' || change_type === 'recalculate_peps') {
          const margin = numericValue / 100;
          if (margin < 1) {
            newSalePrice = product.cost / (1 - margin);
          }
        }
      }

      db.prepare("UPDATE products SET cost = ?, sale_price = ? WHERE id = ?").run(newCost, newSalePrice, product.id);
      
      const updated = db.prepare("SELECT p.*, f.name as family_name FROM products p LEFT JOIN product_families f ON p.family_id = f.id WHERE p.id = ?").get(product.id);
      updatedProducts.push(updated);
    }

    db.prepare(
      "INSERT INTO price_update_history (usuario, alcance, tipo_cambio, valor, productos_afectados) VALUES (?, ?, ?, ?, ?)"
    ).run(user_email, `${scope} (${target_field})`, change_type, numericValue, productsToUpdate.length);

    return productsToUpdate.length;
  });

  const count = transaction();
  updatedProducts.forEach(p => io.emit("product_updated", p));
  return sendSuccess(res, { count }, "Actualización masiva aplicada exitosamente");
});

router.get("/history", requirePermission('products', 'view'), (req, res) => {
  const history = db.prepare("SELECT * FROM price_update_history ORDER BY fecha DESC LIMIT 50").all();
  return sendSuccess(res, history);
});

export default router;

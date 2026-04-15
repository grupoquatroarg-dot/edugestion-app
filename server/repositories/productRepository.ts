import db from "../db.js";

export const ProductRepository = {
  findAll() {
    return db.prepare(`
      SELECT p.*, f.name as family_name, c.name as category_name
      FROM products p
      LEFT JOIN product_families f ON p.family_id = f.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      WHERE p.eliminado = 0
      ORDER BY p.name ASC
    `).all();
  },

  findById(id: number) {
    return db.prepare(`
      SELECT p.*, f.name as family_name, c.name as category_name
      FROM products p
      LEFT JOIN product_families f ON p.family_id = f.id
      LEFT JOIN product_categories c ON p.category_id = c.id
      WHERE p.id = ? AND p.eliminado = 0
    `).get(id);
  },

  create(productData: any) {
    const { code, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado } = productData;
    const codigo_unico = `${company}-${code}`;
    
    // Check if codigo_unico already exists
    const existing = db.prepare("SELECT id, eliminado FROM products WHERE codigo_unico = ?").get(codigo_unico) as any;
    if (existing) {
      if (existing.eliminado) {
        throw new Error(`El código ${codigo_unico} ya existe en un producto eliminado. Por favor use otro código o restaure el producto.`);
      } else {
        throw new Error(`El código ${codigo_unico} ya está en uso.`);
      }
    }

    const info = db.prepare(`
      INSERT INTO products (code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado);
    return this.findById(Number(info.lastInsertRowid));
  },

  update(id: number, productData: any) {
    const { code, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado } = productData;
    const codigo_unico = `${company}-${code}`;

    // Check if codigo_unico already exists for ANOTHER product
    const existing = db.prepare("SELECT id, eliminado FROM products WHERE codigo_unico = ? AND id != ?").get(codigo_unico, id) as any;
    if (existing) {
      if (existing.eliminado) {
        throw new Error(`El código ${codigo_unico} ya existe en un producto eliminado.`);
      } else {
        throw new Error(`El código ${codigo_unico} ya está en uso por otro producto.`);
      }
    }

    db.prepare(`
      UPDATE products 
      SET code = ?, codigo_unico = ?, name = ?, description = ?, cost = ?, sale_price = ?, stock = ?, stock_minimo = ?, company = ?, family_id = ?, category_id = ?, estado = ?
      WHERE id = ?
    `).run(code, codigo_unico, name, description, cost, sale_price, stock, stock_minimo, company, family_id, category_id, estado, id);
    return this.findById(id);
  },

  softDelete(id: number) {
    return db.prepare("UPDATE products SET eliminado = 1 WHERE id = ?").run(id);
  },

  hasSales(id: number) {
    return db.prepare("SELECT id FROM sale_items WHERE product_id = ? LIMIT 1").get(id);
  }
};

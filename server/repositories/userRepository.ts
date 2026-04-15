import db from "../db.js";
import bcrypt from "bcryptjs";

export const UserRepository = {
  findByEmail(email: string) {
    return db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
  },

  findById(id: number) {
    return db.prepare("SELECT id, name, email, role, avatar, active FROM users WHERE id = ?").get(id);
  },

  findAll() {
    return db.prepare("SELECT id, name, email, role, avatar, active, created_at FROM users ORDER BY name ASC").all();
  },

  create(userData: any) {
    const { name, email, password, role, avatar } = userData;
    const hashedPassword = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO users (name, email, password, role, avatar) VALUES (?, ?, ?, ?, ?)").run(
      name, email, hashedPassword, role, avatar || name.substring(0, 2).toUpperCase()
    );
    return this.findById(Number(info.lastInsertRowid));
  },

  update(id: number, userData: any) {
    const { name, email, role, active, password } = userData;
    if (password) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare("UPDATE users SET name = ?, email = ?, role = ?, active = ?, password = ? WHERE id = ?").run(name, email, role, active, hashedPassword, id);
    } else {
      db.prepare("UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?").run(name, email, role, active, id);
    }
    return this.findById(id);
  },

  getPermissions(userId: number) {
    const perms = db.prepare("SELECT * FROM user_permissions WHERE user_id = ?").all(userId) as any[];
    return perms.reduce((acc, p) => {
      acc[p.module] = {
        module: p.module,
        can_view: !!p.can_view,
        can_create: !!p.can_create,
        can_edit: !!p.can_edit,
        can_delete: !!p.can_delete
      };
      return acc;
    }, {});
  },

  updatePermissions(userId: number, permissions: any) {
    const deleteOld = db.prepare("DELETE FROM user_permissions WHERE user_id = ?");
    const insertNew = db.prepare("INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete) VALUES (?, ?, ?, ?, ?, ?)");
    
    db.transaction(() => {
      deleteOld.run(userId);
      Object.values(permissions).forEach((p: any) => {
        insertNew.run(userId, p.module, p.can_view ? 1 : 0, p.can_create ? 1 : 0, p.can_edit ? 1 : 0, p.can_delete ? 1 : 0);
      });
    })();
  }
};

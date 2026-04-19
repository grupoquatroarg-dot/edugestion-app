import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRepository } from "../../server/repositories/userRepository.js";
import { generateToken } from "../../server/utils/jwt.js";
import { sendError, sendSuccess } from "../../server/utils/response.js";

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

const getBody = (req: any) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return sendError(res, "Method not allowed", 405);
  }

  try {
    const parsed = loginSchema.safeParse(getBody(req));

    if (!parsed.success) {
      return sendError(
        res,
        "Validation failed",
        400,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    const { email, password } = parsed.data;
    const user = (await UserRepository.findByEmail(email)) as any;

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return sendError(res, "Credenciales inválidas", 401);
    }

    const token = generateToken({
      userId: user.id,
      role: user.role,
      userName: user.name,
    });

    const { password: _password, ...userWithoutPassword } = user;
    const permissions = await UserRepository.getPermissions(Number(user.id));

    return sendSuccess(
      res,
      { ...userWithoutPassword, permissions, token },
      "Login exitoso"
    );
  } catch (error: any) {
    return sendError(res, error?.message || "Error al iniciar sesión", 500);
  }
}

import crypto from "node:crypto";

const KNOWN_WEAK_SECRET_FRAGMENTS = [
  "change-me",
  "changeme",
  "replace-in-production",
  "fallback",
  "super-secret",
  "secret-key",
  "admin123",
  "password",
  "your-secret",
];

let developmentSecret: string | null = null;
let developmentWarningShown = false;

export const isProductionLikeRuntime = () => Boolean(
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.K_SERVICE
);

const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const normalizeText = (value: unknown) => String(value ?? "").trim();

export const validateSessionSecret = (value: unknown) => {
  const secret = typeof value === "string" ? value.trim() : "";

  if (secret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres aleatorios");
  }
  if (secret.length > 512) {
    throw new Error("SESSION_SECRET supera el máximo permitido de 512 caracteres");
  }

  const lower = secret.toLowerCase();
  if (
    KNOWN_WEAK_SECRET_FRAGMENTS.some((fragment) => lower.includes(fragment)) ||
    secret.includes("<") ||
    secret.includes(">")
  ) {
    throw new Error("SESSION_SECRET contiene un valor de ejemplo o predecible");
  }

  if (new Set(secret).size < 8) {
    throw new Error("SESSION_SECRET no tiene suficiente diversidad de caracteres");
  }

  return secret;
};

export const getSessionSecret = () => {
  const configuredSecret = process.env.SESSION_SECRET;
  if (configuredSecret?.trim()) {
    return validateSessionSecret(configuredSecret);
  }

  if (isProductionLikeRuntime()) {
    throw new Error(
      "SESSION_SECRET es obligatorio en producción y debe contener al menos 32 caracteres aleatorios"
    );
  }

  if (!developmentSecret) {
    developmentSecret = crypto.randomBytes(48).toString("base64url");
  }
  if (!developmentWarningShown) {
    developmentWarningShown = true;
    console.warn(
      "[security] SESSION_SECRET no está configurado. Se generó un secreto efímero solo para desarrollo; las sesiones se invalidarán al reiniciar."
    );
  }

  return developmentSecret;
};

const validateBootstrapPassword = (password: string, email: string, name: string) => {
  if (!password) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD es obligatorio para crear el primer administrador de SQLite"
    );
  }
  if (password !== password.trim()) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD no puede tener espacios al inicio o al final");
  }
  if (password.length < 12 || password.length > 256) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD debe tener entre 12 y 256 caracteres");
  }

  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (categories < 3) {
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD debe combinar al menos tres tipos: minúsculas, mayúsculas, números y símbolos"
    );
  }

  const lower = password.toLowerCase();
  const emailLocalPart = email.split("@")[0] || "";
  const normalizedName = name.toLowerCase().replace(/\s+/g, "");
  if (
    KNOWN_WEAK_SECRET_FRAGMENTS.some((fragment) => lower.includes(fragment)) ||
    (emailLocalPart.length >= 4 && lower.includes(emailLocalPart)) ||
    (normalizedName.length >= 4 && lower.replace(/\s+/g, "").includes(normalizedName))
  ) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD contiene datos previsibles o credenciales conocidas");
  }

  return password;
};

export const getBootstrapAdminConfig = () => {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@edugestion.com");
  const name = normalizeText(process.env.BOOTSTRAP_ADMIN_NAME || "Administrador");
  const password = typeof process.env.BOOTSTRAP_ADMIN_PASSWORD === "string"
    ? process.env.BOOTSTRAP_ADMIN_PASSWORD
    : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL no es un correo válido");
  }
  if (name.length < 2 || name.length > 200) {
    throw new Error("BOOTSTRAP_ADMIN_NAME debe tener entre 2 y 200 caracteres");
  }

  return {
    email,
    name,
    password: validateBootstrapPassword(password, email, name),
    avatar: name.slice(0, 2).toUpperCase() || "AD",
  };
};

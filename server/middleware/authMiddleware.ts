import { Request, Response, NextFunction } from 'express';
import { UserRepository } from '../repositories/userRepository.js';
import { sendError } from '../utils/response.js';
import {
  validateStaffSession,
  validateStaffToken,
  type CurrentUserAuth,
} from '../services/currentUserAuthService.js';

const getTokenFromRequest = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
};

const clearInvalidSession = (req: Request) => {
  if (!req.session) return;
  req.session.userId = undefined as any;
  req.session.role = undefined as any;
  req.session.userName = undefined as any;
  req.session.sessionVersion = undefined as any;
};

export const getAuthUser = async (req: Request): Promise<CurrentUserAuth | null> => {
  const sessionUserId = (req.session as any)?.userId;
  const sessionVersion = (req.session as any)?.sessionVersion;

  if (sessionUserId) {
    const sessionUser = await validateStaffSession(sessionUserId, sessionVersion);
    if (sessionUser) {
      (req.session as any).role = sessionUser.role;
      (req.session as any).userName = sessionUser.userName;
      return sessionUser;
    }
    clearInvalidSession(req);
  }

  return validateStaffToken(getTokenFromRequest(req));
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const user = await getAuthUser(req);
  if (!user) {
    return sendError(res, "Sesión inválida o vencida. Iniciá sesión nuevamente.", 401);
  }
  (req as any).user = user;
  next();
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = await getAuthUser(req);
  if (!user) {
    return sendError(res, "Sesión inválida o vencida. Iniciá sesión nuevamente.", 401);
  }
  if (user.role !== 'administrador') {
    return sendError(res, "Forbidden: Admin access required", 403);
  }
  (req as any).user = user;
  next();
};

export const requirePermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getAuthUser(req);

    if (!user) {
      console.warn(`[Auth] Unauthorized: No auth found for module ${module}`);
      return sendError(res, "Sesión inválida o vencida. Iniciá sesión nuevamente.", 401);
    }

    const { userId, role } = user;
    (req as any).user = user;

    if (role === 'administrador') {
      return next();
    }

    const permissions = await UserRepository.getPermissions(Number(userId));
    const perm = permissions[module];

    if (!perm) {
      return sendError(res, `Forbidden: No permissions for module ${module}`, 403);
    }

    const hasAccess = (() => {
      switch (action) {
        case 'view': return !!perm.can_view;
        case 'create': return !!perm.can_create;
        case 'edit': return !!perm.can_edit;
        case 'delete': return !!perm.can_delete;
        default: return false;
      }
    })();

    if (!hasAccess) {
      return sendError(res, `Forbidden: No ${action} permission for module ${module}`, 403);
    }

    next();
  };
};

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        name: string;
      };
    }
  }
}

// Middleware to check if user is authenticated
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Fetch and attach user data
  try {
    const user = await AuthService.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: "Authentication error" });
  }
}

// Middleware to check if user is an admin
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Fetch and attach user data
  try {
    const user = await AuthService.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: "Authentication error" });
  }
}

// Middleware to check if user is authenticated (admin or full member)
export async function requireFullMember(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  // Fetch and attach user data
  try {
    const user = await AuthService.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };

    if (req.session.role !== 'admin' && req.session.role !== 'full_member') {
      return res.status(403).json({ error: "Full member access required" });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: "Authentication error" });
  }
}

// Optional auth - attach user info if logged in, but don't block if not
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId) {
    // User is logged in, you could fetch and attach user data here if needed
  }
  next();
}

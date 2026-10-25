import { Router, type Request, type RequestHandler } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type SignedOutMeResponse,
  type UpdateProfileInput,
} from "@shared/api/auth";
import { asyncHandler } from "../http/async-handler";
import { allowPublic, currentUser, requireAuth } from "../http/authz";
import { rememberDevice } from "../http/known-device";
import { HttpError } from "../http/errors";
import { validateBody } from "../http/validate";
import { recordImpersonationEnd } from "../services/admin";
import {
  authenticate,
  changePassword,
  describeSession,
  PROFILE_INVALID_MESSAGE,
  registerUser,
  updateProfile,
} from "../services/auth";
import { endSession, startSession } from "../services/sessions";
import type { RouteDeps } from "./index";

/**
 * Sign-in and sign-up take JSON only. An HTML form on another site can post form-encoded or
 * text/plain bodies cross-site, and the response's cookie would sign the visitor into the
 * attacker's account (login CSRF, CC-13). A JSON body needs a CORS preflight, which we never grant.
 */
const jsonOnly: RequestHandler = (req, _res, next) => {
  next(req.is("application/json") === false ? new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as JSON") : undefined);
};

/** Signs the browser in as `user` under a new session id, ending any impersonation it was in. */
async function signInAs(req: Request, user: { id: string; role: string }): Promise<void> {
  await recordImpersonationEnd(req, "sign-in");
  await startSession(req, { userId: user.id, role: user.role });
}

/** Sign-up, sign-in, sign-out and the signed-in user's own account. */
export function authRoutes({ env, limiters }: RouteDeps): Router {
  const router = Router();

  router.post(
    "/api/auth/register",
    allowPublic("sign-up"),
    // Every request that hashes a password counts against the visitor (SEC-P2REV-01).
    limiters.passwordVisitor,
    limiters.signUp,
    limiters.authVisitor,
    limiters.auth,
    jsonOnly,
    validateBody(registerSchema, { message: "Please enter your name, a valid email and a password" }),
    asyncHandler<ParamsDictionary, unknown, RegisterInput>(async (req, res) => {
      const user = await registerUser(req.body);
      await signInAs(req, user);
      rememberDevice(req, res, env, req.body.email);
      res.status(201).json({ message: "Registration successful", user });
    }),
  );

  router.post(
    "/api/auth/login",
    allowPublic("sign-in"),
    // The visitor's own budgets first: once one is spent, nothing keyed on the email is counted (P2REV0-SEC-01).
    // passwordVisitor and signInAccount count successful sign-ins too: each is a bcrypt run (SEC-P2REV-01).
    limiters.passwordVisitor,
    limiters.authVisitor,
    limiters.auth,
    limiters.authAccount,
    limiters.signInAccount,
    jsonOnly,
    validateBody(loginSchema, { message: "Email and password are required" }),
    asyncHandler<ParamsDictionary, unknown, LoginInput>(async (req, res) => {
      const user = await authenticate(req.body);
      await signInAs(req, user);
      // This browser may now sign in to the account even while others fail at it (TN2-06).
      rememberDevice(req, res, env, req.body.email);
      res.json({ message: "Login successful", user });
    }),
  );

  router.post(
    "/api/auth/logout",
    allowPublic("sign-out"),
    asyncHandler(async (req, res) => {
      await recordImpersonationEnd(req, "sign-out");
      await endSession(req, res);
      res.json({ message: "Logout successful" });
    }),
  );

  // Not behind requireAuth: anyone may ask who they are, and nobody is an answer, not a 401
  // (MeResponse). A session whose user was deleted or disabled is ended here, so the browser stops
  // sending a dead cookie.
  router.get(
    "/api/auth/me",
    asyncHandler(async (req, res) => {
      const session = req.user ? await describeSession(req.user.id, req.impersonatorId) : null;
      if (!session) {
        if (req.session?.userId) await endSession(req, res);
        res.json({ user: null } satisfies SignedOutMeResponse);
        return;
      }
      res.json(session);
    }),
  );

  router.put(
    "/api/auth/profile",
    requireAuth,
    validateBody(updateProfileSchema, { message: PROFILE_INVALID_MESSAGE }),
    asyncHandler<ParamsDictionary, unknown, UpdateProfileInput>(async (req, res) => {
      const user = await updateProfile(req, currentUser(req).id, req.body);
      res.json({ message: "Profile updated successfully", user });
    }),
  );

  router.post(
    "/api/auth/change-password",
    requireAuth,
    // Every attempt checks the current password with bcrypt, so every attempt counts (SEC-P2REV-01).
    limiters.passwordVisitor,
    limiters.passwordChange,
    validateBody(changePasswordSchema, { message: "Current and new passwords are required" }),
    asyncHandler<ParamsDictionary, unknown, ChangePasswordInput>(async (req, res) => {
      await changePassword(currentUser(req).id, req.body, req.sessionID);
      res.json({ message: "Password changed successfully" });
    }),
  );

  return router;
}

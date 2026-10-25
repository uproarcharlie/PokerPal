/** The session and the signed-in account's own settings (phase2-contracts §2.2). */
import type {
  AuthUserResponse,
  ChangePasswordInput,
  LoginInput,
  MeResponse,
  MessageResponse,
  RegisterInput,
  UpdateProfileInput,
} from "@shared/api/auth";
import type { ImpersonationResponse } from "@shared/api/admin";
import { apiGet, apiSend } from "@/lib/api/http";

/** GET /api/auth/me: who is signed in (and the admin behind an impersonation); `user` null for nobody. */
export const fetchSession = (signal: AbortSignal) => apiGet<MeResponse>("/api/auth/me", { signal });

export const signIn = (input: LoginInput) => apiSend<AuthUserResponse>("POST", "/api/auth/login", input);

/** POST /api/auth/register: creates the account and signs in. */
export const signUp = (input: RegisterInput) => apiSend<AuthUserResponse>("POST", "/api/auth/register", input);

export const signOut = () => apiSend("POST", "/api/auth/logout");

/** POST /api/admin/stop-impersonation: back to the admin's own session. */
export const stopImpersonating = () => apiSend<ImpersonationResponse>("POST", "/api/admin/stop-impersonation");

/** PUT /api/auth/profile: the signed-in user's own name, email and phone. */
export const updateProfile = (input: UpdateProfileInput) => apiSend<AuthUserResponse>("PUT", "/api/auth/profile", input);

/** POST /api/auth/change-password: signs the account out everywhere else. */
export const changePassword = (input: ChangePasswordInput) => apiSend<MessageResponse>("POST", "/api/auth/change-password", input);

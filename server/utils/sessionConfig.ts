/**
 * Session configuration helper to detect environment and provide consistent cookie options.
 */
export const getSessionConfig = () => {
  const isProduction = process.env.NODE_ENV === "production";
  
  // Robust detection for Cloud Run / AI Studio Preview
  // K_SERVICE is a standard environment variable in Google Cloud Run
  const isCloudRun = !!process.env.K_SERVICE;
  
  const configuredOrigin = process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || "";
  const isExternalOrigin = configuredOrigin !== "" && !configuredOrigin.includes("localhost");

  // We MUST use secure: true and sameSite: 'none' if:
  // 1. We are in production
  // 2. We are in a Cloud environment (AI Studio Preview)
  // 3. We are explicitly configured with an external origin
  const useSecure = isProduction || isCloudRun || isExternalOrigin;

  return {
    isProduction,
    isEmbeddedPreview: isCloudRun || isExternalOrigin,
    cookieOptions: {
      secure: useSecure,
      sameSite: (useSecure ? 'none' : 'lax') as 'none' | 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    }
  };
};

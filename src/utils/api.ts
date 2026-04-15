/**
 * Standard API response structure from the backend.
 */
export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  message: string;
  data: T;
  errors?: any[];
}

/**
 * Helper to perform fetch requests with consistent settings (e.g., credentials).
 */
export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('auth_token');
  
  const defaultOptions: RequestInit = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, { ...defaultOptions, ...options });
  return response;
};

/**
 * Extracts the data from a standardized API response.
 * Handles both the new { data: { data: ... } } format and the old direct data format for backward compatibility during transition.
 */
export const unwrapResponse = <T>(body: ApiResponse<T> | T): T => {
  // If it's the new standardized format
  if (body && typeof body === 'object' && 'status' in body) {
    if (body.status === 'error') {
      const error = new Error((body as any).message || 'API Error');
      // Attach validation errors if present
      if ((body as any).errors) {
        (error as any).errors = (body as any).errors;
      }
      throw error;
    }
    if ('data' in body) {
      return (body as ApiResponse<T>).data;
    }
  }

  // If it's the old direct data format
  return body as T;
};

/**
 * Helper to handle API errors consistently.
 */
export const getErrorMessage = (error: any): string => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  return error.message || "Ocurrió un error inesperado";
};

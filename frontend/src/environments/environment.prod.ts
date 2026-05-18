// apiBaseUrl is injected at build time.
// Provide before building: ng build --define="API_BASE_URL='https://your-api.example.com/api/v1'"
declare const API_BASE_URL: string;

export const environment = {
  production: true,
  apiBaseUrl: API_BASE_URL,
};

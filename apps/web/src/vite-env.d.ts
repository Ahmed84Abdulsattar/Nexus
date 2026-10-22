/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Nexus API (docs/04), e.g. http://localhost:3000/v1. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Local development only (docs/04, S0-09): the developer's own ArcGIS key, read by the MSW
   * /v1/config mock in Vite dev mode. A production build fails if it is set.
   */
  readonly VITE_DEV_ARCGIS_API_KEY?: string;
  /** Local development only: `dev` shows the "Sign in as" picker (needs the API with AUTH_MODE=dev). A build fails if set. */
  readonly VITE_AUTH_MODE?: string;
  /** Local development only: `false` turns the MSW mocks off so the real local API answers. A build fails if set. */
  readonly VITE_USE_MOCKS?: string;
}

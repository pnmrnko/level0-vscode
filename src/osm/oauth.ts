// OAuth 2 with PKCE against the OSM website, for a public client without a
// secret: build the authorization URL, exchange the code for a token, read
// who the token belongs to. Pure module, no vscode API.

import { createHash, randomBytes } from 'node:crypto';
import { request } from './http';

export const SCOPES = 'read_prefs write_api';

// The website that issues tokens for an API base URL: the API host is an
// alias of the website on both the production and the development server.
export function siteUrl(apiBase: string): string {
  const u = new URL(apiBase);
  if (u.host === 'api.openstreetmap.org') {
    u.host = 'www.openstreetmap.org';
  } else if (u.host === 'api06.dev.openstreetmap.org') {
    u.host = 'master.apis.dev.openstreetmap.org';
  }
  return u.origin;
}

// Client ids of the registered public applications, by site.
export const CLIENT_IDS: Record<string, string> = {
  'https://www.openstreetmap.org': '',
  'https://master.apis.dev.openstreetmap.org': 'FcXdQB_EhnM5POHtCMm9uXx1lO-y7g7Ay2O-Zjjft7w',
};

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export interface Pending {
  state: string;
  verifier: string;
  url: string;
}

export function beginLogin(site: string, clientId: string, redirectUri: string): Pending {
  const state = base64url(randomBytes(16));
  const verifier = base64url(randomBytes(32));
  const url = new URL('/oauth2/authorize', site);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { state, verifier, url: url.toString() };
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

export async function exchangeCode(
  site: string,
  clientId: string,
  redirectUri: string,
  code: string,
  verifier: string,
  userAgent: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await request(new URL('/oauth2/token', site).toString(), {
    method: 'POST',
    headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  let json: Partial<TokenResponse> & { error?: string; error_description?: string } = {};
  try {
    json = JSON.parse(res.body);
  } catch {
    // Not JSON: reported through the status below.
  }
  if (res.status !== 200 || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `HTTP ${res.status} from the token endpoint`);
  }
  return json as TokenResponse;
}

export interface UserDetails {
  id: number;
  display_name: string;
}

export async function userDetails(apiBase: string, token: string, userAgent: string): Promise<UserDetails> {
  const res = await request(`${apiBase}user/details.json`, { headers: { 'User-Agent': userAgent, Authorization: `Bearer ${token}` } });
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status} for user/details`);
  }
  const json = JSON.parse(res.body) as { user: UserDetails };
  return { id: json.user.id, display_name: json.user.display_name };
}

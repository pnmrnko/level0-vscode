// Login to OSM from the editor: the browser is sent to the authorization
// page, the site redirects to vscode://pnmrnko.level0l/oauth with a code,
// which is exchanged for a token kept in the editor's secret storage. One
// token per site, so the production and development servers are separate.

import * as vscode from 'vscode';
import { CLIENT_IDS, beginLogin, exchangeCode, siteUrl, userDetails } from './osm/oauth';

const REDIRECT_PATH = '/oauth';

export interface Account {
  site: string;
  name: string;
}

export class Auth implements vscode.UriHandler {
  private pending?: { state: string; resolve: (uri: vscode.Uri) => void };
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private context: vscode.ExtensionContext, private userAgent: string, private log: vscode.OutputChannel) {}

  private redirectUri(): string {
    return `${vscode.env.uriScheme}://${this.context.extension.id}${REDIRECT_PATH}`;
  }

  private tokenKey(site: string): string {
    return `level0l.token.${site}`;
  }

  private nameKey(site: string): string {
    return `level0l.user.${site}`;
  }

  token(apiBase: string): Promise<string | undefined> {
    return Promise.resolve(this.context.secrets.get(this.tokenKey(siteUrl(apiBase))));
  }

  async account(apiBase: string): Promise<Account | undefined> {
    const site = siteUrl(apiBase);
    const token = await this.context.secrets.get(this.tokenKey(site));
    return token ? { site, name: this.context.globalState.get<string>(this.nameKey(site), '') } : undefined;
  }

  handleUri(uri: vscode.Uri): void {
    if (uri.path === REDIRECT_PATH && this.pending) {
      this.pending.resolve(uri);
    }
  }

  // Returns the account after a successful login, undefined when the user
  // cancelled; throws on failure.
  async login(apiBase: string, clientIdSetting: string): Promise<Account | undefined> {
    const site = siteUrl(apiBase);
    const clientId = clientIdSetting || CLIENT_IDS[site];
    if (!clientId) {
      throw new Error(`No OAuth client id is known for ${site}; set level0l.oauth.clientId`);
    }
    const redirect = this.redirectUri();
    const pending = beginLogin(site, clientId, redirect);
    const uri = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Waiting for the login in the browser`, cancellable: true },
      (_progress, cancel) =>
        new Promise<vscode.Uri | undefined>((resolve) => {
          this.pending = { state: pending.state, resolve };
          cancel.onCancellationRequested(() => resolve(undefined));
          setTimeout(() => resolve(undefined), 5 * 60 * 1000);
          vscode.env.openExternal(vscode.Uri.parse(pending.url));
        })
    );
    this.pending = undefined;
    if (!uri) {
      return undefined;
    }
    const params = new URLSearchParams(uri.query);
    if (params.get('state') !== pending.state) {
      throw new Error('the browser came back with an unexpected state');
    }
    const code = params.get('code');
    if (!code) {
      throw new Error(params.get('error_description') ?? params.get('error') ?? 'the browser came back without a code');
    }
    const token = await exchangeCode(site, clientId, redirect, code, pending.verifier, this.userAgent);
    const user = await userDetails(apiBase, token.access_token, this.userAgent);
    await this.context.secrets.store(this.tokenKey(site), token.access_token);
    await this.context.globalState.update(this.nameKey(site), user.display_name);
    this.log.appendLine(`logged in to ${site} as ${user.display_name}`);
    this.changed.fire();
    return { site, name: user.display_name };
  }

  async logout(apiBase: string): Promise<void> {
    const site = siteUrl(apiBase);
    await this.context.secrets.delete(this.tokenKey(site));
    await this.context.globalState.update(this.nameKey(site), undefined);
    this.log.appendLine(`logged out of ${site}`);
    this.changed.fire();
  }
}

export async function loginCommand(auth: Auth, apiBase: string, clientIdSetting: string): Promise<void> {
  const current = await auth.account(apiBase);
  if (current) {
    vscode.window.showInformationMessage(`Already logged in to ${current.site} as ${current.name}. Use "Level0L: Log out of OSM" to switch accounts.`);
    return;
  }
  try {
    const account = await auth.login(apiBase, clientIdSetting);
    if (account) {
      vscode.window.showInformationMessage(`Logged in to ${account.site} as ${account.name}`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Login failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function logoutCommand(auth: Auth, apiBase: string): Promise<void> {
  const current = await auth.account(apiBase);
  if (!current) {
    vscode.window.showInformationMessage(`Not logged in to ${siteUrl(apiBase)}`);
    return;
  }
  await auth.logout(apiBase);
  vscode.window.showInformationMessage(`Logged out of ${current.site}`);
}

// Status bar entry for Level0L documents: who is logged in and to which
// server, since the development server looks exactly like the real one.
export class AccountStatus {
  private item = vscode.window.createStatusBarItem('level0l.account', vscode.StatusBarAlignment.Right, 50);

  constructor(private auth: Auth, private apiBase: () => string) {
    this.item.name = 'Level0L account';
    this.item.command = 'level0l.account';
  }

  async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== 'level0l') {
      this.item.hide();
      return;
    }
    const base = this.apiBase();
    const site = siteUrl(base);
    const dev = site.includes('dev.openstreetmap.org') ? ' (dev)' : '';
    const account = await this.auth.account(base);
    this.item.text = account ? `$(account) ${account.name}${dev}` : `$(account) Log in to OSM${dev}`;
    this.item.tooltip = account ? `Logged in to ${site} as ${account.name}` : `Not logged in to ${site}`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

export async function accountCommand(auth: Auth, apiBase: string, clientIdSetting: string): Promise<void> {
  const current = await auth.account(apiBase);
  if (!current) {
    return loginCommand(auth, apiBase, clientIdSetting);
  }
  const pick = await vscode.window.showQuickPick([`Log out of ${current.site}`, `Open ${current.site}/user/${current.name}`], {
    title: `Logged in to ${current.site} as ${current.name}`,
  });
  if (pick?.startsWith('Log out')) {
    await logoutCommand(auth, apiBase);
  } else if (pick) {
    vscode.env.openExternal(vscode.Uri.parse(`${current.site}/user/${encodeURIComponent(current.name)}`));
  }
}

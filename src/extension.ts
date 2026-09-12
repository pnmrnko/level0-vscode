import * as vscode from 'vscode';
import { extractLinks, LinkOptions } from './links';

function readOptions(): LinkOptions {
  const cfg = vscode.workspace.getConfiguration('level0l');
  return {
    osmBaseUrl: cfg.get<string>('osmBaseUrl', 'https://www.openstreetmap.org'),
    wikiBaseUrl: cfg.get<string>('wikiBaseUrl', 'https://wiki.openstreetmap.org/wiki'),
    tagLinks: cfg.get<boolean>('tagLinks', true),
  };
}

class Level0LinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const opts = readOptions();
    return extractLinks(document.getText(), opts).map((l) => {
      const range = new vscode.Range(l.line, l.start, l.line, l.end);
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(l.url));
      link.tooltip = l.tooltip;
      return link;
    });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider({ language: 'level0l' }, new Level0LinkProvider())
  );
}

export function deactivate(): void {}

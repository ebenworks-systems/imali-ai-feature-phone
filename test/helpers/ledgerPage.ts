/**
 * A small stand-in for the page's DOM, enough for `initLedger` (public/ledger.js) to run in Node without a browser or
 * a new dependency. It keeps text, attributes and click listeners, and nothing else: no layout, no events that bubble.
 */

export class FakeNode {
  textContent = '';
  className = '';
  hidden = false;
  children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<() => void>>();
  readonly classList = { add: (name: string) => void (this.className = `${this.className} ${name}`.trim()) };
  private label: FakeNode | undefined;

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  append(...items: unknown[]) {
    this.children.push(...items);
  }
  replaceChildren(...items: unknown[]) {
    this.children = items;
  }
  querySelector(selector: string) {
    if (selector !== '.btn__label') throw new Error(`FakeNode.querySelector does not know ${selector}`);
    this.label ??= new FakeNode();
    return this.label;
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
}

const IDS = [
  'ledger', 'ledger-title', 'shop-meta', 'ledger-none', 'ledger-loading', 'ledger-body', 'fig-sales', 'fig-count',
  'fig-spent', 'fig-inhand', 'owes-list', 'owes-empty', 'owes-more', 'owes-extra', 'records-list', 'records-empty',
  'panel-error', 'retry-btn', 'action-error', 'cta-error', 'start-cta', 'over-btn', 'export-btn', 'panel-status'
] as const;

export interface LedgerPage {
  root: { getElementById(id: string): FakeNode; querySelectorAll(selector: string): FakeNode[] };
  node(id: (typeof IDS)[number]): FakeNode;
  /** The two "Start demo shop" buttons (`[data-start]`). */
  startButtons: FakeNode[];
  /** The `document` for the `el()` helper in ledger.js; give it to `vi.stubGlobal('document', page.document)`. */
  document: { createElement(tag: string): FakeNode };
}

export function makeLedgerPage(): LedgerPage {
  const nodes = new Map<string, FakeNode>(IDS.map((id) => [id, new FakeNode()]));
  const startButtons = [new FakeNode(), new FakeNode()];
  return {
    root: {
      getElementById: (id) => {
        const node = nodes.get(id);
        if (!node) throw new Error(`The fake page has no element with id ${id}`);
        return node;
      },
      querySelectorAll: (selector) => {
        if (selector !== '[data-start]') throw new Error(`The fake page does not know ${selector}`);
        return startButtons;
      }
    },
    node: (id) => nodes.get(id)!,
    startButtons,
    document: { createElement: () => new FakeNode() }
  };
}

/** A `Storage` that holds a map. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data
  };
}

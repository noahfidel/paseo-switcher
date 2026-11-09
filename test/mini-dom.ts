// A small DOM for tests that need real node identity: children, attributes, isEqualNode and simple
// selectors. Markup set through innerHTML is not parsed; it becomes one opaque element that keeps
// the markup as an attribute, which is enough for the switcher's icons.

export class MiniNode {
  parentNode: MiniElement | null = null;
  readonly nodeType: number;
  readonly nodeName: string;
  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }
  get parentElement(): MiniElement | null {
    return this.parentNode;
  }
  get nextSibling(): MiniNode | null {
    const kids = this.parentNode?.childNodes;
    if (!kids) return null;
    return kids[kids.indexOf(this) + 1] ?? null;
  }
  get isConnected(): boolean {
    let node: MiniNode | null = this;
    while (node.parentNode) node = node.parentNode;
    return node instanceof MiniElement && node.isDocument;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  replaceWith(next: MiniNode) {
    this.parentNode?.replaceChild(next, this);
  }
  get textContent(): string {
    return "";
  }
  set textContent(_value: string) {}
  cloneNode(_deep?: boolean): MiniNode {
    throw new Error("abstract");
  }
  isEqualNode(_other: MiniNode | null): boolean {
    return false;
  }
}

export class MiniText extends MiniNode {
  data: string;
  constructor(data: string) {
    super(3, "#text");
    this.data = data;
  }
  get nodeValue(): string {
    return this.data;
  }
  set nodeValue(value: string) {
    this.data = value;
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(value: string) {
    this.data = value;
  }
  override cloneNode(): MiniText {
    return new MiniText(this.data);
  }
  override isEqualNode(other: MiniNode | null): boolean {
    return other instanceof MiniText && other.data === this.data;
  }
}

export class MiniElement extends MiniNode {
  childNodes: MiniNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty() {} };
  isDocument = false;
  readonly tagName: string;
  constructor(tag: string) {
    super(1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
  }

  get className(): string {
    return this.attrs.get("class") ?? "";
  }
  set className(value: string) {
    this.attrs.set("class", value);
  }
  get title(): string {
    return this.attrs.get("title") ?? "";
  }
  set title(value: string) {
    this.attrs.set("title", value);
  }
  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean);
    const write = (names: string[]) => (this.className = names.join(" "));
    return {
      contains: (name: string) => read().includes(name),
      add: (...names: string[]) => write([...new Set([...read(), ...names])]),
      remove: (...names: string[]) => write(read().filter((n) => !names.includes(n))),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !read().includes(name);
        if (on) write([...new Set([...read(), name])]);
        else write(read().filter((n) => n !== name));
        return on;
      },
    };
  }
  get attributes(): { name: string; value: string }[] {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }

  get children(): MiniElement[] {
    return this.childNodes.filter((n): n is MiniElement => n instanceof MiniElement);
  }
  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  override set textContent(value: string) {
    this.replaceChildren(...(value ? [new MiniText(value)] : []));
  }
  set innerHTML(markup: string) {
    const node = new MiniElement(/^\s*<svg/.test(markup) ? "svg" : "div");
    node.setAttribute("data-markup", markup);
    this.replaceChildren(node);
  }

  private adopt(node: MiniNode) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
  }
  appendChild<T extends MiniNode>(node: T): T {
    this.adopt(node);
    this.childNodes.push(node);
    return node;
  }
  insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
    if (node === ref) return node;
    this.adopt(node);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(node);
    else this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild<T extends MiniNode>(node: T): T {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(next: MiniNode, old: MiniNode) {
    if (next === old) return old;
    this.insertBefore(next, old);
    return this.removeChild(old);
  }
  replaceChildren(...nodes: MiniNode[]) {
    for (const kid of [...this.childNodes]) this.removeChild(kid);
    for (const node of nodes) this.appendChild(node);
  }
  prepend(node: MiniNode) {
    this.insertBefore(node, this.firstChild);
  }
  contains(node: MiniNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  /** Calls this node's own listeners for `type`; no bubbling. */
  fire(type: string, event: Record<string, unknown> = {}) {
    const e = { preventDefault() {}, stopPropagation() {}, target: this, ...event };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
  }
  scrollIntoView() {}

  override cloneNode(deep?: boolean): MiniElement {
    const copy = new MiniElement(this.tagName.toLowerCase());
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    copy.dataset = { ...this.dataset };
    if (deep) for (const kid of this.childNodes) copy.appendChild(kid.cloneNode(true));
    return copy;
  }
  override isEqualNode(other: MiniNode | null): boolean {
    if (!(other instanceof MiniElement) || other.tagName !== this.tagName) return false;
    if (other.attrs.size !== this.attrs.size) return false;
    for (const [k, v] of this.attrs) if (other.attrs.get(k) !== v) return false;
    if (other.childNodes.length !== this.childNodes.length) return false;
    return this.childNodes.every((kid, i) => kid.isEqualNode(other.childNodes[i]));
  }

  /** Every element below this one, in document order. */
  descendants(): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (node: MiniElement) => {
      for (const kid of node.children) {
        out.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector: string): MiniElement[] {
    const groups = selector.split(",").map((s) => s.trim().split(/\s+/).map(parseCompound));
    return this.descendants().filter((node) => groups.some((parts) => matchesChain(node, parts, this)));
  }
  querySelector(selector: string): MiniElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

type Compound = { tag: string | null; classes: string[]; attrs: [string, string | null][] };

function parseCompound(text: string): Compound {
  const tag = /^[a-zA-Z][\w-]*/.exec(text)?.[0] ?? null;
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...text.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1], m[2] ?? null] as [string, string | null]);
  return { tag, classes, attrs };
}

function matches(node: MiniElement, c: Compound): boolean {
  if (c.tag && node.tagName !== c.tag.toUpperCase()) return false;
  if (c.classes.some((name) => !node.classList.contains(name))) return false;
  return c.attrs.every(([name, value]) => (value === null ? node.hasAttribute(name) : node.getAttribute(name) === value));
}

function matchesChain(node: MiniElement, parts: Compound[], scope: MiniElement): boolean {
  if (!matches(node, parts[parts.length - 1])) return false;
  let rest = parts.length - 2;
  for (let up = node.parentNode; up && up !== scope && rest >= 0; up = up.parentNode) if (matches(up, parts[rest])) rest--;
  return rest < 0;
}

/** A document whose body and head are real mini elements. */
export function miniDocument() {
  const docEl = new MiniElement("html");
  docEl.isDocument = true;
  const head = docEl.appendChild(new MiniElement("head"));
  const body = docEl.appendChild(new MiniElement("body"));
  const created: MiniNode[] = [];
  const document = {
    head,
    body,
    hidden: false,
    styleSheets: [],
    createElement(tag: string) {
      const node = new MiniElement(tag);
      created.push(node);
      return node;
    },
    createTextNode(text: string) {
      const node = new MiniText(text);
      created.push(node);
      return node;
    },
    querySelector: (selector: string) => docEl.querySelector(selector),
    querySelectorAll: (selector: string) => docEl.querySelectorAll(selector),
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, created };
}

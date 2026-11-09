// Brings an open switcher up to date with a freshly built tree while keeping every node that shows
// the same thing. A poll that changed nothing on screen then touches nothing, and one that changed a
// row's status touches only that row: images don't reload, spinners don't restart, the panel keeps
// its scroll. Rows are matched by their key attribute, other nodes by position and kind.
//
// Kept nodes keep their event listeners, so listeners must not capture a row's position; they look
// their row up by key when they fire.

type Node = any;

/** Attributes that name a row; a row is only ever matched with the row of the same name. */
const KEY_ATTRS = ["data-key", "data-agent", "data-terminal"];

const standIns = new WeakMap<object, Node>();

/**
 * A placeholder for a node already on show that must stay exactly where it is (a thumbnail canvas):
 * building the new tree around the real node would pull it out of the page.
 */
export function standIn(doc: Node, live: Node): Node {
  const node = doc.createElement("i");
  standIns.set(node, live);
  return node;
}

function identity(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  for (const attr of KEY_ATTRS) {
    const value = node.getAttribute(attr);
    if (value !== null) return `${attr}=${value}`;
  }
  return null;
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  // A node's class says what it is (header, panel, hint, status), and so which listeners it carries.
  return a.nodeType !== 1 || a.getAttribute("class") === b.getAttribute("class");
}

/** Swaps any stand-ins in a new subtree for the live nodes they hold. */
function resolve(node: Node): Node {
  const live = standIns.get(node);
  if (live) return live;
  const kids = node.childNodes;
  if (!kids) return node;
  for (const kid of [...kids]) {
    const real = resolve(kid);
    if (real !== kid) node.replaceChild(real, kid);
  }
  return node;
}

/** Makes `old` show what `next` shows, keeping `old` and as many of its descendants as possible. */
function patch(old: Node, next: Node) {
  if (old.isEqualNode(next)) return;
  if (old.nodeType !== 1) {
    old.nodeValue = next.nodeValue;
    return;
  }
  for (const { name } of [...old.attributes]) if (!next.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of [...next.attributes]) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  morphChildren(old, [...next.childNodes]);
}

/** Makes `parent`'s children show `next`, reusing the children already there. */
export function morphChildren(parent: Node, next: Node[]) {
  if (!parent.childNodes) {
    // Not a full DOM (some tests' stand-in pages): just replace.
    parent.replaceChildren(...next.map(resolve));
    return;
  }
  const wanted = new Set(next.map(identity).filter(Boolean));
  const keyed = new Map<string, Node>();
  for (const old of parent.childNodes) {
    const id = identity(old);
    if (id && wanted.has(id) && !keyed.has(id)) keyed.set(id, old);
  }
  let cursor: Node = parent.firstChild;
  // Old rows that are not shown any more are dropped as the cursor reaches them.
  const dropGone = () => {
    while (cursor) {
      const id = identity(cursor);
      if (!id || keyed.get(id) === cursor) return;
      const gone = cursor;
      cursor = cursor.nextSibling;
      gone.remove();
    }
  };
  for (const node of next) {
    dropGone();
    const live = standIns.get(node);
    let match: Node = null;
    if (live) match = live;
    else {
      const id = identity(node);
      if (id) {
        match = keyed.get(id) ?? null;
        keyed.delete(id);
      } else if (cursor && !identity(cursor) && sameKind(cursor, node)) match = cursor;
    }
    if (!match) {
      parent.insertBefore(resolve(node), cursor);
      continue;
    }
    if (!live) patch(match, node);
    if (match === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(match, cursor);
  }
  while (cursor) {
    const gone = cursor;
    cursor = cursor.nextSibling;
    gone.remove();
  }
}

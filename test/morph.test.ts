// The redraw reconciler (client/morph.ts) against a small DOM that keeps node identity.
import assert from "node:assert/strict";
import { test } from "node:test";
import { miniDocument, MiniElement } from "./mini-dom.ts";
import { morphChildren, standIn } from "../client/morph.ts";

const { document: doc } = miniDocument();

function el(tag: string, cls: string, attrs: Record<string, string> = {}, ...kids: (MiniElement | string)[]): MiniElement {
  const node = doc.createElement(tag);
  node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids) node.appendChild(typeof kid === "string" ? doc.createTextNode(kid) : kid);
  return node;
}

const row = (key: string, label: string) => el("div", "row", { "data-key": key }, el("img", "avatar", { src: `${key}.png` }), el("span", "label", {}, label));

/** Records every child removed from or inserted into `node`. */
function watch(node: MiniElement) {
  const log: string[] = [];
  const remove = node.removeChild.bind(node);
  const insert = node.insertBefore.bind(node);
  node.removeChild = (kid: any) => (log.push("remove"), remove(kid));
  node.insertBefore = (kid: any, ref: any) => (log.push("insert"), insert(kid, ref));
  return log;
}

test("identical children are all kept", () => {
  const parent = el("div", "panel", {}, row("a", "A"), row("b", "B"));
  const before = [...parent.childNodes];
  const log = watch(parent);
  morphChildren(parent, [row("a", "A"), row("b", "B")]);
  assert.deepEqual(parent.childNodes, before);
  assert.deepEqual(log, []);
});

test("a changed row keeps its node and its image; only the changed text moves", () => {
  const parent = el("div", "panel", {}, row("a", "A"), row("b", "B"));
  const [a, b] = parent.children;
  const img = b.querySelector("img");
  morphChildren(parent, [row("a", "A"), row("b", "B running")]);
  assert.equal(parent.children[0], a);
  assert.equal(parent.children[1], b);
  assert.equal(b.querySelector("img"), img);
  assert.equal(b.querySelector(".label")!.textContent, "B running");
});

test("rows are matched by key across a reorder, and rows gone are removed", () => {
  const parent = el("div", "panel", {}, row("a", "A"), row("b", "B"), row("c", "C"));
  const [a, , c] = parent.children;
  morphChildren(parent, [row("c", "C"), row("d", "D"), row("a", "A")]);
  assert.deepEqual(
    parent.children.map((n) => n.getAttribute("data-key")),
    ["c", "d", "a"],
  );
  assert.equal(parent.children[0], c);
  assert.equal(parent.children[2], a);
});

test("an unkeyed node of another class is replaced, not reused", () => {
  const header = el("div", "header");
  const parent = el("div", "sheet", {}, header);
  const panel = el("div", "panel");
  morphChildren(parent, [panel]);
  assert.equal(parent.children[0], panel);
  assert.equal(header.parentNode, null);
});

test("attributes follow the new node, including ones it no longer has", () => {
  const parent = el("div", "panel", {}, el("div", "row pws-selected", { "data-key": "a", "aria-selected": "true" }));
  const kept = parent.children[0];
  morphChildren(parent, [el("div", "row", { "data-key": "a", title: "A" })]);
  assert.equal(parent.children[0], kept);
  assert.equal(kept.className, "row");
  assert.equal(kept.getAttribute("aria-selected"), null);
  assert.equal(kept.getAttribute("title"), "A");
});

test("a live thumbnail held by a stand-in is never detached", () => {
  const canvas = el("canvas", "pws-canvas");
  const frame = el("div", "pws-thumb", {}, canvas);
  const card = el("div", "pws-card", { "data-key": "a" }, frame);
  const parent = el("div", "panel", {}, card);
  const log = watch(frame);
  morphChildren(parent, [el("div", "pws-card", { "data-key": "a" }, el("div", "pws-thumb", {}, standIn(doc, canvas)))]);
  assert.equal(parent.children[0], card);
  assert.equal(frame.childNodes[0], canvas);
  assert.equal(frame.childNodes.length, 1);
  assert.deepEqual(log, [], "the canvas was neither removed nor re-inserted");
});

test("a stand-in inside a brand-new subtree becomes the live node", () => {
  const canvas = el("canvas", "pws-canvas");
  const old = el("div", "pws-thumb", {}, canvas);
  const parent = el("div", "panel", {}, old);
  morphChildren(parent, [el("div", "pws-card", { "data-key": "a" }, el("div", "pws-thumb", {}, standIn(doc, canvas)))]);
  const frame = parent.children[0].querySelector(".pws-thumb")!;
  assert.equal(frame.childNodes[0], canvas);
  assert.equal(parent.querySelectorAll("i").length, 0, "no stand-in reaches the page");
});

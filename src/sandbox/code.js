// Runs in the Express document sandbox: reads and edits text nodes.
// Save as: src/sandbox/code.js
import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor, constants } from "express-document-sdk";

const { runtime } = addOnSandboxSdk.instance;

// Express returns special list objects (ItemList etc.), not plain arrays.
// Convert any of the shapes it might use into a real array.
function toArray(list) {
  if (list == null) return [];
  if (Array.isArray(list)) return list;
  try {
    if (typeof list.toArray === "function") return list.toArray();
    if (typeof list[Symbol.iterator] === "function") return Array.from(list);
    if (typeof list.length === "number") {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        out.push(typeof list.item === "function" ? list.item(i) : list[i]);
      }
      return out;
    }
  } catch (e) {
    console.log("toArray failed:", e);
  }
  return [];
}

const isText = (node) =>
  node &&
  (node.type === constants.SceneNodeType.text ||
    String(node.type).toLowerCase() === "text");

// Yield a node and all of its descendants.
function* walk(node) {
  if (!node) return;
  yield node;
  for (const child of toArray(node.children)) yield* walk(child);
  // Some SDK versions only expose descendants via allChildren.
  if (node.allChildren) {
    for (const child of toArray(node.allChildren)) yield child;
  }
}

// Starting points for a scan.
function getRoots(scope) {
  if (scope === "selection") return toArray(editor.context.selection);

  const roots = [];
  const add = (n) => { if (n && !roots.includes(n)) roots.push(n); };

  for (const page of toArray(editor.documentRoot?.pages)) {
    const artboards = toArray(page.artboards);
    if (artboards.length) artboards.forEach(add);
    add(page);
  }

  // Where new content is inserted (usually the artboard holding the design).
  let p = editor.context.insertionParent;
  while (p) { add(p); p = p.parent; }

  const cp = editor.context.currentPage;
  if (cp) {
    toArray(cp.artboards).forEach(add);
    add(cp);
  }
  return roots;
}

// List every property name on an object and its prototype chain (for debugging).
function describe(obj) {
  const names = new Set();
  for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    Object.getOwnPropertyNames(o).forEach((n) => names.add(n));
  }
  return [...names];
}

function* textNodes(scope) {
  const seen = new Set();
  const typeCounts = {};
  for (const root of getRoots(scope)) {
    for (const node of walk(root)) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      if (isText(node) && !seen.has(node.id)) {
        seen.add(node.id);
        yield node;
      }
    }
  }
  if (!seen.size) {
    console.log("No text nodes found. Node types seen:", JSON.stringify(typeCounts));
    try {
      const page = editor.context.currentPage;
      console.log("currentPage props:", describe(page).join(", "));
      console.log("artboards length:", page?.artboards?.length, "| children length:", page?.children?.length);
      const ip = editor.context.insertionParent;
      console.log("insertionParent:", ip?.type, "| props:", describe(ip).join(", "));
      console.log("insertionParent children length:", ip?.children?.length);
    } catch (e) {
      console.log("diagnostics failed:", String(e));
    }
  }
}

function findNode(id) {
  for (const node of textNodes("all")) if (node.id === id) return node;
  return null;
}

runtime.exposeApi({
  // Returns [{ id, text }] for every non-empty text element in scope.
  getTextNodes(scope) {
    const out = [];
    for (const node of textNodes(scope)) {
      const text = node.fullContent?.text ?? "";
      if (text.trim()) out.push({ id: node.id, text });
    }
    return out;
  },

  // Replaces a text element's content, after checking it hasn't changed.
  setText(id, expectedOld, newText) {
    const node = findNode(id);
    if (!node) return { ok: false, error: "Text element no longer exists. Please re-scan." };
    if (node.fullContent.text !== expectedOld) {
      return { ok: false, error: "Text was changed since the scan. Please re-scan." };
    }
    try {
      node.fullContent.text = newText;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },

  // Selects a text element on the canvas.
  locate(id) {
    const node = findNode(id);
    if (!node) return false;
    editor.context.selection = [node];
    return true;
  }
});

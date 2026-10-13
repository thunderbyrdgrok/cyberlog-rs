import { normalizeUrl } from "./format.js";

const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "META", "LINK"]);

const ALLOWED = new Set([
  "P", "BR", "DIV", "H1", "H2", "H3", "STRONG", "B", "EM", "I", "U", "S", "STRIKE",
  "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "A", "HR", "SPAN", "MARK", "SUB", "SUP",
]);

const STYLE_PROPS = {
  color: /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-z]{3,24})$/i,
  "background-color": /^(transparent|#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-z]{3,24})$/i,
  "font-weight": /^(bold|normal|[1-9]00)$/i,
  "font-style": /^(italic|normal)$/i,
  "text-decoration": /^(none|underline|line-through)(?:\s+(?:none|underline|line-through))*$/i,
  "text-decoration-line": /^(none|underline|line-through)(?:\s+(?:none|underline|line-through))*$/i,
};

function safeColor(value) {
  if (!value || !STYLE_PROPS.color.test(value.trim())) return "";
  return value.trim();
}

function safeStyle(style) {
  if (!style) return "";
  const kept = [];
  for (const part of style.split(";")) {
    const index = part.indexOf(":");
    if (index < 1) continue;
    const prop = part.slice(0, index).trim().toLowerCase();
    const value = part.slice(index + 1).trim();
    if (!STYLE_PROPS[prop] || value.length > 80) continue;
    if (/important|url\(|expression\(|\/\*/i.test(value)) continue;
    if (!STYLE_PROPS[prop].test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

function fontToSpan(el) {
  const span = el.ownerDocument.createElement("span");
  const color = safeColor(el.getAttribute("color") || "");
  if (color) span.setAttribute("style", `color: ${color}`);
  span.append(...el.childNodes);
  el.replaceWith(span);
  return span;
}

function flatten(el) {
  const out = [];
  for (const kid of [...el.childNodes]) {
    if (kid.nodeType === Node.TEXT_NODE) out.push(kid);
    else if (kid.nodeType === Node.ELEMENT_NODE) out.push(...sanitizeElement(kid));
  }
  return out;
}

function applyAttrs(el) {
  const tag = el.tagName;
  const snapshot = {
    className: el.getAttribute("class"),
    checked: el.getAttribute("data-checked"),
    href: el.getAttribute("href"),
    style: el.getAttribute("style"),
  };
  for (const attr of [...el.attributes]) el.removeAttribute(attr.name);

  if (tag === "UL" && snapshot.className === "check") el.setAttribute("class", "check");

  if (tag === "SPAN" && snapshot.className === "box") {
    el.setAttribute("class", "box");
    el.setAttribute("data-checked", snapshot.checked === "1" ? "1" : "0");
    el.setAttribute("contenteditable", "false");
    return true;
  }

  if (tag === "A") {
    const href = normalizeUrl(snapshot.href || "");
    if (!href) return false;
    el.setAttribute("href", href);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noreferrer noopener");
    return true;
  }

  if ((tag === "SPAN" || tag === "MARK") && snapshot.style) {
    const style = safeStyle(snapshot.style);
    if (style) el.setAttribute("style", style);
  }
  return true;
}

function sanitizeElement(el) {
  if (DROP.has(el.tagName)) return [];
  let current = el;
  if (current.tagName === "FONT") current = fontToSpan(current);
  if (!ALLOWED.has(current.tagName)) return flatten(current);
  if (!applyAttrs(current)) return flatten(current);
  for (const kid of [...current.childNodes]) {
    if (kid.nodeType === Node.TEXT_NODE) continue;
    if (kid.nodeType !== Node.ELEMENT_NODE) {
      kid.remove();
      continue;
    }
    kid.replaceWith(...sanitizeElement(kid));
  }
  return [current];
}

export function sanitize(html) {
  const source = String(html || "");
  if (!source) return "";
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const result = document.createElement("div");
  for (const kid of [...parsed.body.childNodes]) {
    if (kid.nodeType === Node.TEXT_NODE) result.append(kid);
    else if (kid.nodeType === Node.ELEMENT_NODE) result.append(...sanitizeElement(kid));
  }
  return result.innerHTML;
}

export function plainText(html) {
  const holder = document.createElement("div");
  holder.innerHTML = sanitize(html);
  return holder.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

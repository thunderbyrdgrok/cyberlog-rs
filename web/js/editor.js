import { formatStamp, normalizeUrl } from "./format.js";
import { sanitize } from "./sanitize.js";

const TOOL_GROUPS = [
  [
    { id: "undo", label: "UNDO", title: "Undo (Ctrl+Z)" },
    { id: "redo", label: "REDO", title: "Redo (Ctrl+Y)" },
  ],
  [
    { id: "p", label: "P", title: "Paragraph" },
    { id: "h1", label: "H1", title: "Heading 1" },
    { id: "h2", label: "H2", title: "Heading 2" },
    { id: "h3", label: "H3", title: "Heading 3" },
  ],
  [
    { id: "bold", label: "B", title: "Bold (Ctrl+B)" },
    { id: "italic", label: "I", title: "Italic (Ctrl+I)" },
    { id: "underline", label: "U", title: "Underline (Ctrl+U)" },
    { id: "strike", label: "S", title: "Strikethrough" },
    { id: "sub", label: "SUB", title: "Subscript" },
    { id: "sup", label: "SUP", title: "Superscript" },
  ],
  [
    { id: "color", label: "INK", title: "Text color" },
    { id: "mark", label: "MARK", title: "Highlight" },
  ],
  [
    { id: "left", label: "LEFT", title: "Align left" },
    { id: "center", label: "CENTER", title: "Align center" },
    { id: "right", label: "RIGHT", title: "Align right" },
    { id: "justify", label: "JUST", title: "Justify" },
  ],
  [
    { id: "bullet", label: "LIST", title: "Bullet list" },
    { id: "number", label: "NUM", title: "Numbered list" },
    { id: "task", label: "TASK", title: "Checklist" },
    { id: "outdent", label: "OUT", title: "Outdent" },
    { id: "indent", label: "IN", title: "Indent" },
  ],
  [
    { id: "quote", label: "QUOTE", title: "Quote" },
    { id: "code", label: "CODE", title: "Inline code" },
    { id: "pre", label: "PRE", title: "Code block" },
  ],
  [
    { id: "link", label: "LINK", title: "Link" },
    { id: "rule", label: "RULE", title: "Horizontal rule" },
    { id: "stamp", label: "STAMP", title: "Insert the current time" },
    { id: "clear", label: "CLEAR", title: "Clear formatting" },
  ],
];

const INK = ["#e8f7ff", "#3df0ff", "#ff3d9a", "#ffc14a", "#ff5d67", "#5dffb0"];
const MARKS = ["#12343c", "#3a1230", "#3a3010", "#14301f"];

const PRESSED = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
  sub: "subscript",
  sup: "superscript",
};

let body = null;
let toolkit = null;
let onChange = null;
let onError = null;
let onFiles = null;
let savedRange = null;
let openPop = null;

function notify() {
  syncEmpty();
  onChange?.();
}

function syncEmpty() {
  const text = body.innerText.replace(/[\u00a0\u200b]/g, " ").trim();
  body.classList.toggle("is-empty", text.length === 0);
}

function prepareCommands() {
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("defaultParagraphSeparator", false, "p");
}

function currentElement() {
  const selection = document.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function saveRange() {
  const selection = document.getSelection();
  savedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
}

function restoreRange() {
  if (!savedRange) return;
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function focusBody() {
  body.focus();
}

function setPopover(name) {
  openPop = name;
  for (const id of ["color-pop", "mark-pop", "link-pop"]) {
    const pop = toolkit.querySelector(`#${id}`);
    if (pop) pop.hidden = id !== `${name}-pop`;
  }
  toolkit.querySelectorAll("[data-pop]").forEach((button) => {
    button.setAttribute("aria-expanded", String(button.dataset.pop === name));
  });
}

export function closePopovers() {
  setPopover(null);
}

function placeCaretAfter(node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertChecklist() {
  const list = document.createElement("ul");
  list.className = "check";
  const item = document.createElement("li");
  const box = document.createElement("span");
  box.className = "box";
  box.contentEditable = "false";
  box.dataset.checked = "0";
  item.append(box, document.createTextNode("\u200b"));
  list.append(item);
  const selection = document.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(list);
  placeCaretAfter(box);
}

function wrapInlineCode() {
  const selection = document.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const code = document.createElement("code");
  if (range.collapsed) {
    code.textContent = "code";
    range.insertNode(code);
    const next = document.createRange();
    next.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(next);
    return;
  }
  code.append(range.extractContents());
  range.insertNode(code);
}

function insertCodeBlock() {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = "code";
  pre.append(code);
  const selection = document.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(pre);
  const next = document.createRange();
  next.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(next);
}

function applyLink(raw) {
  const clean = normalizeUrl(raw);
  if (!clean) {
    onError?.("Enter a web address or email.");
    return;
  }
  restoreRange();
  prepareCommands();
  const selection = document.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) {
    const link = document.createElement("a");
    link.href = clean;
    link.textContent = clean.replace(/^mailto:/, "");
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range) {
      range.insertNode(link);
      placeCaretAfter(link);
    }
  } else {
    document.execCommand("createLink", false, clean);
  }
  closePopovers();
  notify();
  focusBody();
}

function runTool(id) {
  restoreRange();
  prepareCommands();
  if (id === "color" || id === "mark" || id === "link") {
    saveRange();
    setPopover(openPop === id ? null : id);
    if (id === "link" && openPop === "link") {
      const input = toolkit.querySelector("#link-input");
      input.value = "";
      input.focus();
    }
    return;
  }
  closePopovers();
  focusBody();
  const commands = {
    undo: () => document.execCommand("undo"),
    redo: () => document.execCommand("redo"),
    p: () => document.execCommand("formatBlock", false, "P"),
    h1: () => document.execCommand("formatBlock", false, "H1"),
    h2: () => document.execCommand("formatBlock", false, "H2"),
    h3: () => document.execCommand("formatBlock", false, "H3"),
    bold: () => document.execCommand("bold"),
    italic: () => document.execCommand("italic"),
    underline: () => document.execCommand("underline"),
    strike: () => document.execCommand("strikeThrough"),
    sub: () => document.execCommand("subscript"),
    sup: () => document.execCommand("superscript"),
    left: () => document.execCommand("justifyLeft"),
    center: () => document.execCommand("justifyCenter"),
    right: () => document.execCommand("justifyRight"),
    justify: () => document.execCommand("justifyFull"),
    bullet: () => document.execCommand("insertUnorderedList"),
    number: () => document.execCommand("insertOrderedList"),
    task: () => insertChecklist(),
    outdent: () => document.execCommand("outdent"),
    indent: () => document.execCommand("indent"),
    quote: () => document.execCommand("formatBlock", false, "BLOCKQUOTE"),
    code: () => wrapInlineCode(),
    pre: () => insertCodeBlock(),
    rule: () => document.execCommand("insertHorizontalRule"),
    stamp: () => {
      const stamp = formatStamp(new Date());
      document.execCommand("insertText", false, `${stamp.date}  ${stamp.time}`);
    },
    clear: () => document.execCommand("removeFormat"),
  };
  commands[id]?.();
  notify();
  updateStates();
}

function updateStates() {
  const selection = document.getSelection();
  const inside = selection?.anchorNode && body.contains(selection.anchorNode);
  for (const [id, command] of Object.entries(PRESSED)) {
    const button = toolkit.querySelector(`[data-tool="${id}"]`);
    if (!button) continue;
    let pressed = false;
    if (inside) {
      try { pressed = document.queryCommandState(command); } catch { pressed = false; }
    }
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function buildPalette(id, colors, command) {
  const pop = document.createElement("div");
  pop.id = id;
  pop.className = "popover";
  pop.hidden = true;
  for (const color of colors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = color;
    button.title = color;
    button.setAttribute("aria-label", color);
    button.addEventListener("click", () => {
      restoreRange();
      focusBody();
      prepareCommands();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, color);
      document.execCommand("styleWithCSS", false, "false");
      closePopovers();
      notify();
    });
    pop.append(button);
  }
  return pop;
}

function buildToolkit() {
  const label = document.createElement("span");
  label.className = "toolkit-label";
  label.textContent = "WRITING TOOLKIT";
  toolkit.append(label);

  for (const group of TOOL_GROUPS) {
    for (const tool of group) {
      const anchor = document.createElement("span");
      anchor.className = "tool-anchor";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool";
      button.id = `tool-${tool.id}`;
      button.dataset.tool = tool.id;
      button.title = tool.title;
      button.setAttribute("aria-label", tool.title);
      button.textContent = tool.label;
      if (tool.id === "color" || tool.id === "mark" || tool.id === "link") {
        button.dataset.pop = tool.id;
        button.setAttribute("aria-expanded", "false");
      }
      button.addEventListener("click", () => runTool(tool.id));
      anchor.append(button);
      if (tool.id === "color") anchor.append(buildPalette("color-pop", INK, "foreColor"));
      if (tool.id === "mark") anchor.append(buildPalette("mark-pop", MARKS, "hiliteColor"));
      if (tool.id === "link") anchor.append(buildLinkPopover());
      toolkit.append(anchor);
    }
    const gap = document.createElement("span");
    gap.className = "tool-gap";
    gap.setAttribute("aria-hidden", "true");
    toolkit.append(gap);
  }
}

function buildLinkPopover() {
  const pop = document.createElement("form");
  pop.id = "link-pop";
  pop.className = "popover link-pop";
  pop.hidden = true;
  const input = document.createElement("input");
  input.id = "link-input";
  input.type = "text";
  input.placeholder = "https://";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Link address");
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.className = "tool apply-link";
  apply.textContent = "APPLY";
  pop.append(input, apply);
  pop.addEventListener("submit", (event) => {
    event.preventDefault();
    applyLink(input.value);
  });
  return pop;
}

function onEditorKeydown(event) {
  const listItem = currentElement()?.closest("li");
  const checklist = listItem?.closest("ul.check");
  if (event.key === "Enter" && !event.shiftKey && checklist && listItem) {
    event.preventDefault();
    const item = document.createElement("li");
    const box = document.createElement("span");
    box.className = "box";
    box.contentEditable = "false";
    box.dataset.checked = "0";
    item.append(box, document.createTextNode("\u200b"));
    listItem.after(item);
    placeCaretAfter(box);
    notify();
    return;
  }
  if (event.key === "Backspace" && checklist && listItem) {
    const selection = document.getSelection();
    const text = listItem.textContent.replace(/[\u200b\u00a0]/g, "").trim();
    if (!text && selection?.isCollapsed) {
      event.preventDefault();
      const list = listItem.parentElement;
      const previous = listItem.previousElementSibling;
      listItem.remove();
      if (!list.querySelector("li")) list.remove();
      else if (previous) placeCaretAfter(previous.querySelector(".box") || previous);
      notify();
    }
  }
  if (event.key === "Tab") {
    event.preventDefault();
    prepareCommands();
    document.execCommand(event.shiftKey ? "outdent" : "indent");
    notify();
  }
}

function onPaste(event) {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) {
    event.preventDefault();
    onFiles?.(files);
    return;
  }
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain");
  if (!html && text == null) return;
  event.preventDefault();
  prepareCommands();
  if (html) document.execCommand("insertHTML", false, sanitize(html));
  else document.execCommand("insertText", false, text);
  notify();
}

export function mountEditor(options) {
  body = options.body;
  toolkit = options.toolkit;
  onChange = options.onChange;
  onError = options.onError;
  onFiles = options.onFiles;
  body.addEventListener("focus", prepareCommands);
  body.addEventListener("input", notify);
  body.addEventListener("keydown", onEditorKeydown);
  body.addEventListener("paste", onPaste);
  body.addEventListener("dragover", (event) => event.preventDefault());
  body.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) {
      event.preventDefault();
      onFiles?.(files);
      return;
    }
    const html = event.dataTransfer?.getData("text/html");
    if (!html) return;
    event.preventDefault();
    prepareCommands();
    document.execCommand("insertHTML", false, sanitize(html));
    notify();
  });
  body.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link && body.contains(link)) {
      event.preventDefault();
      const href = link.getAttribute("href");
      if (href) window.open(href, "_blank", "noopener");
      return;
    }
    const box = event.target.closest(".box");
    if (!box || !body.contains(box)) return;
    event.preventDefault();
    box.dataset.checked = box.dataset.checked === "1" ? "0" : "1";
    notify();
  });
  toolkit.addEventListener("mousedown", (event) => {
    if (!event.target.closest("button")) return;
    saveRange();
    event.preventDefault();
  }, true);
  document.addEventListener("selectionchange", updateStates);
  document.addEventListener("pointerdown", (event) => {
    if (!openPop) return;
    if (event.target.closest(".popover, [data-pop]")) return;
    closePopovers();
  });
  buildToolkit();
  prepareCommands();

  return {
    setHtml(html) {
      body.innerHTML = sanitize(html || "");
      syncEmpty();
    },
    getHtml() {
      return sanitize(body.innerHTML);
    },
    getText() {
      return body.innerText.replace(/[\u00a0\u200b]/g, " ");
    },
    focus() {
      body.focus();
    },
    closePopovers,
  };
}


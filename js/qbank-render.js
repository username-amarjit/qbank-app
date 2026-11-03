/*
 * QBank block renderer.
 * Builds DOM nodes from question blocks (schema 1.1.0). It never parses or inserts raw HTML from question data.
 * Math is rendered with KaTeX when window.katex is loaded, with trust disabled.
 */
(function (global) {
  "use strict";

  var MARK_TAGS = { bold: "b", italic: "i", underline: "u", strike: "s", sup: "sup", sub: "sub", code: "code" };

  function isWebUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (error) {
      return false;
    }
  }

  function renderText(block) {
    var node = document.createTextNode(block.text);
    (block.marks || []).forEach(function (mark) {
      var tag = MARK_TAGS[mark];
      if (!tag) {
        return;
      }
      var wrapper = document.createElement(tag);
      wrapper.appendChild(node);
      node = wrapper;
    });
    if (block.href && isWebUrl(block.href)) {
      var link = document.createElement("a");
      link.href = block.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(node);
      node = link;
    }
    return node;
  }

  function renderMath(block) {
    var element = document.createElement(block.display ? "div" : "span");
    element.className = "qb-math";
    if (global.katex) {
      try {
        global.katex.render(block.latex, element, {
          displayMode: !!block.display,
          throwOnError: false,
          strict: "ignore",
          trust: false,
          output: "htmlAndMathml"
        });
        return element;
      } catch (error) {
        element.textContent = "";
      }
    }
    element.classList.add("qb-math-raw");
    element.textContent = block.latex;
    return element;
  }

  function renderImage(block, options) {
    var asset = (options.assets || {})[block.asset_id];
    var url = asset && options.assetUrl ? options.assetUrl(asset) : null;
    if (!url) {
      var missing = document.createElement("span");
      missing.className = "qb-missing";
      missing.textContent = "[image not available]";
      return missing;
    }
    var image = document.createElement("img");
    image.src = url;
    image.alt = (asset && asset.alt_text) || "";
    image.loading = "lazy";
    image.className = "qb-image";
    return image;
  }

  function renderCode(block) {
    var pre = document.createElement("pre");
    pre.className = "qb-code";
    var code = document.createElement("code");
    code.textContent = block.text;
    pre.appendChild(code);
    return pre;
  }

  function renderTable(block, options) {
    var wrapper = document.createElement("div");
    wrapper.className = "qb-table-wrap";
    var table = document.createElement("table");
    table.className = "qb-table";
    var body = document.createElement("tbody");
    var rows = block.cells || block.rows.map(function (row) {
      return row.map(function (text) {
        return text ? [{ type: "text", text: text }] : [];
      });
    });
    rows.forEach(function (row, rowIndex) {
      var tr = document.createElement("tr");
      row.forEach(function (cellBlocks) {
        var cell = document.createElement(block.header_row && rowIndex === 0 ? "th" : "td");
        renderBlocks(cellBlocks, cell, options);
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    return wrapper;
  }

  function renderList(block, options) {
    var list = document.createElement(block.ordered ? "ol" : "ul");
    block.items.forEach(function (item) {
      var entry = document.createElement("li");
      renderBlocks(item, entry, options);
      list.appendChild(entry);
    });
    return list;
  }

  function renderUnknown(block) {
    var span = document.createElement("span");
    span.className = "qb-unknown";
    // DOMParser documents have no browsing context, so nothing in them runs or loads.
    var parsed = new DOMParser().parseFromString(block.html_original || "", "text/html");
    span.textContent = parsed.body.textContent || "";
    return span;
  }

  function renderBlock(block, options) {
    switch (block.type) {
      case "text":
        return renderText(block);
      case "math":
        return renderMath(block);
      case "line_break":
        return document.createElement("br");
      case "code":
        return renderCode(block);
      case "image":
        return renderImage(block, options);
      case "table":
        return renderTable(block, options);
      case "list":
        return renderList(block, options);
      default:
        return renderUnknown(block);
    }
  }

  function renderBlocks(blocks, container, options) {
    (blocks || []).forEach(function (block) {
      container.appendChild(renderBlock(block, options || {}));
    });
    return container;
  }

  global.QBankRender = { renderBlocks: renderBlocks, isWebUrl: isWebUrl };
})(window);

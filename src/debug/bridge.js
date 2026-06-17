(function () {
  const BRIDGE_TYPE = '__debugBridge';
  const REQUEST_TYPE = '__debugBridgeRequest';
  const DEFAULT_SELECTOR = '.input-container';
  const pendingMessages = [];
  let vscodeApi;

  function installVsCodeApiHook() {
    const originalAcquire = window.acquireVsCodeApi;
    if (typeof originalAcquire !== 'function') {
      return;
    }

    window.acquireVsCodeApi = function acquireWrappedVsCodeApi() {
      const api = originalAcquire.apply(this, arguments);
      if (!vscodeApi) {
        vscodeApi = api;
        flushPendingMessages();
        postToHost({
          type: BRIDGE_TYPE,
          message: {
            kind: 'ready',
            href: window.location.href,
            title: document.title,
          },
        });
      }
      return api;
    };
  }

  function flushPendingMessages() {
    if (!vscodeApi) {
      return;
    }
    while (pendingMessages.length > 0) {
      vscodeApi.postMessage(pendingMessages.shift());
    }
  }

  function postToHost(message) {
    if (!vscodeApi) {
      pendingMessages.push(message);
      return;
    }
    vscodeApi.postMessage(message);
  }

  function sanitize(value, depth) {
    if (depth > 4) {
      return '[max-depth]';
    }

    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'function') {
      return `[function ${value.name || 'anonymous'}]`;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (value instanceof Element) {
      return {
        tagName: value.tagName,
        id: value.id || null,
        className: value.className || null,
        textContent: (value.textContent || '').slice(0, 500),
      };
    }

    if (value instanceof Node) {
      return {
        nodeType: value.nodeType,
        nodeName: value.nodeName,
        textContent: (value.textContent || '').slice(0, 500),
      };
    }

    if (typeof File !== 'undefined' && value instanceof File) {
      return {
        name: value.name,
        type: value.type,
        size: value.size,
      };
    }

    if (typeof DataTransfer !== 'undefined' && value instanceof DataTransfer) {
      return {
        types: Array.from(value.types || []),
        files: value.files ? Array.from(value.files).map((file) => sanitize(file, depth + 1)) : [],
      };
    }

    if (Array.isArray(value)) {
      return value.slice(0, 25).map((item) => sanitize(item, depth + 1));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      const output = {};
      for (const key of Object.keys(value).slice(0, 50)) {
        try {
          output[key] = sanitize(value[key], depth + 1);
        } catch (error) {
          output[key] = `[unserializable: ${error instanceof Error ? error.message : String(error)}]`;
        }
      }
      return output;
    }

    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }

  function wrapConsole() {
    for (const level of ['log', 'info', 'warn', 'error']) {
      const original = console[level].bind(console);
      console[level] = function wrappedConsole() {
        original.apply(console, arguments);
        postToHost({
          type: BRIDGE_TYPE,
          message: {
            kind: 'log',
            level,
            args: Array.from(arguments).map((arg) => sanitize(arg, 0)),
            timestamp: Date.now(),
          },
        });
      };
    }
  }

  function reportWindowError(event) {
    postToHost({
      type: BRIDGE_TYPE,
      message: {
        kind: 'pageError',
        message: event.message,
        stack: event.error && event.error.stack ? event.error.stack : undefined,
        source: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
        timestamp: Date.now(),
      },
    });
  }

  function reportUnhandledRejection(event) {
    postToHost({
      type: BRIDGE_TYPE,
      message: {
        kind: 'unhandledRejection',
        reason: sanitize(event.reason, 0),
        timestamp: Date.now(),
      },
    });
  }

  function toFileUri(path) {
    if (/^file:\/\//.test(path)) {
      return path;
    }

    if (/^[A-Za-z]:\\/.test(path)) {
      return 'file:///' + encodeURI(path.replace(/\\/g, '/'));
    }

    return 'file://' + encodeURI(path);
  }

  function createDragEvent(type, dataTransfer) {
    try {
      return new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
    } catch {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        configurable: true,
        enumerable: true,
        value: dataTransfer,
      });
      return event;
    }
  }

  function resolveDropTarget(selector) {
    return document.querySelector(selector || DEFAULT_SELECTOR)
      || document.querySelector('[contenteditable="true"]');
  }

  function simulateDrop(path, selector) {
    const target = resolveDropTarget(selector);
    if (!target) {
      throw new Error(`Drop target not found for selector: ${selector || DEFAULT_SELECTOR}`);
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/uri-list', toFileUri(path));
    dataTransfer.setData('text/plain', path);

    const events = ['dragenter', 'dragover', 'drop'];
    const dispatched = [];
    for (const type of events) {
      const event = createDragEvent(type, dataTransfer);
      dispatched.push({ type, defaultPrevented: !target.dispatchEvent(event) || event.defaultPrevented });
    }

    return {
      target: sanitize(target, 0),
      selector: selector || DEFAULT_SELECTOR,
      path,
      dispatched,
    };
  }

  function getNonce() {
    var currentScript = document.currentScript
      || document.querySelector('script[src$="bridge.js"]');
    if (currentScript) {
      return currentScript.nonce || currentScript.getAttribute('nonce');
    }
    return '';
  }

  function evaluate(code) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var nonce = getNonce();
      if (nonce) {
        script.nonce = nonce;
      }

      var wrapped = [
        '"use strict";',
        'try {',
        '  var __v = (function() { return (' + code + '); })();',
        '  window.__debugBridgeResult = { ok: true, value: __v };',
        '} catch(error) {',
        '  window.__debugBridgeResult = { ok: false, error: { message: error.message, stack: error.stack } };',
        '}',
      ].join('\n');

      script.textContent = wrapped;
      document.body.appendChild(script);

      setTimeout(function () {
        var r = window.__debugBridgeResult;
        delete window.__debugBridgeResult;
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        if (!r) {
          reject(new Error('Script execution did not produce a result'));
        } else if (r.ok) {
          resolve(r.value);
        } else {
          var err = new Error(r.error.message);
          if (r.error.stack) {
            err.stack = r.error.stack;
          }
          reject(err);
        }
      }, 0);
    });
  }

  async function handleRequest(request) {
    try {
      let result;
      if (request.kind === 'evaluate') {
        result = await evaluate(request.code);
      } else if (request.kind === 'simulateDrop') {
        result = simulateDrop(request.path, request.selector);
      } else {
        throw new Error(`Unknown debug bridge request kind: ${request.kind}`);
      }

      postToHost({
        type: BRIDGE_TYPE,
        message: {
          kind: 'response',
          requestId: request.requestId,
          ok: true,
          result: sanitize(result, 0),
        },
      });
    } catch (error) {
      postToHost({
        type: BRIDGE_TYPE,
        message: {
          kind: 'response',
          requestId: request.requestId,
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
        },
      });
    }
  }

  window.addEventListener('error', reportWindowError);
  window.addEventListener('unhandledrejection', reportUnhandledRejection);
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === REQUEST_TYPE && event.data.request) {
      void handleRequest(event.data.request);
    }
  });

  installVsCodeApiHook();
  wrapConsole();
})();

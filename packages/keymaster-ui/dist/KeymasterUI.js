"use strict";

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _react = _interopRequireWildcard(require("react"));
var _material = require("@mui/material");
var _axios = _interopRequireDefault(require("axios"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function _getRequireWildcardCache(e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n["default"] = e, t && t.set(e, n), n; }
function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag"; function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; } try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; } function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []); return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; } function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } } e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} var p = {}; define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([]))); v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p); function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); } function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o); if ("throw" !== c.type) { var u = c.arg, h = u.value; return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); } a(c.arg); } var r; o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); } return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); } function makeInvokeMethod(e, r, n) { var o = h; return function (i, a) { if (o === f) throw new Error("Generator is already running"); if (o === s) { if ("throw" === i) throw a; return { value: t, done: !0 }; } for (n.method = i, n.arg = a;;) { var c = n.delegate; if (c) { var u = maybeInvokeDelegate(c, n); if (u) { if (u === y) continue; return u; } } if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n); if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; return { value: p.arg, done: n.done }; } "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; } function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n]; if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg); if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg; return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); } function pushTryEntry(t) { var e = { tryLoc: t[0] }; 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); } function resetTryEntry(t) { var e = t.completion || {}; e.type = "normal", delete e.arg, t.completion = e; } function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); } function values(e) { if (e || "" === e) { var r = e[a]; if (r) return r.call(e); if ("function" == typeof e.next) return e; if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; return next.value = t, next.done = !0, next; }; return i.next = i; } } throw new TypeError(_typeof(e) + " is not iterable"); } return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor; return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i); return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = []; for (var n in e) r.push(n); return r.reverse(), function next() { for (; r.length;) { var t = r.pop(); if (t in e) return next.value = t, next.done = !1, next; } return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion; if ("throw" === t.type) throw t.arg; return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this; function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; } for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion; if ("root" === i.tryLoc) return handle("end"); if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc"); if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw new Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r]; if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o; break; } } i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {}; return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e]; if (r.tryLoc === t) { var n = r.completion; if ("throw" === n.type) { var o = n.arg; resetTryEntry(r); } return o; } } throw new Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }
function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }
function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }
function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }
function KeymasterUI(_ref) {
  var keymaster = _ref.keymaster,
    title = _ref.title,
    challengeDID = _ref.challengeDID;
  var _useState = (0, _react.useState)(null),
    _useState2 = _slicedToArray(_useState, 2),
    tab = _useState2[0],
    setTab = _useState2[1];
  var _useState3 = (0, _react.useState)(''),
    _useState4 = _slicedToArray(_useState3, 2),
    currentId = _useState4[0],
    setCurrentId = _useState4[1];
  var _useState5 = (0, _react.useState)(''),
    _useState6 = _slicedToArray(_useState5, 2),
    saveId = _useState6[0],
    setSaveId = _useState6[1];
  var _useState7 = (0, _react.useState)(''),
    _useState8 = _slicedToArray(_useState7, 2),
    currentDID = _useState8[0],
    setCurrentDID = _useState8[1];
  var _useState9 = (0, _react.useState)(''),
    _useState10 = _slicedToArray(_useState9, 2),
    selectedId = _useState10[0],
    setSelectedId = _useState10[1];
  var _useState11 = (0, _react.useState)(null),
    _useState12 = _slicedToArray(_useState11, 2),
    docsString = _useState12[0],
    setDocsString = _useState12[1];
  var _useState13 = (0, _react.useState)(null),
    _useState14 = _slicedToArray(_useState13, 2),
    idList = _useState14[0],
    setIdList = _useState14[1];
  var _useState15 = (0, _react.useState)(null),
    _useState16 = _slicedToArray(_useState15, 2),
    challenge = _useState16[0],
    setChallenge = _useState16[1];
  var _useState17 = (0, _react.useState)(null),
    _useState18 = _slicedToArray(_useState17, 2),
    callback = _useState18[0],
    setCallback = _useState18[1];
  var _useState19 = (0, _react.useState)(false),
    _useState20 = _slicedToArray(_useState19, 2),
    widget = _useState20[0],
    setWidget = _useState20[1];
  var _useState21 = (0, _react.useState)(null),
    _useState22 = _slicedToArray(_useState21, 2),
    response = _useState22[0],
    setResponse = _useState22[1];
  var _useState23 = (0, _react.useState)(false),
    _useState24 = _slicedToArray(_useState23, 2),
    accessGranted = _useState24[0],
    setAccessGranted = _useState24[1];
  var _useState25 = (0, _react.useState)(''),
    _useState26 = _slicedToArray(_useState25, 2),
    newName = _useState26[0],
    setNewName = _useState26[1];
  var _useState27 = (0, _react.useState)('hyperswarm'),
    _useState28 = _slicedToArray(_useState27, 2),
    registry = _useState28[0],
    setRegistry = _useState28[1];
  var _useState29 = (0, _react.useState)(null),
    _useState30 = _slicedToArray(_useState29, 2),
    nameList = _useState30[0],
    setNameList = _useState30[1];
  var _useState31 = (0, _react.useState)(''),
    _useState32 = _slicedToArray(_useState31, 2),
    aliasName = _useState32[0],
    setAliasName = _useState32[1];
  var _useState33 = (0, _react.useState)(''),
    _useState34 = _slicedToArray(_useState33, 2),
    aliasDID = _useState34[0],
    setAliasDID = _useState34[1];
  var _useState35 = (0, _react.useState)(''),
    _useState36 = _slicedToArray(_useState35, 2),
    selectedName = _useState36[0],
    setSelectedName = _useState36[1];
  var _useState37 = (0, _react.useState)(''),
    _useState38 = _slicedToArray(_useState37, 2),
    aliasDocs = _useState38[0],
    setAliasDocs = _useState38[1];
  var _useState39 = (0, _react.useState)(null),
    _useState40 = _slicedToArray(_useState39, 2),
    registries = _useState40[0],
    setRegistries = _useState40[1];
  var _useState41 = (0, _react.useState)(null),
    _useState42 = _slicedToArray(_useState41, 2),
    groupList = _useState42[0],
    setGroupList = _useState42[1];
  var _useState43 = (0, _react.useState)(''),
    _useState44 = _slicedToArray(_useState43, 2),
    groupName = _useState44[0],
    setGroupName = _useState44[1];
  var _useState45 = (0, _react.useState)(''),
    _useState46 = _slicedToArray(_useState45, 2),
    selectedGroupName = _useState46[0],
    setSelectedGroupName = _useState46[1];
  var _useState47 = (0, _react.useState)(''),
    _useState48 = _slicedToArray(_useState47, 2),
    selectedGroup = _useState48[0],
    setSelectedGroup = _useState48[1];
  var _useState49 = (0, _react.useState)(''),
    _useState50 = _slicedToArray(_useState49, 2),
    memberDID = _useState50[0],
    setMemberDID = _useState50[1];
  var _useState51 = (0, _react.useState)(''),
    _useState52 = _slicedToArray(_useState51, 2),
    memberDocs = _useState52[0],
    setMemberDocs = _useState52[1];
  var _useState53 = (0, _react.useState)(null),
    _useState54 = _slicedToArray(_useState53, 2),
    schemaList = _useState54[0],
    setSchemaList = _useState54[1];
  var _useState55 = (0, _react.useState)(''),
    _useState56 = _slicedToArray(_useState55, 2),
    schemaName = _useState56[0],
    setSchemaName = _useState56[1];
  var _useState57 = (0, _react.useState)(''),
    _useState58 = _slicedToArray(_useState57, 2),
    schemaString = _useState58[0],
    setSchemaString = _useState58[1];
  var _useState59 = (0, _react.useState)(''),
    _useState60 = _slicedToArray(_useState59, 2),
    selectedSchemaName = _useState60[0],
    setSelectedSchemaName = _useState60[1];
  var _useState61 = (0, _react.useState)(''),
    _useState62 = _slicedToArray(_useState61, 2),
    editedSchemaName = _useState62[0],
    setEditedSchemaName = _useState62[1];
  var _useState63 = (0, _react.useState)(''),
    _useState64 = _slicedToArray(_useState63, 2),
    selectedSchema = _useState64[0],
    setSelectedSchema = _useState64[1];
  var _useState65 = (0, _react.useState)(null),
    _useState66 = _slicedToArray(_useState65, 2),
    agentList = _useState66[0],
    setAgentList = _useState66[1];
  var _useState67 = (0, _react.useState)(''),
    _useState68 = _slicedToArray(_useState67, 2),
    credentialTab = _useState68[0],
    setCredentialTab = _useState68[1];
  var _useState69 = (0, _react.useState)(''),
    _useState70 = _slicedToArray(_useState69, 2),
    credentialDID = _useState70[0],
    setCredentialDID = _useState70[1];
  var _useState71 = (0, _react.useState)(''),
    _useState72 = _slicedToArray(_useState71, 2),
    credentialSubject = _useState72[0],
    setCredentialSubject = _useState72[1];
  var _useState73 = (0, _react.useState)(''),
    _useState74 = _slicedToArray(_useState73, 2),
    credentialSchema = _useState74[0],
    setCredentialSchema = _useState74[1];
  var _useState75 = (0, _react.useState)(''),
    _useState76 = _slicedToArray(_useState75, 2),
    credentialString = _useState76[0],
    setCredentialString = _useState76[1];
  var _useState77 = (0, _react.useState)(null),
    _useState78 = _slicedToArray(_useState77, 2),
    heldList = _useState78[0],
    setHeldList = _useState78[1];
  var _useState79 = (0, _react.useState)(''),
    _useState80 = _slicedToArray(_useState79, 2),
    heldDID = _useState80[0],
    setHeldDID = _useState80[1];
  var _useState81 = (0, _react.useState)(''),
    _useState82 = _slicedToArray(_useState81, 2),
    heldString = _useState82[0],
    setHeldString = _useState82[1];
  var _useState83 = (0, _react.useState)(''),
    _useState84 = _slicedToArray(_useState83, 2),
    selectedHeld = _useState84[0],
    setSelectedHeld = _useState84[1];
  var _useState85 = (0, _react.useState)(null),
    _useState86 = _slicedToArray(_useState85, 2),
    issuedList = _useState86[0],
    setIssuedList = _useState86[1];
  var _useState87 = (0, _react.useState)(''),
    _useState88 = _slicedToArray(_useState87, 2),
    selectedIssued = _useState88[0],
    setSelectedIssued = _useState88[1];
  var _useState89 = (0, _react.useState)(''),
    _useState90 = _slicedToArray(_useState89, 2),
    issuedStringOriginal = _useState90[0],
    setIssuedStringOriginal = _useState90[1];
  var _useState91 = (0, _react.useState)(''),
    _useState92 = _slicedToArray(_useState91, 2),
    issuedString = _useState92[0],
    setIssuedString = _useState92[1];
  var _useState93 = (0, _react.useState)(false),
    _useState94 = _slicedToArray(_useState93, 2),
    issuedEdit = _useState94[0],
    setIssuedEdit = _useState94[1];
  var _useState95 = (0, _react.useState)(''),
    _useState96 = _slicedToArray(_useState95, 2),
    mnemonicString = _useState96[0],
    setMnemonicString = _useState96[1];
  var _useState97 = (0, _react.useState)(''),
    _useState98 = _slicedToArray(_useState97, 2),
    walletString = _useState98[0],
    setWalletString = _useState98[1];
  var _useState99 = (0, _react.useState)(null),
    _useState100 = _slicedToArray(_useState99, 2),
    manifest = _useState100[0],
    setManifest = _useState100[1];
  var _useState101 = (0, _react.useState)(false),
    _useState102 = _slicedToArray(_useState101, 2),
    checkingWallet = _useState102[0],
    setCheckingWallet = _useState102[1];
  var _useState103 = (0, _react.useState)(true),
    _useState104 = _slicedToArray(_useState103, 2),
    disableSendResponse = _useState104[0],
    setDisableSendResponse = _useState104[1];
  var _useState105 = (0, _react.useState)(''),
    _useState106 = _slicedToArray(_useState105, 2),
    authDID = _useState106[0],
    setAuthDID = _useState106[1];
  var _useState107 = (0, _react.useState)(''),
    _useState108 = _slicedToArray(_useState107, 2),
    authString = _useState108[0],
    setAuthString = _useState108[1];
  (0, _react.useEffect)(function () {
    checkForChallenge();
    refreshAll();
    // eslint-disable-next-line
  }, []);
  function checkForChallenge() {
    return _checkForChallenge.apply(this, arguments);
  }
  function _checkForChallenge() {
    _checkForChallenge = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee() {
      return _regeneratorRuntime().wrap(function _callee$(_context) {
        while (1) switch (_context.prev = _context.next) {
          case 0:
            try {
              if (challengeDID) {
                setChallenge(challengeDID);
                setWidget(true);
              }
            } catch (error) {
              window.alert(error);
            }
          case 1:
          case "end":
            return _context.stop();
        }
      }, _callee);
    }));
    return _checkForChallenge.apply(this, arguments);
  }
  function refreshAll() {
    return _refreshAll.apply(this, arguments);
  }
  function _refreshAll() {
    _refreshAll = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee2() {
      var _currentId, _registries, _idList, docs;
      return _regeneratorRuntime().wrap(function _callee2$(_context2) {
        while (1) switch (_context2.prev = _context2.next) {
          case 0:
            _context2.prev = 0;
            _context2.next = 3;
            return keymaster.getCurrentId();
          case 3:
            _currentId = _context2.sent;
            _context2.next = 6;
            return keymaster.listRegistries();
          case 6:
            _registries = _context2.sent;
            setRegistries(_registries);
            if (!_currentId) {
              _context2.next = 28;
              break;
            }
            setCurrentId(_currentId);
            setSelectedId(_currentId);
            _context2.next = 13;
            return keymaster.listIds();
          case 13:
            _idList = _context2.sent;
            setIdList(_idList);
            _context2.next = 17;
            return keymaster.resolveId(_currentId);
          case 17:
            docs = _context2.sent;
            setCurrentDID(docs.didDocument.id);
            setManifest(docs.didDocumentData.manifest);
            setDocsString(JSON.stringify(docs, null, 4));
            refreshNames();
            refreshHeld();
            refreshIssued();
            setTab('identity');
            setCredentialTab('held');
            _context2.next = 32;
            break;
          case 28:
            setCurrentId('');
            setSelectedId('');
            setCurrentDID('');
            setTab('create');
          case 32:
            setSaveId('');
            setNewName('');
            setMnemonicString('');
            setWalletString('');
            setSelectedName('');
            setSelectedHeld('');
            setSelectedIssued('');
            _context2.next = 44;
            break;
          case 41:
            _context2.prev = 41;
            _context2.t0 = _context2["catch"](0);
            window.alert(_context2.t0);
          case 44:
          case "end":
            return _context2.stop();
        }
      }, _callee2, null, [[0, 41]]);
    }));
    return _refreshAll.apply(this, arguments);
  }
  function selectId(_x) {
    return _selectId.apply(this, arguments);
  }
  function _selectId() {
    _selectId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee3(id) {
      return _regeneratorRuntime().wrap(function _callee3$(_context3) {
        while (1) switch (_context3.prev = _context3.next) {
          case 0:
            _context3.prev = 0;
            setSelectedId(id);
            _context3.next = 4;
            return keymaster.setCurrentId(id);
          case 4:
            refreshAll();
            _context3.next = 10;
            break;
          case 7:
            _context3.prev = 7;
            _context3.t0 = _context3["catch"](0);
            window.alert(_context3.t0);
          case 10:
          case "end":
            return _context3.stop();
        }
      }, _callee3, null, [[0, 7]]);
    }));
    return _selectId.apply(this, arguments);
  }
  function showCreate() {
    return _showCreate.apply(this, arguments);
  }
  function _showCreate() {
    _showCreate = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee4() {
      return _regeneratorRuntime().wrap(function _callee4$(_context4) {
        while (1) switch (_context4.prev = _context4.next) {
          case 0:
            setSaveId(currentId);
            setCurrentId('');
            setTab('create');
          case 3:
          case "end":
            return _context4.stop();
        }
      }, _callee4);
    }));
    return _showCreate.apply(this, arguments);
  }
  function cancelCreate() {
    return _cancelCreate.apply(this, arguments);
  }
  function _cancelCreate() {
    _cancelCreate = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
      return _regeneratorRuntime().wrap(function _callee5$(_context5) {
        while (1) switch (_context5.prev = _context5.next) {
          case 0:
            setCurrentId(saveId);
            setTab('identity');
          case 2:
          case "end":
            return _context5.stop();
        }
      }, _callee5);
    }));
    return _cancelCreate.apply(this, arguments);
  }
  function createId() {
    return _createId.apply(this, arguments);
  }
  function _createId() {
    _createId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee6() {
      return _regeneratorRuntime().wrap(function _callee6$(_context6) {
        while (1) switch (_context6.prev = _context6.next) {
          case 0:
            _context6.prev = 0;
            _context6.next = 3;
            return keymaster.createId(newName, registry);
          case 3:
            refreshAll();
            // TBD this should be done in keymaster?
            // The backup forces a change, triggering registration
            // const ok = await keymaster.backupId(currentId);
            _context6.next = 9;
            break;
          case 6:
            _context6.prev = 6;
            _context6.t0 = _context6["catch"](0);
            window.alert(_context6.t0);
          case 9:
          case "end":
            return _context6.stop();
        }
      }, _callee6, null, [[0, 6]]);
    }));
    return _createId.apply(this, arguments);
  }
  function resolveId() {
    return _resolveId.apply(this, arguments);
  }
  function _resolveId() {
    _resolveId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee7() {
      var docs;
      return _regeneratorRuntime().wrap(function _callee7$(_context7) {
        while (1) switch (_context7.prev = _context7.next) {
          case 0:
            _context7.prev = 0;
            _context7.next = 3;
            return keymaster.resolveId(selectedId);
          case 3:
            docs = _context7.sent;
            setManifest(docs.didDocumentData.manifest);
            setDocsString(JSON.stringify(docs, null, 4));
            _context7.next = 11;
            break;
          case 8:
            _context7.prev = 8;
            _context7.t0 = _context7["catch"](0);
            window.alert(_context7.t0);
          case 11:
          case "end":
            return _context7.stop();
        }
      }, _callee7, null, [[0, 8]]);
    }));
    return _resolveId.apply(this, arguments);
  }
  function removeId() {
    return _removeId.apply(this, arguments);
  }
  function _removeId() {
    _removeId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee8() {
      return _regeneratorRuntime().wrap(function _callee8$(_context8) {
        while (1) switch (_context8.prev = _context8.next) {
          case 0:
            _context8.prev = 0;
            if (!window.confirm("Are you sure you want to remove ".concat(selectedId, "?"))) {
              _context8.next = 5;
              break;
            }
            _context8.next = 4;
            return keymaster.removeId(selectedId);
          case 4:
            refreshAll();
          case 5:
            _context8.next = 10;
            break;
          case 7:
            _context8.prev = 7;
            _context8.t0 = _context8["catch"](0);
            window.alert(_context8.t0);
          case 10:
          case "end":
            return _context8.stop();
        }
      }, _callee8, null, [[0, 7]]);
    }));
    return _removeId.apply(this, arguments);
  }
  function backupId() {
    return _backupId.apply(this, arguments);
  }
  function _backupId() {
    _backupId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee9() {
      var ok;
      return _regeneratorRuntime().wrap(function _callee9$(_context9) {
        while (1) switch (_context9.prev = _context9.next) {
          case 0:
            _context9.prev = 0;
            _context9.next = 3;
            return keymaster.backupId(selectedId);
          case 3:
            ok = _context9.sent;
            if (ok) {
              window.alert("".concat(selectedId, " backup succeeded"));
              resolveId();
            } else {
              window.alert("".concat(selectedId, " backup failed"));
            }
            _context9.next = 10;
            break;
          case 7:
            _context9.prev = 7;
            _context9.t0 = _context9["catch"](0);
            window.alert(_context9.t0);
          case 10:
          case "end":
            return _context9.stop();
        }
      }, _callee9, null, [[0, 7]]);
    }));
    return _backupId.apply(this, arguments);
  }
  function recoverId() {
    return _recoverId.apply(this, arguments);
  }
  function _recoverId() {
    _recoverId = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee10() {
      var did, _response;
      return _regeneratorRuntime().wrap(function _callee10$(_context10) {
        while (1) switch (_context10.prev = _context10.next) {
          case 0:
            _context10.prev = 0;
            did = window.prompt("Please enter the DID:");
            if (!did) {
              _context10.next = 8;
              break;
            }
            _context10.next = 5;
            return keymaster.recoverId(did);
          case 5:
            _response = _context10.sent;
            refreshAll();
            window.alert(_response);
          case 8:
            _context10.next = 13;
            break;
          case 10:
            _context10.prev = 10;
            _context10.t0 = _context10["catch"](0);
            window.alert(_context10.t0);
          case 13:
          case "end":
            return _context10.stop();
        }
      }, _callee10, null, [[0, 10]]);
    }));
    return _recoverId.apply(this, arguments);
  }
  function newChallenge() {
    return _newChallenge.apply(this, arguments);
  }
  function _newChallenge() {
    _newChallenge = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee11() {
      var _challenge;
      return _regeneratorRuntime().wrap(function _callee11$(_context11) {
        while (1) switch (_context11.prev = _context11.next) {
          case 0:
            _context11.prev = 0;
            _context11.next = 3;
            return keymaster.createChallenge();
          case 3:
            _challenge = _context11.sent;
            setChallenge(_challenge);
            resolveChallenge(_challenge);
            _context11.next = 11;
            break;
          case 8:
            _context11.prev = 8;
            _context11.t0 = _context11["catch"](0);
            window.alert(_context11.t0);
          case 11:
          case "end":
            return _context11.stop();
        }
      }, _callee11, null, [[0, 8]]);
    }));
    return _newChallenge.apply(this, arguments);
  }
  function resolveChallenge(_x2) {
    return _resolveChallenge.apply(this, arguments);
  }
  function _resolveChallenge() {
    _resolveChallenge = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee12(did) {
      var asset;
      return _regeneratorRuntime().wrap(function _callee12$(_context12) {
        while (1) switch (_context12.prev = _context12.next) {
          case 0:
            _context12.prev = 0;
            _context12.next = 3;
            return keymaster.resolveAsset(did);
          case 3:
            asset = _context12.sent;
            setAuthDID(did);
            setAuthString(JSON.stringify(asset, null, 4));
            _context12.next = 11;
            break;
          case 8:
            _context12.prev = 8;
            _context12.t0 = _context12["catch"](0);
            window.alert(_context12.t0);
          case 11:
          case "end":
            return _context12.stop();
        }
      }, _callee12, null, [[0, 8]]);
    }));
    return _resolveChallenge.apply(this, arguments);
  }
  function createResponse() {
    return _createResponse.apply(this, arguments);
  }
  function _createResponse() {
    _createResponse = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee13() {
      var _response2, asset, _callback;
      return _regeneratorRuntime().wrap(function _callee13$(_context13) {
        while (1) switch (_context13.prev = _context13.next) {
          case 0:
            _context13.prev = 0;
            _context13.next = 3;
            return clearResponse();
          case 3:
            _context13.next = 5;
            return keymaster.createResponse(challenge);
          case 5:
            _response2 = _context13.sent;
            setResponse(_response2);
            _context13.next = 9;
            return keymaster.resolveAsset(challenge);
          case 9:
            asset = _context13.sent;
            _callback = asset.challenge.callback;
            setCallback(_callback);
            if (_callback) {
              setDisableSendResponse(false);
            }
            decryptResponse(_response2);
            _context13.next = 19;
            break;
          case 16:
            _context13.prev = 16;
            _context13.t0 = _context13["catch"](0);
            window.alert(_context13.t0);
          case 19:
          case "end":
            return _context13.stop();
        }
      }, _callee13, null, [[0, 16]]);
    }));
    return _createResponse.apply(this, arguments);
  }
  function clearChallenge() {
    return _clearChallenge.apply(this, arguments);
  }
  function _clearChallenge() {
    _clearChallenge = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee14() {
      return _regeneratorRuntime().wrap(function _callee14$(_context14) {
        while (1) switch (_context14.prev = _context14.next) {
          case 0:
            setChallenge('');
          case 1:
          case "end":
            return _context14.stop();
        }
      }, _callee14);
    }));
    return _clearChallenge.apply(this, arguments);
  }
  function decryptResponse(_x3) {
    return _decryptResponse.apply(this, arguments);
  }
  function _decryptResponse() {
    _decryptResponse = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee15(did) {
      var decrypted;
      return _regeneratorRuntime().wrap(function _callee15$(_context15) {
        while (1) switch (_context15.prev = _context15.next) {
          case 0:
            _context15.prev = 0;
            _context15.next = 3;
            return keymaster.decryptJSON(did);
          case 3:
            decrypted = _context15.sent;
            setAuthDID(did);
            setAuthString(JSON.stringify(decrypted, null, 4));
            _context15.next = 11;
            break;
          case 8:
            _context15.prev = 8;
            _context15.t0 = _context15["catch"](0);
            window.alert(_context15.t0);
          case 11:
          case "end":
            return _context15.stop();
        }
      }, _callee15, null, [[0, 8]]);
    }));
    return _decryptResponse.apply(this, arguments);
  }
  function verifyResponse() {
    return _verifyResponse.apply(this, arguments);
  }
  function _verifyResponse() {
    _verifyResponse = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee16() {
      var verify;
      return _regeneratorRuntime().wrap(function _callee16$(_context16) {
        while (1) switch (_context16.prev = _context16.next) {
          case 0:
            _context16.prev = 0;
            _context16.next = 3;
            return keymaster.verifyResponse(response);
          case 3:
            verify = _context16.sent;
            if (verify.match) {
              window.alert("Response is VALID");
              setAccessGranted(true);
            } else {
              window.alert("Response is NOT VALID");
              setAccessGranted(false);
            }
            _context16.next = 10;
            break;
          case 7:
            _context16.prev = 7;
            _context16.t0 = _context16["catch"](0);
            window.alert(_context16.t0);
          case 10:
          case "end":
            return _context16.stop();
        }
      }, _callee16, null, [[0, 7]]);
    }));
    return _verifyResponse.apply(this, arguments);
  }
  function clearResponse() {
    return _clearResponse.apply(this, arguments);
  }
  function _clearResponse() {
    _clearResponse = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee17() {
      return _regeneratorRuntime().wrap(function _callee17$(_context17) {
        while (1) switch (_context17.prev = _context17.next) {
          case 0:
            setResponse('');
            setAccessGranted(false);
          case 2:
          case "end":
            return _context17.stop();
        }
      }, _callee17);
    }));
    return _clearResponse.apply(this, arguments);
  }
  function sendResponse() {
    return _sendResponse.apply(this, arguments);
  }
  function _sendResponse() {
    _sendResponse = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee18() {
      return _regeneratorRuntime().wrap(function _callee18$(_context18) {
        while (1) switch (_context18.prev = _context18.next) {
          case 0:
            _context18.prev = 0;
            setDisableSendResponse(true);
            _context18.next = 4;
            return _axios["default"].post(callback, {
              response: response
            });
          case 4:
            _context18.next = 9;
            break;
          case 6:
            _context18.prev = 6;
            _context18.t0 = _context18["catch"](0);
            window.alert(_context18.t0);
          case 9:
          case "end":
            return _context18.stop();
        }
      }, _callee18, null, [[0, 6]]);
    }));
    return _sendResponse.apply(this, arguments);
  }
  function refreshNames() {
    return _refreshNames.apply(this, arguments);
  }
  function _refreshNames() {
    _refreshNames = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee19() {
      var nameList, names, groupList, _i, _names, name, isGroup, schemaList, _i2, _names2, _name, isSchema, agentList, _i3, _names3, _name2, isAgent;
      return _regeneratorRuntime().wrap(function _callee19$(_context19) {
        while (1) switch (_context19.prev = _context19.next) {
          case 0:
            _context19.next = 2;
            return keymaster.listNames();
          case 2:
            nameList = _context19.sent;
            names = Object.keys(nameList);
            setNameList(nameList);
            setAliasName('');
            setAliasDID('');
            setAliasDocs('');
            groupList = [];
            _i = 0, _names = names;
          case 10:
            if (!(_i < _names.length)) {
              _context19.next = 25;
              break;
            }
            name = _names[_i];
            _context19.prev = 12;
            _context19.next = 15;
            return keymaster.groupTest(name);
          case 15:
            isGroup = _context19.sent;
            if (isGroup) {
              groupList.push(name);
            }
            _context19.next = 22;
            break;
          case 19:
            _context19.prev = 19;
            _context19.t0 = _context19["catch"](12);
            return _context19.abrupt("continue", 22);
          case 22:
            _i++;
            _context19.next = 10;
            break;
          case 25:
            setGroupList(groupList);
            if (!groupList.includes(selectedGroupName)) {
              setSelectedGroupName('');
              setSelectedGroup(null);
            }
            schemaList = [];
            _i2 = 0, _names2 = names;
          case 29:
            if (!(_i2 < _names2.length)) {
              _context19.next = 44;
              break;
            }
            _name = _names2[_i2];
            _context19.prev = 31;
            _context19.next = 34;
            return keymaster.testSchema(_name);
          case 34:
            isSchema = _context19.sent;
            if (isSchema) {
              schemaList.push(_name);
            }
            _context19.next = 41;
            break;
          case 38:
            _context19.prev = 38;
            _context19.t1 = _context19["catch"](31);
            return _context19.abrupt("continue", 41);
          case 41:
            _i2++;
            _context19.next = 29;
            break;
          case 44:
            setSchemaList(schemaList);
            if (!schemaList.includes(selectedSchemaName)) {
              setSelectedSchemaName('');
              setSelectedSchema(null);
            }
            if (!schemaList.includes(credentialSchema)) {
              setCredentialSchema('');
              setCredentialString('');
            }
            _context19.next = 49;
            return keymaster.listIds();
          case 49:
            agentList = _context19.sent;
            _i3 = 0, _names3 = names;
          case 51:
            if (!(_i3 < _names3.length)) {
              _context19.next = 66;
              break;
            }
            _name2 = _names3[_i3];
            _context19.prev = 53;
            _context19.next = 56;
            return keymaster.testAgent(_name2);
          case 56:
            isAgent = _context19.sent;
            if (isAgent) {
              agentList.push(_name2);
            }
            _context19.next = 63;
            break;
          case 60:
            _context19.prev = 60;
            _context19.t2 = _context19["catch"](53);
            return _context19.abrupt("continue", 63);
          case 63:
            _i3++;
            _context19.next = 51;
            break;
          case 66:
            setAgentList(agentList);
            if (!agentList.includes(credentialSubject)) {
              setCredentialSubject('');
              setCredentialString('');
            }
          case 68:
          case "end":
            return _context19.stop();
        }
      }, _callee19, null, [[12, 19], [31, 38], [53, 60]]);
    }));
    return _refreshNames.apply(this, arguments);
  }
  function addName() {
    return _addName.apply(this, arguments);
  }
  function _addName() {
    _addName = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee20() {
      return _regeneratorRuntime().wrap(function _callee20$(_context20) {
        while (1) switch (_context20.prev = _context20.next) {
          case 0:
            _context20.prev = 0;
            _context20.next = 3;
            return keymaster.addName(aliasName, aliasDID);
          case 3:
            refreshNames();
            _context20.next = 9;
            break;
          case 6:
            _context20.prev = 6;
            _context20.t0 = _context20["catch"](0);
            window.alert(_context20.t0);
          case 9:
          case "end":
            return _context20.stop();
        }
      }, _callee20, null, [[0, 6]]);
    }));
    return _addName.apply(this, arguments);
  }
  function removeName(_x4) {
    return _removeName.apply(this, arguments);
  }
  function _removeName() {
    _removeName = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee21(name) {
      return _regeneratorRuntime().wrap(function _callee21$(_context21) {
        while (1) switch (_context21.prev = _context21.next) {
          case 0:
            _context21.prev = 0;
            if (!window.confirm("Are you sure you want to remove ".concat(name, "?"))) {
              _context21.next = 5;
              break;
            }
            _context21.next = 4;
            return keymaster.removeName(name);
          case 4:
            refreshNames();
          case 5:
            _context21.next = 10;
            break;
          case 7:
            _context21.prev = 7;
            _context21.t0 = _context21["catch"](0);
            window.alert(_context21.t0);
          case 10:
          case "end":
            return _context21.stop();
        }
      }, _callee21, null, [[0, 7]]);
    }));
    return _removeName.apply(this, arguments);
  }
  function resolveName(_x5) {
    return _resolveName.apply(this, arguments);
  }
  function _resolveName() {
    _resolveName = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee22(name) {
      var docs;
      return _regeneratorRuntime().wrap(function _callee22$(_context22) {
        while (1) switch (_context22.prev = _context22.next) {
          case 0:
            _context22.prev = 0;
            _context22.next = 3;
            return keymaster.resolveDID(name);
          case 3:
            docs = _context22.sent;
            setSelectedName(name);
            setAliasDocs(JSON.stringify(docs, null, 4));
            _context22.next = 11;
            break;
          case 8:
            _context22.prev = 8;
            _context22.t0 = _context22["catch"](0);
            window.alert(_context22.t0);
          case 11:
          case "end":
            return _context22.stop();
        }
      }, _callee22, null, [[0, 8]]);
    }));
    return _resolveName.apply(this, arguments);
  }
  function createGroup() {
    return _createGroup.apply(this, arguments);
  }
  function _createGroup() {
    _createGroup = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee23() {
      var groupDID;
      return _regeneratorRuntime().wrap(function _callee23$(_context23) {
        while (1) switch (_context23.prev = _context23.next) {
          case 0:
            _context23.prev = 0;
            if (!Object.keys(nameList).includes(groupName)) {
              _context23.next = 4;
              break;
            }
            alert("".concat(groupName, " already in use"));
            return _context23.abrupt("return");
          case 4:
            _context23.next = 6;
            return keymaster.createGroup(groupName, registry);
          case 6:
            groupDID = _context23.sent;
            _context23.next = 9;
            return keymaster.addName(groupName, groupDID);
          case 9:
            setGroupName('');
            refreshNames();
            setSelectedGroupName(groupName);
            refreshGroup(groupName);
            _context23.next = 18;
            break;
          case 15:
            _context23.prev = 15;
            _context23.t0 = _context23["catch"](0);
            window.alert(_context23.t0);
          case 18:
          case "end":
            return _context23.stop();
        }
      }, _callee23, null, [[0, 15]]);
    }));
    return _createGroup.apply(this, arguments);
  }
  function refreshGroup(_x6) {
    return _refreshGroup.apply(this, arguments);
  }
  function _refreshGroup() {
    _refreshGroup = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee24(groupName) {
      var group;
      return _regeneratorRuntime().wrap(function _callee24$(_context24) {
        while (1) switch (_context24.prev = _context24.next) {
          case 0:
            _context24.prev = 0;
            _context24.next = 3;
            return keymaster.getGroup(groupName);
          case 3:
            group = _context24.sent;
            setSelectedGroup(group);
            setMemberDID('');
            setMemberDocs('');
            _context24.next = 12;
            break;
          case 9:
            _context24.prev = 9;
            _context24.t0 = _context24["catch"](0);
            window.alert(_context24.t0);
          case 12:
          case "end":
            return _context24.stop();
        }
      }, _callee24, null, [[0, 9]]);
    }));
    return _refreshGroup.apply(this, arguments);
  }
  function resolveMember(_x7) {
    return _resolveMember.apply(this, arguments);
  }
  function _resolveMember() {
    _resolveMember = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee25(did) {
      var docs;
      return _regeneratorRuntime().wrap(function _callee25$(_context25) {
        while (1) switch (_context25.prev = _context25.next) {
          case 0:
            _context25.prev = 0;
            _context25.next = 3;
            return keymaster.resolveDID(did);
          case 3:
            docs = _context25.sent;
            setMemberDocs(JSON.stringify(docs, null, 4));
            _context25.next = 10;
            break;
          case 7:
            _context25.prev = 7;
            _context25.t0 = _context25["catch"](0);
            window.alert(_context25.t0);
          case 10:
          case "end":
            return _context25.stop();
        }
      }, _callee25, null, [[0, 7]]);
    }));
    return _resolveMember.apply(this, arguments);
  }
  function addMember(_x8) {
    return _addMember.apply(this, arguments);
  }
  function _addMember() {
    _addMember = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee26(did) {
      return _regeneratorRuntime().wrap(function _callee26$(_context26) {
        while (1) switch (_context26.prev = _context26.next) {
          case 0:
            _context26.prev = 0;
            _context26.next = 3;
            return keymaster.groupAdd(selectedGroupName, did);
          case 3:
            refreshGroup(selectedGroupName);
            _context26.next = 9;
            break;
          case 6:
            _context26.prev = 6;
            _context26.t0 = _context26["catch"](0);
            window.alert(_context26.t0);
          case 9:
          case "end":
            return _context26.stop();
        }
      }, _callee26, null, [[0, 6]]);
    }));
    return _addMember.apply(this, arguments);
  }
  function removeMember(_x9) {
    return _removeMember.apply(this, arguments);
  }
  function _removeMember() {
    _removeMember = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee27(did) {
      return _regeneratorRuntime().wrap(function _callee27$(_context27) {
        while (1) switch (_context27.prev = _context27.next) {
          case 0:
            _context27.prev = 0;
            if (!window.confirm("Remove member from ".concat(selectedGroupName, "?"))) {
              _context27.next = 5;
              break;
            }
            _context27.next = 4;
            return keymaster.groupRemove(selectedGroupName, did);
          case 4:
            refreshGroup(selectedGroupName);
          case 5:
            _context27.next = 10;
            break;
          case 7:
            _context27.prev = 7;
            _context27.t0 = _context27["catch"](0);
            window.alert(_context27.t0);
          case 10:
          case "end":
            return _context27.stop();
        }
      }, _callee27, null, [[0, 7]]);
    }));
    return _removeMember.apply(this, arguments);
  }
  function createSchema() {
    return _createSchema.apply(this, arguments);
  }
  function _createSchema() {
    _createSchema = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee28() {
      var schemaDID;
      return _regeneratorRuntime().wrap(function _callee28$(_context28) {
        while (1) switch (_context28.prev = _context28.next) {
          case 0:
            _context28.prev = 0;
            if (!Object.keys(nameList).includes(schemaName)) {
              _context28.next = 4;
              break;
            }
            alert("".concat(schemaName, " already in use"));
            return _context28.abrupt("return");
          case 4:
            _context28.next = 6;
            return keymaster.createSchema(null, registry);
          case 6:
            schemaDID = _context28.sent;
            _context28.next = 9;
            return keymaster.addName(schemaName, schemaDID);
          case 9:
            setSchemaName('');
            refreshNames();
            setSelectedSchemaName(schemaName);
            editSchema(schemaName);
            _context28.next = 18;
            break;
          case 15:
            _context28.prev = 15;
            _context28.t0 = _context28["catch"](0);
            window.alert(_context28.t0);
          case 18:
          case "end":
            return _context28.stop();
        }
      }, _callee28, null, [[0, 15]]);
    }));
    return _createSchema.apply(this, arguments);
  }
  function editSchema(_x10) {
    return _editSchema.apply(this, arguments);
  }
  function _editSchema() {
    _editSchema = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee29(schemaName) {
      var schema;
      return _regeneratorRuntime().wrap(function _callee29$(_context29) {
        while (1) switch (_context29.prev = _context29.next) {
          case 0:
            _context29.prev = 0;
            _context29.next = 3;
            return keymaster.getSchema(schemaName);
          case 3:
            schema = _context29.sent;
            setSelectedSchema(schema);
            setEditedSchemaName(schemaName);
            setSchemaString(JSON.stringify(schema, null, 4));
            _context29.next = 12;
            break;
          case 9:
            _context29.prev = 9;
            _context29.t0 = _context29["catch"](0);
            window.alert(_context29.t0);
          case 12:
          case "end":
            return _context29.stop();
        }
      }, _callee29, null, [[0, 9]]);
    }));
    return _editSchema.apply(this, arguments);
  }
  function saveSchema() {
    return _saveSchema.apply(this, arguments);
  }
  function _saveSchema() {
    _saveSchema = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee30() {
      return _regeneratorRuntime().wrap(function _callee30$(_context30) {
        while (1) switch (_context30.prev = _context30.next) {
          case 0:
            _context30.prev = 0;
            _context30.next = 3;
            return keymaster.setSchema(editedSchemaName, JSON.parse(schemaString));
          case 3:
            _context30.next = 5;
            return editSchema(editedSchemaName);
          case 5:
            _context30.next = 10;
            break;
          case 7:
            _context30.prev = 7;
            _context30.t0 = _context30["catch"](0);
            window.alert(_context30.t0);
          case 10:
          case "end":
            return _context30.stop();
        }
      }, _callee30, null, [[0, 7]]);
    }));
    return _saveSchema.apply(this, arguments);
  }
  function editCredential() {
    return _editCredential.apply(this, arguments);
  }
  function _editCredential() {
    _editCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee31() {
      var credentialBound;
      return _regeneratorRuntime().wrap(function _callee31$(_context31) {
        while (1) switch (_context31.prev = _context31.next) {
          case 0:
            _context31.prev = 0;
            _context31.next = 3;
            return keymaster.bindCredential(credentialSchema, credentialSubject);
          case 3:
            credentialBound = _context31.sent;
            setCredentialString(JSON.stringify(credentialBound, null, 4));
            setCredentialDID('');
            _context31.next = 11;
            break;
          case 8:
            _context31.prev = 8;
            _context31.t0 = _context31["catch"](0);
            window.alert(_context31.t0);
          case 11:
          case "end":
            return _context31.stop();
        }
      }, _callee31, null, [[0, 8]]);
    }));
    return _editCredential.apply(this, arguments);
  }
  function issueCredential() {
    return _issueCredential.apply(this, arguments);
  }
  function _issueCredential() {
    _issueCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee32() {
      var did;
      return _regeneratorRuntime().wrap(function _callee32$(_context32) {
        while (1) switch (_context32.prev = _context32.next) {
          case 0:
            _context32.prev = 0;
            _context32.next = 3;
            return keymaster.issueCredential(JSON.parse(credentialString), registry);
          case 3:
            did = _context32.sent;
            setCredentialDID(did);
            // Add did to issuedList
            setIssuedList(function (prevIssuedList) {
              return [].concat(_toConsumableArray(prevIssuedList), [did]);
            });
            _context32.next = 11;
            break;
          case 8:
            _context32.prev = 8;
            _context32.t0 = _context32["catch"](0);
            window.alert(_context32.t0);
          case 11:
          case "end":
            return _context32.stop();
        }
      }, _callee32, null, [[0, 8]]);
    }));
    return _issueCredential.apply(this, arguments);
  }
  function refreshHeld() {
    return _refreshHeld.apply(this, arguments);
  }
  function _refreshHeld() {
    _refreshHeld = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee33() {
      var _heldList;
      return _regeneratorRuntime().wrap(function _callee33$(_context33) {
        while (1) switch (_context33.prev = _context33.next) {
          case 0:
            _context33.prev = 0;
            _context33.next = 3;
            return keymaster.listCredentials();
          case 3:
            _heldList = _context33.sent;
            setHeldList(_heldList);
            setHeldString('');
            _context33.next = 11;
            break;
          case 8:
            _context33.prev = 8;
            _context33.t0 = _context33["catch"](0);
            window.alert(_context33.t0);
          case 11:
          case "end":
            return _context33.stop();
        }
      }, _callee33, null, [[0, 8]]);
    }));
    return _refreshHeld.apply(this, arguments);
  }
  function refreshIssued() {
    return _refreshIssued.apply(this, arguments);
  }
  function _refreshIssued() {
    _refreshIssued = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee34() {
      var _issuedList;
      return _regeneratorRuntime().wrap(function _callee34$(_context34) {
        while (1) switch (_context34.prev = _context34.next) {
          case 0:
            _context34.prev = 0;
            _context34.next = 3;
            return keymaster.listIssued();
          case 3:
            _issuedList = _context34.sent;
            setIssuedList(_issuedList);
            setIssuedString('');
            _context34.next = 11;
            break;
          case 8:
            _context34.prev = 8;
            _context34.t0 = _context34["catch"](0);
            window.alert(_context34.t0);
          case 11:
          case "end":
            return _context34.stop();
        }
      }, _callee34, null, [[0, 8]]);
    }));
    return _refreshIssued.apply(this, arguments);
  }
  function acceptCredential() {
    return _acceptCredential.apply(this, arguments);
  }
  function _acceptCredential() {
    _acceptCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee35() {
      var ok;
      return _regeneratorRuntime().wrap(function _callee35$(_context35) {
        while (1) switch (_context35.prev = _context35.next) {
          case 0:
            _context35.prev = 0;
            _context35.next = 3;
            return keymaster.acceptCredential(heldDID);
          case 3:
            ok = _context35.sent;
            if (ok) {
              refreshHeld();
              setHeldDID('');
            } else {
              window.alert("Credential not accepted");
            }
            _context35.next = 10;
            break;
          case 7:
            _context35.prev = 7;
            _context35.t0 = _context35["catch"](0);
            window.alert(_context35.t0);
          case 10:
          case "end":
            return _context35.stop();
        }
      }, _callee35, null, [[0, 7]]);
    }));
    return _acceptCredential.apply(this, arguments);
  }
  function removeCredential(_x11) {
    return _removeCredential.apply(this, arguments);
  }
  function _removeCredential() {
    _removeCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee36(did) {
      return _regeneratorRuntime().wrap(function _callee36$(_context36) {
        while (1) switch (_context36.prev = _context36.next) {
          case 0:
            _context36.prev = 0;
            if (!window.confirm("Are you sure you want to remove ".concat(did, "?"))) {
              _context36.next = 5;
              break;
            }
            _context36.next = 4;
            return keymaster.removeCredential(did);
          case 4:
            refreshHeld();
          case 5:
            _context36.next = 10;
            break;
          case 7:
            _context36.prev = 7;
            _context36.t0 = _context36["catch"](0);
            window.alert(_context36.t0);
          case 10:
          case "end":
            return _context36.stop();
        }
      }, _callee36, null, [[0, 7]]);
    }));
    return _removeCredential.apply(this, arguments);
  }
  function resolveCredential(_x12) {
    return _resolveCredential.apply(this, arguments);
  }
  function _resolveCredential() {
    _resolveCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee37(did) {
      var doc;
      return _regeneratorRuntime().wrap(function _callee37$(_context37) {
        while (1) switch (_context37.prev = _context37.next) {
          case 0:
            _context37.prev = 0;
            _context37.next = 3;
            return keymaster.resolveDID(did);
          case 3:
            doc = _context37.sent;
            setSelectedHeld(did);
            setHeldString(JSON.stringify(doc, null, 4));
            _context37.next = 11;
            break;
          case 8:
            _context37.prev = 8;
            _context37.t0 = _context37["catch"](0);
            window.alert(_context37.t0);
          case 11:
          case "end":
            return _context37.stop();
        }
      }, _callee37, null, [[0, 8]]);
    }));
    return _resolveCredential.apply(this, arguments);
  }
  function decryptCredential(_x13) {
    return _decryptCredential.apply(this, arguments);
  }
  function _decryptCredential() {
    _decryptCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee38(did) {
      var doc;
      return _regeneratorRuntime().wrap(function _callee38$(_context38) {
        while (1) switch (_context38.prev = _context38.next) {
          case 0:
            _context38.prev = 0;
            _context38.next = 3;
            return keymaster.getCredential(did);
          case 3:
            doc = _context38.sent;
            setSelectedHeld(did);
            setHeldString(JSON.stringify(doc, null, 4));
            _context38.next = 11;
            break;
          case 8:
            _context38.prev = 8;
            _context38.t0 = _context38["catch"](0);
            window.alert(_context38.t0);
          case 11:
          case "end":
            return _context38.stop();
        }
      }, _callee38, null, [[0, 8]]);
    }));
    return _decryptCredential.apply(this, arguments);
  }
  function publishCredential(_x14) {
    return _publishCredential.apply(this, arguments);
  }
  function _publishCredential() {
    _publishCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee39(did) {
      return _regeneratorRuntime().wrap(function _callee39$(_context39) {
        while (1) switch (_context39.prev = _context39.next) {
          case 0:
            _context39.prev = 0;
            _context39.next = 3;
            return keymaster.publishCredential(did, false);
          case 3:
            resolveId();
            decryptCredential(did);
            _context39.next = 10;
            break;
          case 7:
            _context39.prev = 7;
            _context39.t0 = _context39["catch"](0);
            window.alert(_context39.t0);
          case 10:
          case "end":
            return _context39.stop();
        }
      }, _callee39, null, [[0, 7]]);
    }));
    return _publishCredential.apply(this, arguments);
  }
  function revealCredential(_x15) {
    return _revealCredential.apply(this, arguments);
  }
  function _revealCredential() {
    _revealCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee40(did) {
      return _regeneratorRuntime().wrap(function _callee40$(_context40) {
        while (1) switch (_context40.prev = _context40.next) {
          case 0:
            _context40.prev = 0;
            _context40.next = 3;
            return keymaster.publishCredential(did, true);
          case 3:
            resolveId();
            decryptCredential(did);
            _context40.next = 10;
            break;
          case 7:
            _context40.prev = 7;
            _context40.t0 = _context40["catch"](0);
            window.alert(_context40.t0);
          case 10:
          case "end":
            return _context40.stop();
        }
      }, _callee40, null, [[0, 7]]);
    }));
    return _revealCredential.apply(this, arguments);
  }
  function unpublishCredential(_x16) {
    return _unpublishCredential.apply(this, arguments);
  }
  function _unpublishCredential() {
    _unpublishCredential = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee41(did) {
      return _regeneratorRuntime().wrap(function _callee41$(_context41) {
        while (1) switch (_context41.prev = _context41.next) {
          case 0:
            _context41.prev = 0;
            _context41.next = 3;
            return keymaster.unpublishCredential(did);
          case 3:
            resolveId();
            decryptCredential(did);
            _context41.next = 10;
            break;
          case 7:
            _context41.prev = 7;
            _context41.t0 = _context41["catch"](0);
            window.alert(_context41.t0);
          case 10:
          case "end":
            return _context41.stop();
        }
      }, _callee41, null, [[0, 7]]);
    }));
    return _unpublishCredential.apply(this, arguments);
  }
  function credentialPublished(did) {
    if (!manifest) {
      return false;
    }
    if (!manifest[did]) {
      return false;
    }
    return manifest[did].credential === null;
  }
  function credentialRevealed(did) {
    if (!manifest) {
      return false;
    }
    if (!manifest[did]) {
      return false;
    }
    return manifest[did].credential !== null;
  }
  function credentialUnpublished(did) {
    if (!manifest) {
      return true;
    }
    return !manifest[did];
  }
  function resolveIssued(_x17) {
    return _resolveIssued.apply(this, arguments);
  }
  function _resolveIssued() {
    _resolveIssued = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee42(did) {
      var doc;
      return _regeneratorRuntime().wrap(function _callee42$(_context42) {
        while (1) switch (_context42.prev = _context42.next) {
          case 0:
            _context42.prev = 0;
            _context42.next = 3;
            return keymaster.resolveDID(did);
          case 3:
            doc = _context42.sent;
            setSelectedIssued(did);
            setIssuedString(JSON.stringify(doc, null, 4));
            _context42.next = 11;
            break;
          case 8:
            _context42.prev = 8;
            _context42.t0 = _context42["catch"](0);
            window.alert(_context42.t0);
          case 11:
          case "end":
            return _context42.stop();
        }
      }, _callee42, null, [[0, 8]]);
    }));
    return _resolveIssued.apply(this, arguments);
  }
  function decryptIssued(_x18) {
    return _decryptIssued.apply(this, arguments);
  }
  function _decryptIssued() {
    _decryptIssued = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee43(did) {
      var doc, issued;
      return _regeneratorRuntime().wrap(function _callee43$(_context43) {
        while (1) switch (_context43.prev = _context43.next) {
          case 0:
            _context43.prev = 0;
            _context43.next = 3;
            return keymaster.getCredential(did);
          case 3:
            doc = _context43.sent;
            setSelectedIssued(did);
            issued = JSON.stringify(doc, null, 4);
            setIssuedStringOriginal(issued);
            setIssuedString(issued);
            setIssuedEdit(true);
            _context43.next = 14;
            break;
          case 11:
            _context43.prev = 11;
            _context43.t0 = _context43["catch"](0);
            window.alert(_context43.t0);
          case 14:
          case "end":
            return _context43.stop();
        }
      }, _callee43, null, [[0, 11]]);
    }));
    return _decryptIssued.apply(this, arguments);
  }
  function updateIssued(_x19) {
    return _updateIssued.apply(this, arguments);
  }
  function _updateIssued() {
    _updateIssued = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee44(did) {
      var credential;
      return _regeneratorRuntime().wrap(function _callee44$(_context44) {
        while (1) switch (_context44.prev = _context44.next) {
          case 0:
            _context44.prev = 0;
            credential = JSON.parse(issuedString);
            _context44.next = 4;
            return keymaster.updateCredential(did, credential);
          case 4:
            decryptIssued(did);
            _context44.next = 10;
            break;
          case 7:
            _context44.prev = 7;
            _context44.t0 = _context44["catch"](0);
            window.alert(_context44.t0);
          case 10:
          case "end":
            return _context44.stop();
        }
      }, _callee44, null, [[0, 7]]);
    }));
    return _updateIssued.apply(this, arguments);
  }
  function revokeIssued(_x20) {
    return _revokeIssued.apply(this, arguments);
  }
  function _revokeIssued() {
    _revokeIssued = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee45(did) {
      var newIssuedList;
      return _regeneratorRuntime().wrap(function _callee45$(_context45) {
        while (1) switch (_context45.prev = _context45.next) {
          case 0:
            _context45.prev = 0;
            if (!window.confirm("Revoke credential?")) {
              _context45.next = 6;
              break;
            }
            _context45.next = 4;
            return keymaster.revokeCredential(did);
          case 4:
            // Remove did from issuedList
            newIssuedList = issuedList.filter(function (item) {
              return item !== did;
            });
            setIssuedList(newIssuedList);
          case 6:
            _context45.next = 11;
            break;
          case 8:
            _context45.prev = 8;
            _context45.t0 = _context45["catch"](0);
            window.alert(_context45.t0);
          case 11:
          case "end":
            return _context45.stop();
        }
      }, _callee45, null, [[0, 8]]);
    }));
    return _revokeIssued.apply(this, arguments);
  }
  function showMnemonic() {
    return _showMnemonic.apply(this, arguments);
  }
  function _showMnemonic() {
    _showMnemonic = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee46() {
      var _response3;
      return _regeneratorRuntime().wrap(function _callee46$(_context46) {
        while (1) switch (_context46.prev = _context46.next) {
          case 0:
            _context46.prev = 0;
            _context46.next = 3;
            return keymaster.decryptMnemonic();
          case 3:
            _response3 = _context46.sent;
            setMnemonicString(_response3);
            _context46.next = 10;
            break;
          case 7:
            _context46.prev = 7;
            _context46.t0 = _context46["catch"](0);
            window.alert(_context46.t0);
          case 10:
          case "end":
            return _context46.stop();
        }
      }, _callee46, null, [[0, 7]]);
    }));
    return _showMnemonic.apply(this, arguments);
  }
  function hideMnemonic() {
    return _hideMnemonic.apply(this, arguments);
  }
  function _hideMnemonic() {
    _hideMnemonic = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee47() {
      return _regeneratorRuntime().wrap(function _callee47$(_context47) {
        while (1) switch (_context47.prev = _context47.next) {
          case 0:
            setMnemonicString('');
          case 1:
          case "end":
            return _context47.stop();
        }
      }, _callee47);
    }));
    return _hideMnemonic.apply(this, arguments);
  }
  function newWallet() {
    return _newWallet.apply(this, arguments);
  }
  function _newWallet() {
    _newWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee48() {
      return _regeneratorRuntime().wrap(function _callee48$(_context48) {
        while (1) switch (_context48.prev = _context48.next) {
          case 0:
            _context48.prev = 0;
            if (!window.confirm("Overwrite wallet with new one?")) {
              _context48.next = 5;
              break;
            }
            _context48.next = 4;
            return keymaster.newWallet(null, true);
          case 4:
            refreshAll();
          case 5:
            _context48.next = 10;
            break;
          case 7:
            _context48.prev = 7;
            _context48.t0 = _context48["catch"](0);
            window.alert(_context48.t0);
          case 10:
          case "end":
            return _context48.stop();
        }
      }, _callee48, null, [[0, 7]]);
    }));
    return _newWallet.apply(this, arguments);
  }
  function importWallet() {
    return _importWallet.apply(this, arguments);
  }
  function _importWallet() {
    _importWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee49() {
      var mnenomic;
      return _regeneratorRuntime().wrap(function _callee49$(_context49) {
        while (1) switch (_context49.prev = _context49.next) {
          case 0:
            _context49.prev = 0;
            mnenomic = window.prompt("Overwrite wallet with mnemonic:");
            if (!mnenomic) {
              _context49.next = 8;
              break;
            }
            _context49.next = 5;
            return keymaster.newWallet(mnenomic, true);
          case 5:
            _context49.next = 7;
            return keymaster.recoverWallet();
          case 7:
            refreshAll();
          case 8:
            _context49.next = 13;
            break;
          case 10:
            _context49.prev = 10;
            _context49.t0 = _context49["catch"](0);
            window.alert(_context49.t0);
          case 13:
          case "end":
            return _context49.stop();
        }
      }, _callee49, null, [[0, 10]]);
    }));
    return _importWallet.apply(this, arguments);
  }
  function backupWallet() {
    return _backupWallet.apply(this, arguments);
  }
  function _backupWallet() {
    _backupWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee50() {
      return _regeneratorRuntime().wrap(function _callee50$(_context50) {
        while (1) switch (_context50.prev = _context50.next) {
          case 0:
            _context50.prev = 0;
            _context50.next = 3;
            return keymaster.backupWallet();
          case 3:
            window.alert('Wallet backup successful');
            _context50.next = 9;
            break;
          case 6:
            _context50.prev = 6;
            _context50.t0 = _context50["catch"](0);
            window.alert(_context50.t0);
          case 9:
          case "end":
            return _context50.stop();
        }
      }, _callee50, null, [[0, 6]]);
    }));
    return _backupWallet.apply(this, arguments);
  }
  function recoverWallet() {
    return _recoverWallet.apply(this, arguments);
  }
  function _recoverWallet() {
    _recoverWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee51() {
      return _regeneratorRuntime().wrap(function _callee51$(_context51) {
        while (1) switch (_context51.prev = _context51.next) {
          case 0:
            _context51.prev = 0;
            if (!window.confirm("Overwrite wallet from backup?")) {
              _context51.next = 5;
              break;
            }
            _context51.next = 4;
            return keymaster.recoverWallet();
          case 4:
            refreshAll();
          case 5:
            _context51.next = 10;
            break;
          case 7:
            _context51.prev = 7;
            _context51.t0 = _context51["catch"](0);
            window.alert(_context51.t0);
          case 10:
          case "end":
            return _context51.stop();
        }
      }, _callee51, null, [[0, 7]]);
    }));
    return _recoverWallet.apply(this, arguments);
  }
  function checkWallet() {
    return _checkWallet.apply(this, arguments);
  }
  function _checkWallet() {
    _checkWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee52() {
      var _yield$keymaster$chec, checked, invalid, deleted, _yield$keymaster$fixW, idsRemoved, ownedRemoved, heldRemoved, namesRemoved;
      return _regeneratorRuntime().wrap(function _callee52$(_context52) {
        while (1) switch (_context52.prev = _context52.next) {
          case 0:
            setCheckingWallet(true);
            _context52.prev = 1;
            _context52.next = 4;
            return keymaster.checkWallet();
          case 4:
            _yield$keymaster$chec = _context52.sent;
            checked = _yield$keymaster$chec.checked;
            invalid = _yield$keymaster$chec.invalid;
            deleted = _yield$keymaster$chec.deleted;
            if (!(invalid === 0 && deleted === 0)) {
              _context52.next = 12;
              break;
            }
            window.alert("".concat(checked, " DIDs checked, no problems found"));
            _context52.next = 22;
            break;
          case 12:
            if (!window.confirm("".concat(checked, " DIDs checked\n").concat(invalid, " invalid DIDs found\n").concat(deleted, " deleted DIDs found\n\nFix wallet?"))) {
              _context52.next = 22;
              break;
            }
            _context52.next = 15;
            return keymaster.fixWallet();
          case 15:
            _yield$keymaster$fixW = _context52.sent;
            idsRemoved = _yield$keymaster$fixW.idsRemoved;
            ownedRemoved = _yield$keymaster$fixW.ownedRemoved;
            heldRemoved = _yield$keymaster$fixW.heldRemoved;
            namesRemoved = _yield$keymaster$fixW.namesRemoved;
            window.alert("".concat(idsRemoved, " IDs removed\n").concat(ownedRemoved, " owned DIDs removed\n").concat(heldRemoved, " held DIDs removed\n").concat(namesRemoved, " names removed"));
            refreshAll();
          case 22:
            _context52.next = 27;
            break;
          case 24:
            _context52.prev = 24;
            _context52.t0 = _context52["catch"](1);
            window.alert(_context52.t0);
          case 27:
            setCheckingWallet(false);
          case 28:
          case "end":
            return _context52.stop();
        }
      }, _callee52, null, [[1, 24]]);
    }));
    return _checkWallet.apply(this, arguments);
  }
  function showWallet() {
    return _showWallet.apply(this, arguments);
  }
  function _showWallet() {
    _showWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee53() {
      var wallet;
      return _regeneratorRuntime().wrap(function _callee53$(_context53) {
        while (1) switch (_context53.prev = _context53.next) {
          case 0:
            _context53.prev = 0;
            _context53.next = 3;
            return keymaster.loadWallet();
          case 3:
            wallet = _context53.sent;
            setWalletString(JSON.stringify(wallet, null, 4));
            _context53.next = 10;
            break;
          case 7:
            _context53.prev = 7;
            _context53.t0 = _context53["catch"](0);
            window.alert(_context53.t0);
          case 10:
          case "end":
            return _context53.stop();
        }
      }, _callee53, null, [[0, 7]]);
    }));
    return _showWallet.apply(this, arguments);
  }
  function hideWallet() {
    return _hideWallet.apply(this, arguments);
  }
  function _hideWallet() {
    _hideWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee54() {
      return _regeneratorRuntime().wrap(function _callee54$(_context54) {
        while (1) switch (_context54.prev = _context54.next) {
          case 0:
            setWalletString('');
          case 1:
          case "end":
            return _context54.stop();
        }
      }, _callee54);
    }));
    return _hideWallet.apply(this, arguments);
  }
  function uploadWallet() {
    return _uploadWallet.apply(this, arguments);
  }
  function _uploadWallet() {
    _uploadWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee57() {
      var fileInput;
      return _regeneratorRuntime().wrap(function _callee57$(_context57) {
        while (1) switch (_context57.prev = _context57.next) {
          case 0:
            try {
              fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.accept = 'application/json';
              fileInput.onchange = /*#__PURE__*/function () {
                var _ref4 = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee56(event) {
                  var file, reader;
                  return _regeneratorRuntime().wrap(function _callee56$(_context56) {
                    while (1) switch (_context56.prev = _context56.next) {
                      case 0:
                        file = event.target.files[0];
                        reader = new FileReader();
                        reader.onload = /*#__PURE__*/function () {
                          var _ref5 = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee55(event) {
                            var walletUpload, wallet;
                            return _regeneratorRuntime().wrap(function _callee55$(_context55) {
                              while (1) switch (_context55.prev = _context55.next) {
                                case 0:
                                  walletUpload = event.target.result;
                                  wallet = JSON.parse(walletUpload);
                                  if (!window.confirm('Overwrite wallet with upload?')) {
                                    _context55.next = 6;
                                    break;
                                  }
                                  _context55.next = 5;
                                  return keymaster.saveWallet(wallet);
                                case 5:
                                  refreshAll();
                                case 6:
                                case "end":
                                  return _context55.stop();
                              }
                            }, _callee55);
                          }));
                          return function (_x22) {
                            return _ref5.apply(this, arguments);
                          };
                        }();
                        reader.onerror = function (error) {
                          window.alert(error);
                        };
                        reader.readAsText(file);
                      case 5:
                      case "end":
                        return _context56.stop();
                    }
                  }, _callee56);
                }));
                return function (_x21) {
                  return _ref4.apply(this, arguments);
                };
              }();
              fileInput.click();
            } catch (error) {
              window.alert(error);
            }
          case 1:
          case "end":
            return _context57.stop();
        }
      }, _callee57);
    }));
    return _uploadWallet.apply(this, arguments);
  }
  function downloadWallet() {
    return _downloadWallet.apply(this, arguments);
  }
  function _downloadWallet() {
    _downloadWallet = _asyncToGenerator( /*#__PURE__*/_regeneratorRuntime().mark(function _callee58() {
      var wallet, walletJSON, blob, url, link;
      return _regeneratorRuntime().wrap(function _callee58$(_context58) {
        while (1) switch (_context58.prev = _context58.next) {
          case 0:
            _context58.prev = 0;
            _context58.next = 3;
            return keymaster.loadWallet();
          case 3:
            wallet = _context58.sent;
            walletJSON = JSON.stringify(wallet, null, 4);
            blob = new Blob([walletJSON], {
              type: 'application/json'
            });
            url = URL.createObjectURL(blob);
            link = document.createElement('a');
            link.href = url;
            link.download = 'mdip-wallet.json';
            link.click();

            // The URL.revokeObjectURL() method releases an existing object URL which was previously created by calling URL.createObjectURL().
            URL.revokeObjectURL(url);
            _context58.next = 17;
            break;
          case 14:
            _context58.prev = 14;
            _context58.t0 = _context58["catch"](0);
            window.alert(_context58.t0);
          case 17:
          case "end":
            return _context58.stop();
        }
      }, _callee58, null, [[0, 14]]);
    }));
    return _downloadWallet.apply(this, arguments);
  }
  return /*#__PURE__*/_react["default"].createElement("div", {
    className: "App"
  }, /*#__PURE__*/_react["default"].createElement("header", {
    className: "App-header"
  }, /*#__PURE__*/_react["default"].createElement("h1", null, title), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
    style: {
      fontSize: '1.5em'
    }
  }, "ID:")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
    style: {
      fontSize: '1.5em',
      fontWeight: 'bold'
    }
  }, currentId)), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
    style: {
      fontSize: '1em',
      fontFamily: 'Courier'
    }
  }, currentDID))), /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Tabs, {
    value: tab,
    onChange: function onChange(event, newTab) {
      return setTab(newTab);
    },
    indicatorColor: "primary",
    textColor: "primary",
    variant: "scrollable",
    scrollButtons: "auto"
  }, currentId && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "identity",
    value: "identity",
    label: 'Identities'
  }), currentId && !widget && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "names",
    value: "names",
    label: 'DIDs'
  }), currentId && !widget && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "groups",
    value: "groups",
    label: 'Groups'
  }), currentId && !widget && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "schemas",
    value: "schemas",
    label: 'Schemas'
  }), currentId && !widget && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "credentials",
    value: "credentials",
    label: 'Credentials'
  }), currentId && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "auth",
    value: "auth",
    label: 'Auth'
  }), currentId && accessGranted && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "access",
    value: "access",
    label: 'Access'
  }), !currentId && /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "create",
    value: "create",
    label: 'Create ID'
  }), /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "wallet",
    value: "wallet",
    label: 'Wallet'
  }))), /*#__PURE__*/_react["default"].createElement(_material.Box, {
    style: {
      width: '90vw'
    }
  }, tab === 'identity' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: selectedId,
    fullWidth: true,
    onChange: function onChange(event) {
      return selectId(event.target.value);
    }
  }, idList.map(function (idname, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: idname,
      key: index
    }, idname);
  })))), /*#__PURE__*/_react["default"].createElement("p", null), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: showCreate
  }, "Create...")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: removeId
  }, "Remove...")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: backupId
  }, "Backup")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: recoverId
  }, "Recover..."))), /*#__PURE__*/_react["default"].createElement("p", null), !widget && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement("textarea", {
    value: docsString,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  }))), tab === 'names' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.TableContainer, {
    component: _material.Paper,
    style: {
      maxHeight: '300px',
      overflow: 'auto'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.Table, {
    style: {
      width: '800px'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TableBody, null, /*#__PURE__*/_react["default"].createElement(_material.TableRow, null, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "Name",
    style: {
      width: '200px'
    },
    value: aliasName,
    onChange: function onChange(e) {
      return setAliasName(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 20
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "DID",
    style: {
      width: '500px'
    },
    value: aliasDID,
    onChange: function onChange(e) {
      return setAliasDID(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 80
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return resolveName(aliasDID);
    },
    disabled: !aliasDID
  }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: addName,
    disabled: !aliasName || !aliasDID
  }, "Add"))), Object.entries(nameList).map(function (_ref2, index) {
    var _ref3 = _slicedToArray(_ref2, 2),
      name = _ref3[0],
      did = _ref3[1];
    return /*#__PURE__*/_react["default"].createElement(_material.TableRow, {
      key: index
    }, /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, name), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
      style: {
        fontSize: '.9em',
        fontFamily: 'Courier'
      }
    }, did)), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return resolveName(name);
      }
    }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return removeName(name);
      }
    }, "Remove")));
  })))), /*#__PURE__*/_react["default"].createElement("p", null, selectedName), /*#__PURE__*/_react["default"].createElement("textarea", {
    value: aliasDocs,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  })), tab === 'groups' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "Group Name",
    style: {
      width: '300px'
    },
    value: groupName,
    onChange: function onChange(e) {
      return setGroupName(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 30
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: createGroup,
    disabled: !groupName
  }, "Create Group")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: registry,
    fullWidth: true,
    onChange: function onChange(event) {
      return setRegistry(event.target.value);
    }
  }, registries.map(function (registry, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: registry,
      key: index
    }, registry);
  })))), groupList && /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: selectedGroupName,
    fullWidth: true,
    displayEmpty: true,
    onChange: function onChange(event) {
      return setSelectedGroupName(event.target.value);
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
    value: "",
    disabled: true
  }, "Select group"), groupList.map(function (name, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: name,
      key: index
    }, name);
  }))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return refreshGroup(selectedGroupName);
    },
    disabled: !selectedGroupName
  }, "Edit Group")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, selectedGroup && "Editing: ".concat(selectedGroup.name))), selectedGroup && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Table, {
    style: {
      width: '800px'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TableBody, null, /*#__PURE__*/_react["default"].createElement(_material.TableRow, null, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "DID",
    style: {
      width: '500px'
    },
    value: memberDID,
    onChange: function onChange(e) {
      return setMemberDID(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 80
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return resolveMember(memberDID);
    },
    disabled: !memberDID
  }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return addMember(memberDID);
    },
    disabled: !memberDID
  }, "Add"))), selectedGroup.members.map(function (did, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.TableRow, {
      key: index
    }, /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
      style: {
        fontSize: '.9em',
        fontFamily: 'Courier'
      }
    }, did)), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return resolveMember(did);
      }
    }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return removeMember(did);
      }
    }, "Remove")));
  }))), /*#__PURE__*/_react["default"].createElement("textarea", {
    value: memberDocs,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  }))), tab === 'schemas' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "Schema Name",
    style: {
      width: '300px'
    },
    value: schemaName,
    onChange: function onChange(e) {
      return setSchemaName(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 30
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: createSchema,
    disabled: !schemaName
  }, "Create Schema")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: registry,
    fullWidth: true,
    onChange: function onChange(event) {
      return setRegistry(event.target.value);
    }
  }, registries.map(function (registry, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: registry,
      key: index
    }, registry);
  })))), schemaList && /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: selectedSchemaName,
    fullWidth: true,
    displayEmpty: true,
    onChange: function onChange(event) {
      return setSelectedSchemaName(event.target.value);
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
    value: "",
    disabled: true
  }, "Select schema"), schemaList.map(function (name, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: name,
      key: index
    }, name);
  }))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return editSchema(selectedSchemaName);
    },
    disabled: !selectedSchemaName
  }, "Edit Schema"))), selectedSchema && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "column",
    spacing: 1
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement("p", null, "Editing: \"".concat(editedSchemaName, "\""))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement("textarea", {
    value: schemaString,
    onChange: function onChange(e) {
      return setSchemaString(e.target.value);
    },
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: saveSchema,
    disabled: !schemaString
  }, "Save Schema"))))), tab === 'credentials' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Tabs, {
    value: credentialTab,
    onChange: function onChange(event, newTab) {
      return setCredentialTab(newTab);
    },
    indicatorColor: "primary",
    textColor: "primary",
    variant: "scrollable",
    scrollButtons: "auto"
  }, /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "held",
    value: "held",
    label: 'Held'
  }), /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "issue",
    value: "issue",
    label: 'Issue'
  }), /*#__PURE__*/_react["default"].createElement(_material.Tab, {
    key: "issued",
    value: "issued",
    label: 'Issued'
  }))), credentialTab === 'held' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.TableContainer, {
    component: _material.Paper,
    style: {
      maxHeight: '300px',
      overflow: 'auto'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.Table, {
    style: {
      width: '800px'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TableBody, null, /*#__PURE__*/_react["default"].createElement(_material.TableRow, null, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "Credential DID",
    style: {
      width: '500px'
    },
    value: heldDID,
    onChange: function onChange(e) {
      return setHeldDID(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 80
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return resolveCredential(heldDID);
    },
    disabled: !heldDID
  }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return decryptCredential(heldDID);
    },
    disabled: !heldDID
  }, "Decrypt")), /*#__PURE__*/_react["default"].createElement(_material.TableCell, null, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: acceptCredential,
    disabled: !heldDID
  }, "Accept"))), heldList.map(function (did, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.TableRow, {
      key: index
    }, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
      colSpan: 6
    }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
      style: {
        fontSize: '1em',
        fontFamily: 'Courier'
      }
    }, did), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      container: true,
      direction: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      spacing: 3
    }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return resolveCredential(did);
      }
    }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return decryptCredential(did);
      }
    }, "Decrypt")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return removeCredential(did);
      },
      disabled: !credentialUnpublished(did)
    }, "Remove")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return publishCredential(did);
      },
      disabled: credentialPublished(did)
    }, "Publish")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return revealCredential(did);
      },
      disabled: credentialRevealed(did)
    }, "Reveal")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return unpublishCredential(did);
      },
      disabled: credentialUnpublished(did)
    }, "Unpublish")))));
  })))), /*#__PURE__*/_react["default"].createElement("p", null, selectedHeld), /*#__PURE__*/_react["default"].createElement("textarea", {
    value: heldString,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  })), credentialTab === 'issue' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: credentialSubject,
    fullWidth: true,
    displayEmpty: true,
    onChange: function onChange(event) {
      return setCredentialSubject(event.target.value);
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
    value: "",
    disabled: true
  }, "Select subject"), agentList.map(function (name, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: name,
      key: index
    }, name);
  }))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: credentialSchema,
    fullWidth: true,
    displayEmpty: true,
    onChange: function onChange(event) {
      return setCredentialSchema(event.target.value);
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
    value: "",
    disabled: true
  }, "Select schema"), schemaList.map(function (name, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: name,
      key: index
    }, name);
  }))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: editCredential,
    disabled: !credentialSubject || !credentialSchema
  }, "Edit Credential"))), credentialString && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "column",
    spacing: 1
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement("p", null, "Editing ".concat(credentialSchema, " credential for ").concat(credentialSubject))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement("textarea", {
    value: credentialString,
    onChange: function onChange(e) {
      return setCredentialString(e.target.value);
    },
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: issueCredential,
    disabled: !credentialString
  }, "Issue Credential")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: registry,
    fullWidth: true,
    onChange: function onChange(event) {
      return setRegistry(event.target.value);
    }
  }, registries.map(function (registry, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: registry,
      key: index
    }, registry);
  })))), credentialDID && /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
    style: {
      fontSize: '1em',
      fontFamily: 'Courier'
    }
  }, credentialDID))))), credentialTab === 'issued' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.TableContainer, {
    component: _material.Paper,
    style: {
      maxHeight: '300px',
      overflow: 'auto'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.Table, {
    style: {
      width: '800px'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TableBody, null, issuedList.map(function (did, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.TableRow, {
      key: index
    }, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
      colSpan: 6
    }, /*#__PURE__*/_react["default"].createElement(_material.Typography, {
      style: {
        fontSize: '1em',
        fontFamily: 'Courier'
      }
    }, did), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      container: true,
      direction: "row",
      justifyContent: "flex-start",
      alignItems: "center",
      spacing: 3
    }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return resolveIssued(did);
      }
    }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return decryptIssued(did);
      }
    }, "Decrypt")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return updateIssued(did);
      },
      disabled: did !== selectedIssued || !issuedEdit || issuedString === issuedStringOriginal
    }, "Update")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
      item: true
    }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
      variant: "contained",
      color: "primary",
      onClick: function onClick() {
        return revokeIssued(did);
      }
    }, "Revoke")))));
  })))), /*#__PURE__*/_react["default"].createElement("p", null, selectedIssued), issuedEdit ? /*#__PURE__*/_react["default"].createElement("textarea", {
    value: issuedString,
    onChange: function onChange(e) {
      return setIssuedString(e.target.value.trim());
    },
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  }) : /*#__PURE__*/_react["default"].createElement("textarea", {
    value: issuedString,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  }))), tab === 'create' && /*#__PURE__*/_react["default"].createElement(_material.Grid, null, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "Name",
    style: {
      width: '300px'
    },
    value: newName,
    onChange: function onChange(e) {
      return setNewName(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 30
    }
  })), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Select, {
    style: {
      width: '300px'
    },
    value: registry,
    fullWidth: true,
    onChange: function onChange(event) {
      return setRegistry(event.target.value);
    }
  }, registries.map(function (registry, index) {
    return /*#__PURE__*/_react["default"].createElement(_material.MenuItem, {
      value: registry,
      key: index
    }, registry);
  })))), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: createId,
    disabled: !newName
  }, "Create")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: cancelCreate,
    disabled: !saveId
  }, "Cancel")))), tab === 'auth' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement(_material.Table, {
    style: {
      width: '800px'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TableBody, null, /*#__PURE__*/_react["default"].createElement(_material.TableRow, null, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '20%'
    }
  }, "Challenge"), /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '80%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "",
    value: challenge,
    onChange: function onChange(e) {
      return setChallenge(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 85,
      style: {
        fontFamily: 'Courier',
        fontSize: '0.8em'
      }
    }
  }), /*#__PURE__*/_react["default"].createElement("br", null), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: newChallenge
  }, "New")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return resolveChallenge(challenge);
    },
    disabled: !challenge || challenge === authDID
  }, "Resolve")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: createResponse,
    disabled: !challenge
  }, "Respond")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: clearChallenge,
    disabled: !challenge
  }, "Clear"))))), /*#__PURE__*/_react["default"].createElement(_material.TableRow, null, /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '20%'
    }
  }, "Response"), /*#__PURE__*/_react["default"].createElement(_material.TableCell, {
    style: {
      width: '80%'
    }
  }, /*#__PURE__*/_react["default"].createElement(_material.TextField, {
    label: "",
    value: response,
    onChange: function onChange(e) {
      return setResponse(e.target.value.trim());
    },
    fullWidth: true,
    margin: "normal",
    inputProps: {
      maxLength: 85,
      style: {
        fontFamily: 'Courier',
        fontSize: '0.8em'
      }
    }
  }), /*#__PURE__*/_react["default"].createElement("br", null), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: function onClick() {
      return decryptResponse(response);
    },
    disabled: !response || response === authDID
  }, "Decrypt")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: verifyResponse,
    disabled: !response
  }, "Verify")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: sendResponse,
    disabled: disableSendResponse
  }, "Send")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: clearResponse,
    disabled: !response
  }, "Clear"))))))), /*#__PURE__*/_react["default"].createElement("p", null, authDID), /*#__PURE__*/_react["default"].createElement("textarea", {
    value: authString,
    readOnly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  })), tab === 'wallet' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement("p", null), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: newWallet
  }, "New...")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: importWallet
  }, "Import...")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: backupWallet
  }, "Backup")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: recoverWallet
  }, "Recover...")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: checkWallet,
    disabled: checkingWallet
  }, "Check..."))), /*#__PURE__*/_react["default"].createElement("p", null), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    container: true,
    direction: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    spacing: 3
  }, /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, mnemonicString ? /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: hideMnemonic
  }, "Hide Mnemonic") : /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: showMnemonic
  }, "Show Mnemonic")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, walletString ? /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: hideWallet
  }, "Hide Wallet") : /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: showWallet
  }, "Show Wallet")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: downloadWallet
  }, "Download")), /*#__PURE__*/_react["default"].createElement(_material.Grid, {
    item: true
  }, /*#__PURE__*/_react["default"].createElement(_material.Button, {
    variant: "contained",
    color: "primary",
    onClick: uploadWallet
  }, "Upload..."))), /*#__PURE__*/_react["default"].createElement("p", null), /*#__PURE__*/_react["default"].createElement(_material.Box, null, /*#__PURE__*/_react["default"].createElement("pre", null, mnemonicString)), /*#__PURE__*/_react["default"].createElement(_material.Box, null, walletString && /*#__PURE__*/_react["default"].createElement("textarea", {
    value: walletString,
    readonly: true,
    style: {
      width: '800px',
      height: '600px',
      overflow: 'auto'
    }
  }))), tab === 'access' && /*#__PURE__*/_react["default"].createElement(_material.Box, null, "Special Access"))));
}
var _default = exports["default"] = KeymasterUI;
"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return $externalize(fn(this, new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))), $emptyInterface); }; };

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $substring = function(str, low, high) {
  if (low < 0 || high < low || high > str.length) {
    $throwRuntimeError("slice bounds out of range");
  }
  return str.substring(low, high);
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, named, pkg, exported, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", false, function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, false, "", exported, constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(pkgPath, fields) {
      typ.pkgPath = pkgPath;
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.name === "") {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.named = named;
  typ.pkg = pkg;
  typ.exported = exported;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if (e.typ.named) {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.name === "") {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           true, "", false, null);
var $Int           = $newType( 4, $kindInt,           "int",            true, "", false, null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           true, "", false, null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          true, "", false, null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          true, "", false, null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          true, "", false, null);
var $Uint          = $newType( 4, $kindUint,          "uint",           true, "", false, null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          true, "", false, null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         true, "", false, null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         true, "", false, null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         true, "", false, null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        true, "", false, null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        true, "", false, null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        true, "", false, null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      true, "", false, null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     true, "", false, null);
var $String        = $newType( 8, $kindString,        "string",         true, "", false, null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", true, "", false, null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, false, "", false, null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, false, "", false, null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, false, "", false, null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, false, "", false, null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", true, "", false, null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, false, "", false, null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, false, "", elem.exported, null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, false, "", false, null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(pkgPath, fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, false, "", false, function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(pkgPath, fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $dummyGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [], canBlock: false };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $goroutine.canBlock = true;
  $schedule($goroutine, direct);
};

var $scheduled = [], $schedulerActive = false;
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
    $schedulerActive = false;
  } finally {
    if ($schedulerActive) {
      setTimeout($runScheduled, 0);
    }
  }
};
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerActive) {
    $schedulerActive = true;
    setTimeout($runScheduled, 0);
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if (!$curGoroutine.canBlock) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  var closedDuringSend;
  chan.$sendQueue.push(function(closed) {
    closedDuringSend = closed;
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (closedDuringSend) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend(false));
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(true); /* will panic */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (!f.exported) {
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var canBlock = $curGoroutine.canBlock;
      $curGoroutine.canBlock = false;
      try {
        var result = v.apply(passThis ? this : undefined, args);
      } finally {
        $curGoroutine.canBlock = canBlock;
      }
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, MakeFunc, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", true, "github.com/gopherjs/gopherjs/js", true, function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", true, "github.com/gopherjs/gopherjs/js", true, function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var $ptr, key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var $ptr, key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var $ptr, key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var $ptr, i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var $ptr, i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var $ptr, args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var $ptr, args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var $ptr, args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var $ptr, o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var $ptr, o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var $ptr, o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	MakeFunc = function(fn) {
		var $ptr, fn;
		return $makeFunc(fn);
	};
	$pkg.MakeFunc = MakeFunc;
	init = function() {
		var $ptr, e;
		e = new Error.ptr(null);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init("github.com/gopherjs/gopherjs/js", [{prop: "object", name: "object", exported: false, typ: ptrType, tag: ""}]);
	Error.init("", [{prop: "Object", name: "", exported: true, typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$3, init, Goexit, SetFinalizer;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", true, "runtime", true, function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", true, "runtime", false, null);
	ptrType$3 = $ptrType(TypeAssertionError);
	init = function() {
		var $ptr, e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = (function(msg) {
			var $ptr, msg;
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
	};
	Goexit = function() {
		var $ptr;
		$curGoroutine.exit = $externalize(true, $Bool);
		$throw(null);
	};
	$pkg.Goexit = Goexit;
	SetFinalizer = function(x, f) {
		var $ptr, f, x;
	};
	$pkg.SetFinalizer = SetFinalizer;
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
		var $ptr;
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var $ptr, e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var $ptr, e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var $ptr, e;
		e = this.$val;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$3.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init("runtime", [{prop: "interfaceString", name: "interfaceString", exported: false, typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", exported: false, typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", exported: false, typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", true, "errors", false, function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var $ptr, text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init("errors", [{prop: "s", name: "s", exported: false, typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release, ReleaseMerge, Disable, Enable, ReadRange, WriteRange;
	Acquire = function(addr) {
		var $ptr, addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var $ptr, addr;
	};
	$pkg.Release = Release;
	ReleaseMerge = function(addr) {
		var $ptr, addr;
	};
	$pkg.ReleaseMerge = ReleaseMerge;
	Disable = function() {
		var $ptr;
	};
	$pkg.Disable = Disable;
	Enable = function() {
		var $ptr;
	};
	$pkg.Enable = Enable;
	ReadRange = function(addr, len) {
		var $ptr, addr, len;
	};
	$pkg.ReadRange = ReadRange;
	WriteRange = function(addr, len) {
		var $ptr, addr, len;
	};
	$pkg.WriteRange = WriteRange;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadUint32, StoreUint32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var $ptr, addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var $ptr, addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadUint32 = function(addr) {
		var $ptr, addr;
		return addr.$get();
	};
	$pkg.LoadUint32 = LoadUint32;
	StoreUint32 = function(addr, val) {
		var $ptr, addr, val;
		addr.$set(val);
	};
	$pkg.StoreUint32 = StoreUint32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, race, runtime, atomic, Pool, Mutex, Locker, Once, poolLocal, notifyList, RWMutex, rlocker, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$3, ptrType$5, sliceType$3, ptrType$6, ptrType$7, funcType, ptrType$13, funcType$1, ptrType$14, arrayType$1, semWaiters, allPools, runtime_registerPoolCleanup, runtime_Semacquire, runtime_Semrelease, runtime_notifyListCheck, runtime_canSpin, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", true, "sync", true, function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$3.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", true, "sync", true, function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Locker = $pkg.Locker = $newType(8, $kindInterface, "sync.Locker", true, "sync", true, null);
	Once = $pkg.Once = $newType(0, $kindStruct, "sync.Once", true, "sync", true, function(m_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = new Mutex.ptr(0, 0);
			this.done = 0;
			return;
		}
		this.m = m_;
		this.done = done_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", true, "sync", false, function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$3.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			this.pad = arrayType$1.zero();
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
		this.pad = pad_;
	});
	notifyList = $pkg.notifyList = $newType(0, $kindStruct, "sync.notifyList", true, "sync", false, function(wait_, notify_, lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.wait = 0;
			this.notify = 0;
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.wait = wait_;
		this.notify = notify_;
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	RWMutex = $pkg.RWMutex = $newType(0, $kindStruct, "sync.RWMutex", true, "sync", true, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	rlocker = $pkg.rlocker = $newType(0, $kindStruct, "sync.rlocker", true, "sync", false, function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$3 = $ptrType($Int32);
	ptrType$5 = $ptrType(poolLocal);
	sliceType$3 = $sliceType($emptyInterface);
	ptrType$6 = $ptrType(rlocker);
	ptrType$7 = $ptrType(RWMutex);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$13 = $ptrType(Mutex);
	funcType$1 = $funcType([], [], false);
	ptrType$14 = $ptrType(Once);
	arrayType$1 = $arrayType($Uint8, 128);
	Pool.ptr.prototype.Get = function() {
		var $ptr, _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } */ case 4:
			$s = -1; return $ifaceNil;
			return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		$s = -1; return x$2;
		return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var $ptr, p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var $ptr, cleanup;
	};
	runtime_Semacquire = function(s) {
		var $ptr, _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s) {
		var $ptr, _entry, _key, ch, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; ch = $f.ch; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			$s = -1; return;
			return;
		}
		ch = (0 >= w.$length ? $throwRuntimeError("index out of range") : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_notifyListCheck = function(size) {
		var $ptr, size;
	};
	runtime_canSpin = function(i) {
		var $ptr, i;
		return false;
	};
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, awoke, iter, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; awoke = $f.awoke; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire(m);
			}
			$s = -1; return;
			return;
		}
		awoke = false;
		iter = 0;
		/* while (true) { */ case 1:
			old = m.state;
			new$1 = old | 1;
			/* */ if (!(((old & 1) === 0))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(((old & 1) === 0))) { */ case 3:
				if (runtime_canSpin(iter)) {
					if (!awoke && ((old & 2) === 0) && !(((old >> 2 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
						awoke = true;
					}
					runtime_doSpin();
					iter = iter + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
				new$1 = old + 4 >> 0;
			/* } */ case 4:
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 1) === 0) {
					/* break; */ $s = 2; continue;
				}
				$r = runtime_Semacquire((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				awoke = true;
				iter = 0;
			/* } */ case 6:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire(m);
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.awoke = awoke; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			race.Release(m);
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		/* while (true) { */ case 1:
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				$s = -1; return;
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$3(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 3:
				$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } */ case 4:
			old = m.state;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = this;
		if (atomic.LoadUint32((o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o)))) === 1) {
			$s = -1; return;
			return;
		}
		$r = o.m.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(o.m, "Unlock"), []]);
		/* */ if (o.done === 0) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (o.done === 0) { */ case 2:
			$deferred.push([atomic.StoreUint32, [(o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o))), 1]]);
			$r = f(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$s = -1; return;
		return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	poolCleanup = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < (p.localSize >> 0))) { break; }
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.shared, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.shared = sliceType$3.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		var $ptr;
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var $ptr, i, l, x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	init$1 = function() {
		var $ptr, n;
		n = new notifyList.ptr(0, 0, 0, 0, 0);
		runtime_notifyListCheck(20);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	RWMutex.ptr.prototype.RLock = function() {
		var $ptr, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		/* */ if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { */ case 1:
			$r = runtime_Semacquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RLock }; } $f.$ptr = $ptr; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RLock = function() { return this.$val.RLock(); };
	RWMutex.ptr.prototype.RUnlock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.ReleaseMerge((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1);
		/* */ if (r < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (r < 0) { */ case 1:
			if (((r + 1 >> 0) === 0) || ((r + 1 >> 0) === -1073741824)) {
				race.Enable();
				$panic(new $String("sync: RUnlock of unlocked RWMutex"));
			}
			/* */ if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { */ case 3:
				$r = runtime_Semrelease((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RUnlock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RUnlock = function() { return this.$val.RUnlock(); };
	RWMutex.ptr.prototype.Lock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		$r = rw.w.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1073741824) + 1073741824 >> 0;
		/* */ if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$3(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { */ case 2:
			$r = runtime_Semacquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Acquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Lock = function() { return this.$val.Lock(); };
	RWMutex.ptr.prototype.Unlock = function() {
		var $ptr, i, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; i = $f.i; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Release((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Release((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$3(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1073741824);
		if (r >= 1073741824) {
			race.Enable();
			$panic(new $String("sync: Unlock of unlocked RWMutex"));
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (r >> 0))) { break; } */ if(!(i < (r >> 0))) { $s = 2; continue; }
			$r = runtime_Semrelease((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$r = rw.w.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (false) {
			race.Enable();
		}
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.i = i; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	RWMutex.ptr.prototype.RLocker = function() {
		var $ptr, rw;
		rw = this;
		return $pointerOfStructConversion(rw, ptrType$6);
	};
	RWMutex.prototype.RLocker = function() { return this.$val.RLocker(); };
	rlocker.ptr.prototype.Lock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$7).RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Lock = function() { return this.$val.Lock(); };
	rlocker.ptr.prototype.Unlock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$7).RUnlock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$5], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$5], false)}];
	ptrType$13.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$14.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$1], [], false)}];
	ptrType$7.methods = [{prop: "RLock", name: "RLock", pkg: "", typ: $funcType([], [], false)}, {prop: "RUnlock", name: "RUnlock", pkg: "", typ: $funcType([], [], false)}, {prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}, {prop: "RLocker", name: "RLocker", pkg: "", typ: $funcType([], [Locker], false)}];
	ptrType$6.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init("sync", [{prop: "local", name: "local", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", exported: false, typ: $Uintptr, tag: ""}, {prop: "store", name: "store", exported: false, typ: sliceType$3, tag: ""}, {prop: "New", name: "New", exported: true, typ: funcType, tag: ""}]);
	Mutex.init("sync", [{prop: "state", name: "state", exported: false, typ: $Int32, tag: ""}, {prop: "sema", name: "sema", exported: false, typ: $Uint32, tag: ""}]);
	Locker.init([{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}]);
	Once.init("sync", [{prop: "m", name: "m", exported: false, typ: Mutex, tag: ""}, {prop: "done", name: "done", exported: false, typ: $Uint32, tag: ""}]);
	poolLocal.init("sync", [{prop: "private$0", name: "private", exported: false, typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", exported: false, typ: sliceType$3, tag: ""}, {prop: "Mutex", name: "", exported: true, typ: Mutex, tag: ""}, {prop: "pad", name: "pad", exported: false, typ: arrayType$1, tag: ""}]);
	notifyList.init("sync", [{prop: "wait", name: "wait", exported: false, typ: $Uint32, tag: ""}, {prop: "notify", name: "notify", exported: false, typ: $Uint32, tag: ""}, {prop: "lock", name: "lock", exported: false, typ: $Uintptr, tag: ""}, {prop: "head", name: "head", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", exported: false, typ: $UnsafePointer, tag: ""}]);
	RWMutex.init("sync", [{prop: "w", name: "w", exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", exported: false, typ: $Int32, tag: ""}]);
	rlocker.init("sync", [{prop: "w", name: "w", exported: false, typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", exported: false, typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", exported: false, typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", exported: false, typ: $Int32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = race.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, RuneScanner, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	RuneScanner = $pkg.RuneScanner = $newType(8, $kindInterface, "io.RuneScanner", true, "io", true, null);
	RuneScanner.init([{prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["hash"] = (function() {
	var $pkg = {}, $init, io, Hash, sliceType;
	io = $packages["io"];
	Hash = $pkg.Hash = $newType(8, $kindInterface, "hash.Hash", true, "hash", true, null);
	sliceType = $sliceType($Uint8);
	Hash.init([{prop: "BlockSize", name: "BlockSize", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Sum", name: "Sum", pkg: "", typ: $funcType([sliceType], [sliceType], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = io.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, arrayType$3, math, zero, posInf, negInf, nan, buf, pow10tab, Ceil, Exp, Floor, Inf, IsInf, IsNaN, Log, Max, Min, NaN, Pow, Signbit, Sqrt, init, max, min, init$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType("math", [{prop: "uint32array", name: "uint32array", exported: false, typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", exported: false, typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", exported: false, typ: arrayType$2, tag: ""}]);
	arrayType$3 = $arrayType($Float64, 70);
	Ceil = function(x) {
		var $ptr, x;
		return $parseFloat(math.ceil(x));
	};
	$pkg.Ceil = Ceil;
	Exp = function(x) {
		var $ptr, x;
		return $parseFloat(math.exp(x));
	};
	$pkg.Exp = Exp;
	Floor = function(x) {
		var $ptr, x;
		return $parseFloat(math.floor(x));
	};
	$pkg.Floor = Floor;
	Inf = function(sign) {
		var $ptr, sign;
		if (sign >= 0) {
			return posInf;
		} else {
			return negInf;
		}
	};
	$pkg.Inf = Inf;
	IsInf = function(f, sign) {
		var $ptr, f, sign;
		if (f === posInf) {
			return sign >= 0;
		}
		if (f === negInf) {
			return sign <= 0;
		}
		return false;
	};
	$pkg.IsInf = IsInf;
	IsNaN = function(f) {
		var $ptr, f, is;
		is = false;
		is = !((f === f));
		return is;
	};
	$pkg.IsNaN = IsNaN;
	Log = function(x) {
		var $ptr, x;
		if (!((x === x))) {
			return nan;
		}
		return $parseFloat(math.log(x));
	};
	$pkg.Log = Log;
	Max = function(x, y) {
		var $ptr, x, y;
		return max(x, y);
	};
	$pkg.Max = Max;
	Min = function(x, y) {
		var $ptr, x, y;
		return min(x, y);
	};
	$pkg.Min = Min;
	NaN = function() {
		var $ptr;
		return nan;
	};
	$pkg.NaN = NaN;
	Pow = function(x, y) {
		var $ptr, x, y;
		if ((x === 1) || ((x === -1) && ((y === posInf) || (y === negInf)))) {
			return 1;
		}
		return $parseFloat(math.pow(x, y));
	};
	$pkg.Pow = Pow;
	Signbit = function(x) {
		var $ptr, x;
		return x < 0 || (1 / x === negInf);
	};
	$pkg.Signbit = Signbit;
	Sqrt = function(x) {
		var $ptr, x;
		return $parseFloat(math.sqrt(x));
	};
	$pkg.Sqrt = Sqrt;
	init = function() {
		var $ptr, ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	max = function(x, y) {
		var $ptr, x, y;
		if (IsInf(x, 1) || IsInf(y, 1)) {
			return Inf(1);
		} else if (IsNaN(x) || IsNaN(y)) {
			return NaN();
		} else if ((x === 0) && (x === y)) {
			if (Signbit(x)) {
				return y;
			}
			return x;
		}
		if (x > y) {
			return x;
		}
		return y;
	};
	min = function(x, y) {
		var $ptr, x, y;
		if (IsInf(x, -1) || IsInf(y, -1)) {
			return Inf(-1);
		} else if (IsNaN(x) || IsNaN(y)) {
			return NaN();
		} else if ((x === 0) && (x === y)) {
			if (Signbit(x)) {
				return x;
			}
			return y;
		}
		if (x < y) {
			return x;
		}
		return y;
	};
	init$1 = function() {
		var $ptr, _q, i, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (true) {
			if (!(i < 70)) { break; }
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x])));
			i = i + (1) >> 0;
		}
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		pow10tab = arrayType$3.zero();
		math = $global.Math;
		zero = 0;
		posInf = 1 / zero;
		negInf = -1 / zero;
		nan = 0 / zero;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRuneInString, EncodeRune;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", true, "unicode/utf8", false, function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? $throwRuntimeError("index out of range") : first[s0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((s.charCodeAt(0) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((s0 & 31) >>> 0) >> 0) << 6 >> 0) | (((s1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((s0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((s0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((s2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	EncodeRune = function(p, r) {
		var $ptr, i, p, r;
		i = (r >>> 0);
		if (i <= 127) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24));
			return 1;
		} else if (i <= 2047) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	acceptRange.init("unicode/utf8", [{prop: "lo", name: "lo", exported: false, typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", exported: false, typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, sliceType$6, arrayType$3, arrayType$4, shifts, FormatInt, Itoa, formatBits, unhex, UnquoteChar, Unquote, contains;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	sliceType$6 = $sliceType($Uint8);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	FormatInt = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, new $Uint64(i.$high, i.$low), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var $ptr, i;
		return FormatInt(new $Int64(0, i), 10);
	};
	$pkg.Itoa = Itoa;
	formatBits = function(dst, u, base, neg, append_) {
		var $ptr, _q, _q$1, a, append_, b, b$1, base, d, dst, i, j, m, neg, q, q$1, q$2, qs, s, s$1, u, us, us$1, x, x$1;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low > 4294967295)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = ((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0);
					j = 9;
					while (true) {
						if (!(j > 0)) { break; }
						i = i - (1) >> 0;
						qs = (_q = us / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us - ($imul(qs, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
						us = qs;
						j = j - (1) >> 0;
					}
					u = q;
				}
			}
			us$1 = (u.$low >>> 0);
			while (true) {
				if (!(us$1 >= 10)) { break; }
				i = i - (1) >> 0;
				q$1 = (_q$1 = us$1 / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us$1 - ($imul(q$1, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
				us$1 = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = ((us$1 + 48 >>> 0) << 24 >>> 24));
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? $throwRuntimeError("index out of range") : shifts[base]);
			if (s$1 > 0) {
				b = new $Uint64(0, base);
				m = (b.$low >>> 0) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((u.$low >>> 0) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			} else {
				b$1 = new $Uint64(0, base);
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$2 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((x$1 = $mul64(q$2, b$1), new $Uint64(u.$high - x$1.$high, u.$low - x$1.$low)).$low >>> 0)));
					u = q$2;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = $bytesToString($subslice(new sliceType$6(a), i));
		return [d, s];
	};
	unhex = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, c, ok, v;
		v = 0;
		ok = false;
		c = (b >> 0);
		if (48 <= c && c <= 57) {
			_tmp = c - 48 >> 0;
			_tmp$1 = true;
			v = _tmp;
			ok = _tmp$1;
			return [v, ok];
		} else if (97 <= c && c <= 102) {
			_tmp$2 = (c - 97 >> 0) + 10 >> 0;
			_tmp$3 = true;
			v = _tmp$2;
			ok = _tmp$3;
			return [v, ok];
		} else if (65 <= c && c <= 70) {
			_tmp$4 = (c - 65 >> 0) + 10 >> 0;
			_tmp$5 = true;
			v = _tmp$4;
			ok = _tmp$5;
			return [v, ok];
		}
		return [v, ok];
	};
	UnquoteChar = function(s, quote) {
		var $ptr, _1, _2, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, c, c$1, err, j, j$1, multibyte, n, ok, quote, r, s, size, tail, v, v$1, value, x, x$1;
		value = 0;
		multibyte = false;
		tail = "";
		err = $ifaceNil;
		c = s.charCodeAt(0);
		if ((c === quote) && ((quote === 39) || (quote === 34))) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		} else if (c >= 128) {
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			size = _tuple[1];
			_tmp = r;
			_tmp$1 = true;
			_tmp$2 = $substring(s, size);
			_tmp$3 = $ifaceNil;
			value = _tmp;
			multibyte = _tmp$1;
			tail = _tmp$2;
			err = _tmp$3;
			return [value, multibyte, tail, err];
		} else if (!((c === 92))) {
			_tmp$4 = (s.charCodeAt(0) >> 0);
			_tmp$5 = false;
			_tmp$6 = $substring(s, 1);
			_tmp$7 = $ifaceNil;
			value = _tmp$4;
			multibyte = _tmp$5;
			tail = _tmp$6;
			err = _tmp$7;
			return [value, multibyte, tail, err];
		}
		if (s.length <= 1) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		}
		c$1 = s.charCodeAt(1);
		s = $substring(s, 2);
		switch (0) { default:
			_1 = c$1;
			if (_1 === (97)) {
				value = 7;
			} else if (_1 === (98)) {
				value = 8;
			} else if (_1 === (102)) {
				value = 12;
			} else if (_1 === (110)) {
				value = 10;
			} else if (_1 === (114)) {
				value = 13;
			} else if (_1 === (116)) {
				value = 9;
			} else if (_1 === (118)) {
				value = 11;
			} else if ((_1 === (120)) || (_1 === (117)) || (_1 === (85))) {
				n = 0;
				_2 = c$1;
				if (_2 === (120)) {
					n = 2;
				} else if (_2 === (117)) {
					n = 4;
				} else if (_2 === (85)) {
					n = 8;
				}
				v = 0;
				if (s.length < n) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j = 0;
				while (true) {
					if (!(j < n)) { break; }
					_tuple$1 = unhex(s.charCodeAt(j));
					x = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v = (v << 4 >> 0) | x;
					j = j + (1) >> 0;
				}
				s = $substring(s, n);
				if (c$1 === 120) {
					value = v;
					break;
				}
				if (v > 1114111) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v;
				multibyte = true;
			} else if ((_1 === (48)) || (_1 === (49)) || (_1 === (50)) || (_1 === (51)) || (_1 === (52)) || (_1 === (53)) || (_1 === (54)) || (_1 === (55))) {
				v$1 = (c$1 >> 0) - 48 >> 0;
				if (s.length < 2) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j$1 = 0;
				while (true) {
					if (!(j$1 < 2)) { break; }
					x$1 = (s.charCodeAt(j$1) >> 0) - 48 >> 0;
					if (x$1 < 0 || x$1 > 7) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v$1 = ((v$1 << 3 >> 0)) | x$1;
					j$1 = j$1 + (1) >> 0;
				}
				s = $substring(s, 2);
				if (v$1 > 255) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v$1;
			} else if (_1 === (92)) {
				value = 92;
			} else if ((_1 === (39)) || (_1 === (34))) {
				if (!((c$1 === quote))) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = (c$1 >> 0);
			} else {
				err = $pkg.ErrSyntax;
				return [value, multibyte, tail, err];
			}
		}
		tail = s;
		return [value, multibyte, tail, err];
	};
	$pkg.UnquoteChar = UnquoteChar;
	Unquote = function(s) {
		var $ptr, _1, _q, _tuple, _tuple$1, buf, c, err, multibyte, n, n$1, quote, r, runeTmp, s, size, ss;
		n = s.length;
		if (n < 2) {
			return ["", $pkg.ErrSyntax];
		}
		quote = s.charCodeAt(0);
		if (!((quote === s.charCodeAt((n - 1 >> 0))))) {
			return ["", $pkg.ErrSyntax];
		}
		s = $substring(s, 1, (n - 1 >> 0));
		if (quote === 96) {
			if (contains(s, 96)) {
				return ["", $pkg.ErrSyntax];
			}
			return [s, $ifaceNil];
		}
		if (!((quote === 34)) && !((quote === 39))) {
			return ["", $pkg.ErrSyntax];
		}
		if (contains(s, 10)) {
			return ["", $pkg.ErrSyntax];
		}
		if (!contains(s, 92) && !contains(s, quote)) {
			_1 = quote;
			if (_1 === (34)) {
				return [s, $ifaceNil];
			} else if (_1 === (39)) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				size = _tuple[1];
				if ((size === s.length) && (!((r === 65533)) || !((size === 1)))) {
					return [s, $ifaceNil];
				}
			}
		}
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple$1 = UnquoteChar(s, quote);
			c = _tuple$1[0];
			multibyte = _tuple$1[1];
			ss = _tuple$1[2];
			err = _tuple$1[3];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return ["", err];
			}
			s = ss;
			if (c < 128 || !multibyte) {
				buf = $append(buf, (c << 24 >>> 24));
			} else {
				n$1 = utf8.EncodeRune(new sliceType$6(runeTmp), c);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n$1));
			}
			if ((quote === 39) && !((s.length === 0))) {
				return ["", $pkg.ErrSyntax];
			}
		}
		return [$bytesToString(buf), $ifaceNil];
	};
	$pkg.Unquote = Unquote;
	contains = function(s, c) {
		var $ptr, c, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === c) {
				return true;
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["crypto"] = (function() {
	var $pkg = {}, $init, hash, io, strconv, funcType, sliceType$1, hashes, RegisterHash;
	hash = $packages["hash"];
	io = $packages["io"];
	strconv = $packages["strconv"];
	funcType = $funcType([], [hash.Hash], false);
	sliceType$1 = $sliceType(funcType);
	RegisterHash = function(h, f) {
		var $ptr, f, h;
		if (h >= 16) {
			$panic(new $String("crypto: RegisterHash of unknown hash function"));
		}
		((h < 0 || h >= hashes.$length) ? $throwRuntimeError("index out of range") : hashes.$array[hashes.$offset + h] = f);
	};
	$pkg.RegisterHash = RegisterHash;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = hash.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		hashes = $makeSlice(sliceType$1, 16);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["crypto/md5"] = (function() {
	var $pkg = {}, $init, crypto, hash, runtime, digest, arrayType, arrayType$1, sliceType, arrayType$2, arrayType$3, arrayType$4, ptrType, ptrType$1, littleEndian, block, init, New, init$1, blockGeneric;
	crypto = $packages["crypto"];
	hash = $packages["hash"];
	runtime = $packages["runtime"];
	digest = $pkg.digest = $newType(0, $kindStruct, "md5.digest", true, "crypto/md5", false, function(s_, x_, nx_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = arrayType.zero();
			this.x = arrayType$1.zero();
			this.nx = 0;
			this.len = new $Uint64(0, 0);
			return;
		}
		this.s = s_;
		this.x = x_;
		this.nx = nx_;
		this.len = len_;
	});
	arrayType = $arrayType($Uint32, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	sliceType = $sliceType($Uint8);
	arrayType$2 = $arrayType($Uint8, 16);
	arrayType$3 = $arrayType($Uint8, 4);
	arrayType$4 = $arrayType($Uint32, 16);
	ptrType = $ptrType(arrayType$4);
	ptrType$1 = $ptrType(digest);
	init = function() {
		var $ptr;
		crypto.RegisterHash(2, New);
	};
	digest.ptr.prototype.Reset = function() {
		var $ptr, d;
		d = this;
		d.s[0] = 1732584193;
		d.s[1] = 4023233417;
		d.s[2] = 2562383102;
		d.s[3] = 271733878;
		d.nx = 0;
		d.len = new $Uint64(0, 0);
	};
	digest.prototype.Reset = function() { return this.$val.Reset(); };
	New = function() {
		var $ptr, d;
		d = new digest.ptr(arrayType.zero(), arrayType$1.zero(), 0, new $Uint64(0, 0));
		d.Reset();
		return d;
	};
	$pkg.New = New;
	digest.ptr.prototype.Size = function() {
		var $ptr, d;
		d = this;
		return 16;
	};
	digest.prototype.Size = function() { return this.$val.Size(); };
	digest.ptr.prototype.BlockSize = function() {
		var $ptr, d;
		d = this;
		return 64;
	};
	digest.prototype.BlockSize = function() { return this.$val.BlockSize(); };
	digest.ptr.prototype.Write = function(p) {
		var $ptr, d, err, n, n$1, nn, p, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; d = $f.d; err = $f.err; n = $f.n; n$1 = $f.n$1; nn = $f.nn; p = $f.p; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		nn = 0;
		err = $ifaceNil;
		d = this;
		nn = p.$length;
		d.len = (x = d.len, x$1 = new $Uint64(0, nn), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
		/* */ if (d.nx > 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (d.nx > 0) { */ case 1:
			n = $copySlice($subslice(new sliceType(d.x), d.nx), p);
			d.nx = d.nx + (n) >> 0;
			/* */ if (d.nx === 64) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (d.nx === 64) { */ case 3:
				$r = block(d, new sliceType(d.x)); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				d.nx = 0;
			/* } */ case 4:
			p = $subslice(p, n);
		/* } */ case 2:
		/* */ if (p.$length >= 64) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (p.$length >= 64) { */ case 6:
			n$1 = (p.$length & ~63) >> 0;
			$r = block(d, $subslice(p, 0, n$1)); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			p = $subslice(p, n$1);
		/* } */ case 7:
		if (p.$length > 0) {
			d.nx = $copySlice(new sliceType(d.x), p);
		}
		$s = -1; return [nn, err];
		return [nn, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: digest.ptr.prototype.Write }; } $f.$ptr = $ptr; $f.d = d; $f.err = err; $f.n = n; $f.n$1 = n$1; $f.nn = nn; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	digest.prototype.Write = function(p) { return this.$val.Write(p); };
	digest.ptr.prototype.Sum = function(in$1) {
		var $ptr, _r, d, d0, hash$1, in$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; d = $f.d; d0 = $f.d0; hash$1 = $f.hash$1; in$1 = $f.in$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d0 = this;
		d = $clone(d0, digest);
		_r = d.checkSum(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		hash$1 = $clone(_r, arrayType$2);
		$s = -1; return $appendSlice(in$1, new sliceType(hash$1));
		return $appendSlice(in$1, new sliceType(hash$1));
		/* */ } return; } if ($f === undefined) { $f = { $blk: digest.ptr.prototype.Sum }; } $f.$ptr = $ptr; $f._r = _r; $f.d = d; $f.d0 = d0; $f.hash$1 = hash$1; $f.in$1 = in$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	digest.prototype.Sum = function(in$1) { return this.$val.Sum(in$1); };
	digest.ptr.prototype.checkSum = function() {
		var $ptr, _i, _r, _r$1, _r$2, _ref, d, digest$1, i, i$1, len, s, tmp, x, x$1, x$2, x$3, x$4, x$5, x$6, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; d = $f.d; digest$1 = $f.digest$1; i = $f.i; i$1 = $f.i$1; len = $f.len; s = $f.s; tmp = $f.tmp; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		len = d.len;
		tmp = arrayType$1.zero();
		tmp[0] = 128;
		/* */ if ((x = $div64(len, new $Uint64(0, 64), true), (x.$high < 0 || (x.$high === 0 && x.$low < 56)))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((x = $div64(len, new $Uint64(0, 64), true), (x.$high < 0 || (x.$high === 0 && x.$low < 56)))) { */ case 1:
			_r = d.Write($subslice(new sliceType(tmp), 0, $flatten64((x$1 = $div64(len, new $Uint64(0, 64), true), new $Uint64(0 - x$1.$high, 56 - x$1.$low))))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = d.Write($subslice(new sliceType(tmp), 0, $flatten64((x$2 = $div64(len, new $Uint64(0, 64), true), new $Uint64(0 - x$2.$high, 120 - x$2.$low))))); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$1;
		/* } */ case 3:
		len = $shiftLeft64(len, (3));
		i = 0;
		while (true) {
			if (!(i < 8)) { break; }
			((i < 0 || i >= tmp.length) ? $throwRuntimeError("index out of range") : tmp[i] = ($shiftRightUint64(len, ((8 * i >>> 0))).$low << 24 >>> 24));
			i = i + (1) >>> 0;
		}
		_r$2 = d.Write($subslice(new sliceType(tmp), 0, 8)); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_r$2;
		if (!((d.nx === 0))) {
			$panic(new $String("d.nx != 0"));
		}
		digest$1 = arrayType$2.zero();
		_ref = d.s;
		_i = 0;
		while (true) {
			if (!(_i < 4)) { break; }
			i$1 = _i;
			s = ((_i < 0 || _i >= _ref.length) ? $throwRuntimeError("index out of range") : _ref[_i]);
			(x$3 = $imul(i$1, 4), ((x$3 < 0 || x$3 >= digest$1.length) ? $throwRuntimeError("index out of range") : digest$1[x$3] = (s << 24 >>> 24)));
			(x$4 = ($imul(i$1, 4)) + 1 >> 0, ((x$4 < 0 || x$4 >= digest$1.length) ? $throwRuntimeError("index out of range") : digest$1[x$4] = ((s >>> 8 >>> 0) << 24 >>> 24)));
			(x$5 = ($imul(i$1, 4)) + 2 >> 0, ((x$5 < 0 || x$5 >= digest$1.length) ? $throwRuntimeError("index out of range") : digest$1[x$5] = ((s >>> 16 >>> 0) << 24 >>> 24)));
			(x$6 = ($imul(i$1, 4)) + 3 >> 0, ((x$6 < 0 || x$6 >= digest$1.length) ? $throwRuntimeError("index out of range") : digest$1[x$6] = ((s >>> 24 >>> 0) << 24 >>> 24)));
			_i++;
		}
		$s = -1; return digest$1;
		return digest$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: digest.ptr.prototype.checkSum }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f.d = d; $f.digest$1 = digest$1; $f.i = i; $f.i$1 = i$1; $f.len = len; $f.s = s; $f.tmp = tmp; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.$s = $s; $f.$r = $r; return $f;
	};
	digest.prototype.checkSum = function() { return this.$val.checkSum(); };
	init$1 = function() {
		var $ptr, x, y;
		x = 67305985;
		y = $toNativeArray($kindUint8, [1, 2, 3, 4]);
		littleEndian = $equal(x, y, arrayType$3);
	};
	blockGeneric = function(dig, p) {
		var $ptr, X, _tmp, _tmp$1, _tmp$2, _tmp$3, a, aa, b, bb, c, cc, d, dd, dig, i, j, p, x, x$1, x$2, x$3, xbuf;
		a = dig.s[0];
		b = dig.s[1];
		c = dig.s[2];
		d = dig.s[3];
		X = ptrType.nil;
		xbuf = arrayType$4.zero();
		while (true) {
			if (!(p.$length >= 64)) { break; }
			_tmp = a;
			_tmp$1 = b;
			_tmp$2 = c;
			_tmp$3 = d;
			aa = _tmp;
			bb = _tmp$1;
			cc = _tmp$2;
			dd = _tmp$3;
			if (false) {
				X = $sliceToArray(p);
			} else if (littleEndian && ((($sliceToArray(p) & 3) >>> 0) === 0)) {
				X = $sliceToArray(p);
			} else {
				X = xbuf;
				j = 0;
				i = 0;
				while (true) {
					if (!(i < 16)) { break; }
					(x$3 = i & 15, X.nilCheck, ((x$3 < 0 || x$3 >= X.length) ? $throwRuntimeError("index out of range") : X[x$3] = (((((((((j < 0 || j >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + j]) >>> 0) | (((x = j + 1 >> 0, ((x < 0 || x >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x])) >>> 0) << 8 >>> 0)) >>> 0) | (((x$1 = j + 2 >> 0, ((x$1 < 0 || x$1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$1])) >>> 0) << 16 >>> 0)) >>> 0) | (((x$2 = j + 3 >> 0, ((x$2 < 0 || x$2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + x$2])) >>> 0) << 24 >>> 0)) >>> 0)));
					j = j + (4) >> 0;
					i = i + (1) >> 0;
				}
			}
			a = a + ((((((((((((c ^ d) >>> 0)) & b) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[0]) >>> 0) + 3614090360 >>> 0)) >>> 0;
			a = (((a << 7 >>> 0) | (a >>> 25 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((b ^ c) >>> 0)) & a) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[1]) >>> 0) + 3905402710 >>> 0)) >>> 0;
			d = (((d << 12 >>> 0) | (d >>> 20 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((a ^ b) >>> 0)) & d) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[2]) >>> 0) + 606105819 >>> 0)) >>> 0;
			c = (((c << 17 >>> 0) | (c >>> 15 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((d ^ a) >>> 0)) & c) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[3]) >>> 0) + 3250441966 >>> 0)) >>> 0;
			b = (((b << 22 >>> 0) | (b >>> 10 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((c ^ d) >>> 0)) & b) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[4]) >>> 0) + 4118548399 >>> 0)) >>> 0;
			a = (((a << 7 >>> 0) | (a >>> 25 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((b ^ c) >>> 0)) & a) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[5]) >>> 0) + 1200080426 >>> 0)) >>> 0;
			d = (((d << 12 >>> 0) | (d >>> 20 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((a ^ b) >>> 0)) & d) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[6]) >>> 0) + 2821735955 >>> 0)) >>> 0;
			c = (((c << 17 >>> 0) | (c >>> 15 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((d ^ a) >>> 0)) & c) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[7]) >>> 0) + 4249261313 >>> 0)) >>> 0;
			b = (((b << 22 >>> 0) | (b >>> 10 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((c ^ d) >>> 0)) & b) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[8]) >>> 0) + 1770035416 >>> 0)) >>> 0;
			a = (((a << 7 >>> 0) | (a >>> 25 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((b ^ c) >>> 0)) & a) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[9]) >>> 0) + 2336552879 >>> 0)) >>> 0;
			d = (((d << 12 >>> 0) | (d >>> 20 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((a ^ b) >>> 0)) & d) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[10]) >>> 0) + 4294925233 >>> 0)) >>> 0;
			c = (((c << 17 >>> 0) | (c >>> 15 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((d ^ a) >>> 0)) & c) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[11]) >>> 0) + 2304563134 >>> 0)) >>> 0;
			b = (((b << 22 >>> 0) | (b >>> 10 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((c ^ d) >>> 0)) & b) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[12]) >>> 0) + 1804603682 >>> 0)) >>> 0;
			a = (((a << 7 >>> 0) | (a >>> 25 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((b ^ c) >>> 0)) & a) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[13]) >>> 0) + 4254626195 >>> 0)) >>> 0;
			d = (((d << 12 >>> 0) | (d >>> 20 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((a ^ b) >>> 0)) & d) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[14]) >>> 0) + 2792965006 >>> 0)) >>> 0;
			c = (((c << 17 >>> 0) | (c >>> 15 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((d ^ a) >>> 0)) & c) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[15]) >>> 0) + 1236535329 >>> 0)) >>> 0;
			b = (((b << 22 >>> 0) | (b >>> 10 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((b ^ c) >>> 0)) & d) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[1]) >>> 0) + 4129170786 >>> 0)) >>> 0;
			a = (((a << 5 >>> 0) | (a >>> 27 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((a ^ b) >>> 0)) & c) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[6]) >>> 0) + 3225465664 >>> 0)) >>> 0;
			d = (((d << 9 >>> 0) | (d >>> 23 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((d ^ a) >>> 0)) & b) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[11]) >>> 0) + 643717713 >>> 0)) >>> 0;
			c = (((c << 14 >>> 0) | (c >>> 18 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((c ^ d) >>> 0)) & a) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[0]) >>> 0) + 3921069994 >>> 0)) >>> 0;
			b = (((b << 20 >>> 0) | (b >>> 12 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((b ^ c) >>> 0)) & d) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[5]) >>> 0) + 3593408605 >>> 0)) >>> 0;
			a = (((a << 5 >>> 0) | (a >>> 27 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((a ^ b) >>> 0)) & c) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[10]) >>> 0) + 38016083 >>> 0)) >>> 0;
			d = (((d << 9 >>> 0) | (d >>> 23 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((d ^ a) >>> 0)) & b) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[15]) >>> 0) + 3634488961 >>> 0)) >>> 0;
			c = (((c << 14 >>> 0) | (c >>> 18 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((c ^ d) >>> 0)) & a) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[4]) >>> 0) + 3889429448 >>> 0)) >>> 0;
			b = (((b << 20 >>> 0) | (b >>> 12 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((b ^ c) >>> 0)) & d) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[9]) >>> 0) + 568446438 >>> 0)) >>> 0;
			a = (((a << 5 >>> 0) | (a >>> 27 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((a ^ b) >>> 0)) & c) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[14]) >>> 0) + 3275163606 >>> 0)) >>> 0;
			d = (((d << 9 >>> 0) | (d >>> 23 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((d ^ a) >>> 0)) & b) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[3]) >>> 0) + 4107603335 >>> 0)) >>> 0;
			c = (((c << 14 >>> 0) | (c >>> 18 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((c ^ d) >>> 0)) & a) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[8]) >>> 0) + 1163531501 >>> 0)) >>> 0;
			b = (((b << 20 >>> 0) | (b >>> 12 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((((((b ^ c) >>> 0)) & d) >>> 0)) ^ c) >>> 0)) + (X.nilCheck, X[13]) >>> 0) + 2850285829 >>> 0)) >>> 0;
			a = (((a << 5 >>> 0) | (a >>> 27 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((((((a ^ b) >>> 0)) & c) >>> 0)) ^ b) >>> 0)) + (X.nilCheck, X[2]) >>> 0) + 4243563512 >>> 0)) >>> 0;
			d = (((d << 9 >>> 0) | (d >>> 23 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((((((d ^ a) >>> 0)) & b) >>> 0)) ^ a) >>> 0)) + (X.nilCheck, X[7]) >>> 0) + 1735328473 >>> 0)) >>> 0;
			c = (((c << 14 >>> 0) | (c >>> 18 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((((((c ^ d) >>> 0)) & a) >>> 0)) ^ d) >>> 0)) + (X.nilCheck, X[12]) >>> 0) + 2368359562 >>> 0)) >>> 0;
			b = (((b << 20 >>> 0) | (b >>> 12 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((b ^ c) >>> 0) ^ d) >>> 0)) + (X.nilCheck, X[5]) >>> 0) + 4294588738 >>> 0)) >>> 0;
			a = (((a << 4 >>> 0) | (a >>> 28 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((a ^ b) >>> 0) ^ c) >>> 0)) + (X.nilCheck, X[8]) >>> 0) + 2272392833 >>> 0)) >>> 0;
			d = (((d << 11 >>> 0) | (d >>> 21 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((d ^ a) >>> 0) ^ b) >>> 0)) + (X.nilCheck, X[11]) >>> 0) + 1839030562 >>> 0)) >>> 0;
			c = (((c << 16 >>> 0) | (c >>> 16 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((c ^ d) >>> 0) ^ a) >>> 0)) + (X.nilCheck, X[14]) >>> 0) + 4259657740 >>> 0)) >>> 0;
			b = (((b << 23 >>> 0) | (b >>> 9 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((b ^ c) >>> 0) ^ d) >>> 0)) + (X.nilCheck, X[1]) >>> 0) + 2763975236 >>> 0)) >>> 0;
			a = (((a << 4 >>> 0) | (a >>> 28 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((a ^ b) >>> 0) ^ c) >>> 0)) + (X.nilCheck, X[4]) >>> 0) + 1272893353 >>> 0)) >>> 0;
			d = (((d << 11 >>> 0) | (d >>> 21 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((d ^ a) >>> 0) ^ b) >>> 0)) + (X.nilCheck, X[7]) >>> 0) + 4139469664 >>> 0)) >>> 0;
			c = (((c << 16 >>> 0) | (c >>> 16 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((c ^ d) >>> 0) ^ a) >>> 0)) + (X.nilCheck, X[10]) >>> 0) + 3200236656 >>> 0)) >>> 0;
			b = (((b << 23 >>> 0) | (b >>> 9 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((b ^ c) >>> 0) ^ d) >>> 0)) + (X.nilCheck, X[13]) >>> 0) + 681279174 >>> 0)) >>> 0;
			a = (((a << 4 >>> 0) | (a >>> 28 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((a ^ b) >>> 0) ^ c) >>> 0)) + (X.nilCheck, X[0]) >>> 0) + 3936430074 >>> 0)) >>> 0;
			d = (((d << 11 >>> 0) | (d >>> 21 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((d ^ a) >>> 0) ^ b) >>> 0)) + (X.nilCheck, X[3]) >>> 0) + 3572445317 >>> 0)) >>> 0;
			c = (((c << 16 >>> 0) | (c >>> 16 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((c ^ d) >>> 0) ^ a) >>> 0)) + (X.nilCheck, X[6]) >>> 0) + 76029189 >>> 0)) >>> 0;
			b = (((b << 23 >>> 0) | (b >>> 9 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((((b ^ c) >>> 0) ^ d) >>> 0)) + (X.nilCheck, X[9]) >>> 0) + 3654602809 >>> 0)) >>> 0;
			a = (((a << 4 >>> 0) | (a >>> 28 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((((a ^ b) >>> 0) ^ c) >>> 0)) + (X.nilCheck, X[12]) >>> 0) + 3873151461 >>> 0)) >>> 0;
			d = (((d << 11 >>> 0) | (d >>> 21 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((((d ^ a) >>> 0) ^ b) >>> 0)) + (X.nilCheck, X[15]) >>> 0) + 530742520 >>> 0)) >>> 0;
			c = (((c << 16 >>> 0) | (c >>> 16 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((((c ^ d) >>> 0) ^ a) >>> 0)) + (X.nilCheck, X[2]) >>> 0) + 3299628645 >>> 0)) >>> 0;
			b = (((b << 23 >>> 0) | (b >>> 9 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((c ^ (((b | (~d >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[0]) >>> 0) + 4096336452 >>> 0)) >>> 0;
			a = (((a << 6 >>> 0) | (a >>> 26 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((b ^ (((a | (~c >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[7]) >>> 0) + 1126891415 >>> 0)) >>> 0;
			d = (((d << 10 >>> 0) | (d >>> 22 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((a ^ (((d | (~b >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[14]) >>> 0) + 2878612391 >>> 0)) >>> 0;
			c = (((c << 15 >>> 0) | (c >>> 17 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((d ^ (((c | (~a >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[5]) >>> 0) + 4237533241 >>> 0)) >>> 0;
			b = (((b << 21 >>> 0) | (b >>> 11 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((c ^ (((b | (~d >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[12]) >>> 0) + 1700485571 >>> 0)) >>> 0;
			a = (((a << 6 >>> 0) | (a >>> 26 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((b ^ (((a | (~c >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[3]) >>> 0) + 2399980690 >>> 0)) >>> 0;
			d = (((d << 10 >>> 0) | (d >>> 22 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((a ^ (((d | (~b >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[10]) >>> 0) + 4293915773 >>> 0)) >>> 0;
			c = (((c << 15 >>> 0) | (c >>> 17 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((d ^ (((c | (~a >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[1]) >>> 0) + 2240044497 >>> 0)) >>> 0;
			b = (((b << 21 >>> 0) | (b >>> 11 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((c ^ (((b | (~d >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[8]) >>> 0) + 1873313359 >>> 0)) >>> 0;
			a = (((a << 6 >>> 0) | (a >>> 26 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((b ^ (((a | (~c >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[15]) >>> 0) + 4264355552 >>> 0)) >>> 0;
			d = (((d << 10 >>> 0) | (d >>> 22 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((a ^ (((d | (~b >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[6]) >>> 0) + 2734768916 >>> 0)) >>> 0;
			c = (((c << 15 >>> 0) | (c >>> 17 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((d ^ (((c | (~a >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[13]) >>> 0) + 1309151649 >>> 0)) >>> 0;
			b = (((b << 21 >>> 0) | (b >>> 11 >>> 0)) >>> 0) + c >>> 0;
			a = a + ((((((c ^ (((b | (~d >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[4]) >>> 0) + 4149444226 >>> 0)) >>> 0;
			a = (((a << 6 >>> 0) | (a >>> 26 >>> 0)) >>> 0) + b >>> 0;
			d = d + ((((((b ^ (((a | (~c >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[11]) >>> 0) + 3174756917 >>> 0)) >>> 0;
			d = (((d << 10 >>> 0) | (d >>> 22 >>> 0)) >>> 0) + a >>> 0;
			c = c + ((((((a ^ (((d | (~b >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[2]) >>> 0) + 718787259 >>> 0)) >>> 0;
			c = (((c << 15 >>> 0) | (c >>> 17 >>> 0)) >>> 0) + d >>> 0;
			b = b + ((((((d ^ (((c | (~a >>> 0)) >>> 0))) >>> 0)) + (X.nilCheck, X[9]) >>> 0) + 3951481745 >>> 0)) >>> 0;
			b = (((b << 21 >>> 0) | (b >>> 11 >>> 0)) >>> 0) + c >>> 0;
			a = a + (aa) >>> 0;
			b = b + (bb) >>> 0;
			c = c + (cc) >>> 0;
			d = d + (dd) >>> 0;
			p = $subslice(p, 64);
		}
		dig.s[0] = a;
		dig.s[1] = b;
		dig.s[2] = c;
		dig.s[3] = d;
	};
	ptrType$1.methods = [{prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "BlockSize", name: "BlockSize", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "Sum", name: "Sum", pkg: "", typ: $funcType([sliceType], [sliceType], false)}, {prop: "checkSum", name: "checkSum", pkg: "crypto/md5", typ: $funcType([], [arrayType$2], false)}];
	digest.init("crypto/md5", [{prop: "s", name: "s", exported: false, typ: arrayType, tag: ""}, {prop: "x", name: "x", exported: false, typ: arrayType$1, tag: ""}, {prop: "nx", name: "nx", exported: false, typ: $Int, tag: ""}, {prop: "len", name: "len", exported: false, typ: $Uint64, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = crypto.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = hash.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		littleEndian = false;
		block = blockGeneric;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["syscall"] = (function() {
	var $pkg = {}, $init, errors, js, race, runtime, sync, mmapper, Errno, _C_int, Timespec, Stat_t, Dirent, sliceType, sliceType$1, ptrType$2, arrayType$1, sliceType$5, ptrType$12, arrayType$10, arrayType$13, arrayType$14, arrayType$15, structType, ptrType$20, ptrType$27, mapType, funcType, funcType$1, ptrType$31, arrayType$17, warningPrinted, lineBuffer, syscallModule, alreadyTriedToLoad, minusOne, envOnce, envLock, env, envs, freebsdConfArch, minRoutingSockaddrLen, mapper, errEAGAIN, errEINVAL, errENOENT, ioSync, ioSync$24ptr, errors$1, init, printWarning, printToConsole, use, indexByte, runtime_envs, syscall, Syscall, Syscall6, BytePtrFromString, copyenv, Getenv, msanRead, msanWrite, rsaAlignOf, itoa, uitoa, ByteSliceFromString, ReadDirent, Sysctl, nametomib, ParseDirent, errnoErr, Read, Write, sysctl, Close, Fchdir, Fchmod, Fchown, Fstat, Fsync, Ftruncate, Getdirentries, Lstat, Pread, Pwrite, read, Seek, write, mmap, munmap;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	mmapper = $pkg.mmapper = $newType(0, $kindStruct, "syscall.mmapper", true, "syscall", false, function(Mutex_, active_, mmap_, munmap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Mutex = new sync.Mutex.ptr(0, 0);
			this.active = false;
			this.mmap = $throwNilPointerError;
			this.munmap = $throwNilPointerError;
			return;
		}
		this.Mutex = Mutex_;
		this.active = active_;
		this.mmap = mmap_;
		this.munmap = munmap_;
	});
	Errno = $pkg.Errno = $newType(4, $kindUintptr, "syscall.Errno", true, "syscall", true, null);
	_C_int = $pkg._C_int = $newType(4, $kindInt32, "syscall._C_int", true, "syscall", false, null);
	Timespec = $pkg.Timespec = $newType(0, $kindStruct, "syscall.Timespec", true, "syscall", true, function(Sec_, Nsec_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Sec = new $Int64(0, 0);
			this.Nsec = new $Int64(0, 0);
			return;
		}
		this.Sec = Sec_;
		this.Nsec = Nsec_;
	});
	Stat_t = $pkg.Stat_t = $newType(0, $kindStruct, "syscall.Stat_t", true, "syscall", true, function(Dev_, Mode_, Nlink_, Ino_, Uid_, Gid_, Rdev_, Pad_cgo_0_, Atimespec_, Mtimespec_, Ctimespec_, Birthtimespec_, Size_, Blocks_, Blksize_, Flags_, Gen_, Lspare_, Qspare_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Dev = 0;
			this.Mode = 0;
			this.Nlink = 0;
			this.Ino = new $Uint64(0, 0);
			this.Uid = 0;
			this.Gid = 0;
			this.Rdev = 0;
			this.Pad_cgo_0 = arrayType$1.zero();
			this.Atimespec = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Mtimespec = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Ctimespec = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Birthtimespec = new Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0));
			this.Size = new $Int64(0, 0);
			this.Blocks = new $Int64(0, 0);
			this.Blksize = 0;
			this.Flags = 0;
			this.Gen = 0;
			this.Lspare = 0;
			this.Qspare = arrayType$17.zero();
			return;
		}
		this.Dev = Dev_;
		this.Mode = Mode_;
		this.Nlink = Nlink_;
		this.Ino = Ino_;
		this.Uid = Uid_;
		this.Gid = Gid_;
		this.Rdev = Rdev_;
		this.Pad_cgo_0 = Pad_cgo_0_;
		this.Atimespec = Atimespec_;
		this.Mtimespec = Mtimespec_;
		this.Ctimespec = Ctimespec_;
		this.Birthtimespec = Birthtimespec_;
		this.Size = Size_;
		this.Blocks = Blocks_;
		this.Blksize = Blksize_;
		this.Flags = Flags_;
		this.Gen = Gen_;
		this.Lspare = Lspare_;
		this.Qspare = Qspare_;
	});
	Dirent = $pkg.Dirent = $newType(0, $kindStruct, "syscall.Dirent", true, "syscall", true, function(Ino_, Seekoff_, Reclen_, Namlen_, Type_, Name_, Pad_cgo_0_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Ino = new $Uint64(0, 0);
			this.Seekoff = new $Uint64(0, 0);
			this.Reclen = 0;
			this.Namlen = 0;
			this.Type = 0;
			this.Name = arrayType$14.zero();
			this.Pad_cgo_0 = arrayType$15.zero();
			return;
		}
		this.Ino = Ino_;
		this.Seekoff = Seekoff_;
		this.Reclen = Reclen_;
		this.Namlen = Namlen_;
		this.Type = Type_;
		this.Name = Name_;
		this.Pad_cgo_0 = Pad_cgo_0_;
	});
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	ptrType$2 = $ptrType($Uint8);
	arrayType$1 = $arrayType($Uint8, 4);
	sliceType$5 = $sliceType(_C_int);
	ptrType$12 = $ptrType($Uintptr);
	arrayType$10 = $arrayType($Uint8, 32);
	arrayType$13 = $arrayType(_C_int, 14);
	arrayType$14 = $arrayType($Int8, 1024);
	arrayType$15 = $arrayType($Uint8, 3);
	structType = $structType("syscall", [{prop: "addr", name: "addr", exported: false, typ: $Uintptr, tag: ""}, {prop: "len", name: "len", exported: false, typ: $Int, tag: ""}, {prop: "cap", name: "cap", exported: false, typ: $Int, tag: ""}]);
	ptrType$20 = $ptrType($Int64);
	ptrType$27 = $ptrType(mmapper);
	mapType = $mapType(ptrType$2, sliceType);
	funcType = $funcType([$Uintptr, $Uintptr, $Int, $Int, $Int, $Int64], [$Uintptr, $error], false);
	funcType$1 = $funcType([$Uintptr, $Uintptr], [$error], false);
	ptrType$31 = $ptrType(Timespec);
	arrayType$17 = $arrayType($Int64, 2);
	init = function() {
		var $ptr;
		$flushConsole = (function() {
			var $ptr;
			if (!((lineBuffer.$length === 0))) {
				$global.console.log($externalize($bytesToString(lineBuffer), $String));
				lineBuffer = sliceType.nil;
			}
		});
	};
	printWarning = function() {
		var $ptr;
		if (!warningPrinted) {
			$global.console.error($externalize("warning: system calls not available, see https://github.com/gopherjs/gopherjs/blob/master/doc/syscalls.md", $String));
		}
		warningPrinted = true;
	};
	printToConsole = function(b) {
		var $ptr, b, goPrintToConsole, i;
		goPrintToConsole = $global.goPrintToConsole;
		if (!(goPrintToConsole === undefined)) {
			goPrintToConsole(b);
			return;
		}
		lineBuffer = $appendSlice(lineBuffer, b);
		while (true) {
			i = indexByte(lineBuffer, 10);
			if (i === -1) {
				break;
			}
			$global.console.log($externalize($bytesToString($subslice(lineBuffer, 0, i)), $String));
			lineBuffer = $subslice(lineBuffer, (i + 1 >> 0));
		}
	};
	use = function(p) {
		var $ptr, p;
	};
	indexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	runtime_envs = function() {
		var $ptr, envkeys, envs$1, i, jsEnv, key, process;
		process = $global.process;
		if (process === undefined) {
			return sliceType$1.nil;
		}
		jsEnv = process.env;
		envkeys = $global.Object.keys(jsEnv);
		envs$1 = $makeSlice(sliceType$1, $parseInt(envkeys.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(envkeys.length))) { break; }
			key = $internalize(envkeys[i], $String);
			((i < 0 || i >= envs$1.$length) ? $throwRuntimeError("index out of range") : envs$1.$array[envs$1.$offset + i] = key + "=" + $internalize(jsEnv[$externalize(key, $String)], $String));
			i = i + (1) >> 0;
		}
		return envs$1;
	};
	syscall = function(name) {
		var $ptr, name, require, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			$recover();
		}), []]);
		if (syscallModule === null) {
			if (alreadyTriedToLoad) {
				return null;
			}
			alreadyTriedToLoad = true;
			require = $global.require;
			if (require === undefined) {
				$panic(new $String(""));
			}
			syscallModule = require($externalize("syscall", $String));
		}
		return syscallModule[$externalize(name, $String)];
		/* */ } catch(err) { $err = err; return null; } finally { $callDeferred($deferred, $err); }
	};
	Syscall = function(trap, a1, a2, a3) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, a1, a2, a3, array, err, f, r, r1, r2, slice, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if ((trap === 4) && ((a1 === 1) || (a1 === 2))) {
			array = a2;
			slice = $makeSlice(sliceType, $parseInt(array.length));
			slice.$array = array;
			printToConsole(slice);
			_tmp$3 = ($parseInt(array.length) >>> 0);
			_tmp$4 = 0;
			_tmp$5 = 0;
			r1 = _tmp$3;
			r2 = _tmp$4;
			err = _tmp$5;
			return [r1, r2, err];
		}
		if (trap === 1) {
			runtime.Goexit();
		}
		printWarning();
		_tmp$6 = (minusOne >>> 0);
		_tmp$7 = 0;
		_tmp$8 = 13;
		r1 = _tmp$6;
		r2 = _tmp$7;
		err = _tmp$8;
		return [r1, r2, err];
	};
	$pkg.Syscall = Syscall;
	Syscall6 = function(trap, a1, a2, a3, a4, a5, a6) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, a1, a2, a3, a4, a5, a6, err, f, r, r1, r2, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall6");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3, a4, a5, a6);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if (!((trap === 202))) {
			printWarning();
		}
		_tmp$3 = (minusOne >>> 0);
		_tmp$4 = 0;
		_tmp$5 = 13;
		r1 = _tmp$3;
		r2 = _tmp$4;
		err = _tmp$5;
		return [r1, r2, err];
	};
	$pkg.Syscall6 = Syscall6;
	BytePtrFromString = function(s) {
		var $ptr, _i, _ref, array, b, i, s;
		array = new ($global.Uint8Array)(s.length + 1 >> 0);
		_ref = new sliceType($stringToBytes(s));
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === 0) {
				return [ptrType$2.nil, new Errno(22)];
			}
			array[i] = b;
			_i++;
		}
		array[s.length] = 0;
		return [array, $ifaceNil];
	};
	$pkg.BytePtrFromString = BytePtrFromString;
	copyenv = function() {
		var $ptr, _entry, _i, _key, _ref, _tuple, i, j, key, ok, s;
		env = {};
		_ref = envs;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			j = 0;
			while (true) {
				if (!(j < s.length)) { break; }
				if (s.charCodeAt(j) === 61) {
					key = $substring(s, 0, j);
					_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
					ok = _tuple[1];
					if (!ok) {
						_key = key; (env || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: i };
					} else {
						((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i] = "");
					}
					break;
				}
				j = j + (1) >> 0;
			}
			_i++;
		}
	};
	Getenv = function(key) {
		var $ptr, _entry, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, found, i, i$1, key, ok, s, value, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; found = $f.found; i = $f.i; i$1 = $f.i$1; key = $f.key; ok = $f.ok; s = $f.s; value = $f.value; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		value = "";
		found = false;
		$r = envOnce.Do(copyenv); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (key.length === 0) {
			_tmp = "";
			_tmp$1 = false;
			value = _tmp;
			found = _tmp$1;
			$s = -1; return [value, found];
			return [value, found];
		}
		$r = envLock.RLock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(envLock, "RUnlock"), []]);
		_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
		i = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			_tmp$2 = "";
			_tmp$3 = false;
			value = _tmp$2;
			found = _tmp$3;
			$s = -1; return [value, found];
			return [value, found];
		}
		s = ((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i]);
		i$1 = 0;
		while (true) {
			if (!(i$1 < s.length)) { break; }
			if (s.charCodeAt(i$1) === 61) {
				_tmp$4 = $substring(s, (i$1 + 1 >> 0));
				_tmp$5 = true;
				value = _tmp$4;
				found = _tmp$5;
				$s = -1; return [value, found];
				return [value, found];
			}
			i$1 = i$1 + (1) >> 0;
		}
		_tmp$6 = "";
		_tmp$7 = false;
		value = _tmp$6;
		found = _tmp$7;
		$s = -1; return [value, found];
		return [value, found];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [value, found]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Getenv }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f.found = found; $f.i = i; $f.i$1 = i$1; $f.key = key; $f.ok = ok; $f.s = s; $f.value = value; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.Getenv = Getenv;
	msanRead = function(addr, len) {
		var $ptr, addr, len;
	};
	msanWrite = function(addr, len) {
		var $ptr, addr, len;
	};
	rsaAlignOf = function(salen) {
		var $ptr, salen, salign;
		salign = 8;
		if (true) {
			salign = 4;
		} else if (false) {
			salign = 8;
		} else if (false) {
			if (freebsdConfArch === "amd64") {
				salign = 8;
			}
		}
		if (salen === 0) {
			return salign;
		}
		return (((salen + salign >> 0) - 1 >> 0)) & (~((salign - 1 >> 0)) >> 0);
	};
	itoa = function(val) {
		var $ptr, val;
		if (val < 0) {
			return "-" + uitoa((-val >>> 0));
		}
		return uitoa((val >>> 0));
	};
	uitoa = function(val) {
		var $ptr, _q, _r, buf, i, val;
		buf = arrayType$10.zero();
		i = 31;
		while (true) {
			if (!(val >= 10)) { break; }
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((_r = val % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			i = i - (1) >> 0;
			val = (_q = val / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((val + 48 >>> 0) << 24 >>> 24));
		return $bytesToString($subslice(new sliceType(buf), i));
	};
	ByteSliceFromString = function(s) {
		var $ptr, a, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === 0) {
				return [sliceType.nil, new Errno(22)];
			}
			i = i + (1) >> 0;
		}
		a = $makeSlice(sliceType, (s.length + 1 >> 0));
		$copyString(a, s);
		return [a, $ifaceNil];
	};
	$pkg.ByteSliceFromString = ByteSliceFromString;
	Timespec.ptr.prototype.Unix = function() {
		var $ptr, _tmp, _tmp$1, nsec, sec, ts;
		sec = new $Int64(0, 0);
		nsec = new $Int64(0, 0);
		ts = this;
		_tmp = ts.Sec;
		_tmp$1 = ts.Nsec;
		sec = _tmp;
		nsec = _tmp$1;
		return [sec, nsec];
	};
	Timespec.prototype.Unix = function() { return this.$val.Unix(); };
	Timespec.ptr.prototype.Nano = function() {
		var $ptr, ts, x, x$1;
		ts = this;
		return (x = $mul64(ts.Sec, new $Int64(0, 1000000000)), x$1 = ts.Nsec, new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
	};
	Timespec.prototype.Nano = function() { return this.$val.Nano(); };
	ReadDirent = function(fd, buf) {
		var $ptr, _tuple, base, buf, err, fd, n;
		n = 0;
		err = $ifaceNil;
		base = new Uint8Array(8);
		_tuple = Getdirentries(fd, buf, base);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	$pkg.ReadDirent = ReadDirent;
	Sysctl = function(name) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, buf, err, mib, n, n$24ptr, name, value, x;
		value = "";
		err = $ifaceNil;
		_tuple = nametomib(name);
		mib = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = "";
			_tmp$1 = err;
			value = _tmp;
			err = _tmp$1;
			return [value, err];
		}
		n = 0;
		err = sysctl(mib, ptrType$2.nil, (n$24ptr || (n$24ptr = new ptrType$12(function() { return n; }, function($v) { n = $v; }))), ptrType$2.nil, 0);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp$2 = "";
			_tmp$3 = err;
			value = _tmp$2;
			err = _tmp$3;
			return [value, err];
		}
		if (n === 0) {
			_tmp$4 = "";
			_tmp$5 = $ifaceNil;
			value = _tmp$4;
			err = _tmp$5;
			return [value, err];
		}
		buf = $makeSlice(sliceType, n);
		err = sysctl(mib, $indexPtr(buf.$array, buf.$offset + 0, ptrType$2), (n$24ptr || (n$24ptr = new ptrType$12(function() { return n; }, function($v) { n = $v; }))), ptrType$2.nil, 0);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp$6 = "";
			_tmp$7 = err;
			value = _tmp$6;
			err = _tmp$7;
			return [value, err];
		}
		if (n > 0 && ((x = n - 1 >>> 0, ((x < 0 || x >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + x])) === 0)) {
			n = n - (1) >>> 0;
		}
		_tmp$8 = $bytesToString($subslice(buf, 0, n));
		_tmp$9 = $ifaceNil;
		value = _tmp$8;
		err = _tmp$9;
		return [value, err];
	};
	$pkg.Sysctl = Sysctl;
	nametomib = function(name) {
		var $ptr, _q, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, buf, bytes, err, mib, n, n$24ptr, name, p;
		mib = sliceType$5.nil;
		err = $ifaceNil;
		buf = arrayType$13.zero();
		n = 48;
		p = $sliceToArray(new sliceType(buf));
		_tuple = ByteSliceFromString(name);
		bytes = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = sliceType$5.nil;
			_tmp$1 = err;
			mib = _tmp;
			err = _tmp$1;
			return [mib, err];
		}
		err = sysctl(new sliceType$5([0, 3]), p, (n$24ptr || (n$24ptr = new ptrType$12(function() { return n; }, function($v) { n = $v; }))), $indexPtr(bytes.$array, bytes.$offset + 0, ptrType$2), (name.length >>> 0));
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp$2 = sliceType$5.nil;
			_tmp$3 = err;
			mib = _tmp$2;
			err = _tmp$3;
			return [mib, err];
		}
		_tmp$4 = $subslice(new sliceType$5(buf), 0, (_q = n / 4, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero")));
		_tmp$5 = $ifaceNil;
		mib = _tmp$4;
		err = _tmp$5;
		return [mib, err];
	};
	ParseDirent = function(buf, max, names) {
		var $ptr, _array, _struct, _tmp, _tmp$1, _tmp$2, _view, buf, bytes, consumed, count, dirent, max, name, names, newnames, origlen, x;
		consumed = 0;
		count = 0;
		newnames = sliceType$1.nil;
		origlen = buf.$length;
		while (true) {
			if (!(!((max === 0)) && buf.$length > 0)) { break; }
			dirent = (_array = $sliceToArray(buf), _struct = new Dirent.ptr(new $Uint64(0, 0), new $Uint64(0, 0), 0, 0, 0, arrayType$14.zero(), arrayType$15.zero()), _view = new DataView(_array.buffer, _array.byteOffset), _struct.Ino = new $Uint64(_view.getUint32(4, true), _view.getUint32(0, true)), _struct.Seekoff = new $Uint64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Reclen = _view.getUint16(16, true), _struct.Namlen = _view.getUint16(18, true), _struct.Type = _view.getUint8(20, true), _struct.Name = new ($nativeArray($kindInt8))(_array.buffer, $min(_array.byteOffset + 21, _array.buffer.byteLength)), _struct.Pad_cgo_0 = new ($nativeArray($kindUint8))(_array.buffer, $min(_array.byteOffset + 1045, _array.buffer.byteLength)), _struct);
			if (dirent.Reclen === 0) {
				buf = sliceType.nil;
				break;
			}
			buf = $subslice(buf, dirent.Reclen);
			if ((x = dirent.Ino, (x.$high === 0 && x.$low === 0))) {
				continue;
			}
			bytes = $sliceToArray(new sliceType(dirent.Name));
			name = $bytesToString($subslice(new sliceType(bytes), 0, dirent.Namlen));
			if (name === "." || name === "..") {
				continue;
			}
			max = max - (1) >> 0;
			count = count + (1) >> 0;
			names = $append(names, name);
		}
		_tmp = origlen - buf.$length >> 0;
		_tmp$1 = count;
		_tmp$2 = names;
		consumed = _tmp;
		count = _tmp$1;
		newnames = _tmp$2;
		return [consumed, count, newnames];
	};
	$pkg.ParseDirent = ParseDirent;
	mmapper.ptr.prototype.Mmap = function(fd, offset, length, prot, flags) {
		var $ptr, _key, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, addr, b, data, err, errno, fd, flags, length, m, offset, p, prot, sl, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; addr = $f.addr; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; fd = $f.fd; flags = $f.flags; length = $f.length; m = $f.m; offset = $f.offset; p = $f.p; prot = $f.prot; sl = $f.sl; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		sl = [sl];
		data = sliceType.nil;
		err = $ifaceNil;
		m = this;
		if (length <= 0) {
			_tmp = sliceType.nil;
			_tmp$1 = new Errno(22);
			data = _tmp;
			err = _tmp$1;
			$s = -1; return [data, err];
			return [data, err];
		}
		_r = m.mmap(0, (length >>> 0), prot, flags, fd, offset); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		addr = _tuple[0];
		errno = _tuple[1];
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = errno;
			data = _tmp$2;
			err = _tmp$3;
			$s = -1; return [data, err];
			return [data, err];
		}
		sl[0] = new structType.ptr(addr, length, length);
		b = sl[0];
		p = $indexPtr(b.$array, b.$offset + (b.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		_key = p; (m.active || $throwRuntimeError("assignment to entry in nil map"))[ptrType$2.keyFor(_key)] = { k: _key, v: b };
		_tmp$4 = b;
		_tmp$5 = $ifaceNil;
		data = _tmp$4;
		err = _tmp$5;
		$s = -1; return [data, err];
		return [data, err];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Mmap }; } $f.$ptr = $ptr; $f._key = _key; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.addr = addr; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.fd = fd; $f.flags = flags; $f.length = length; $f.m = m; $f.offset = offset; $f.p = p; $f.prot = prot; $f.sl = sl; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Mmap = function(fd, offset, length, prot, flags) { return this.$val.Mmap(fd, offset, length, prot, flags); };
	mmapper.ptr.prototype.Munmap = function(data) {
		var $ptr, _entry, _r, b, data, err, errno, m, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; m = $f.m; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		m = this;
		if ((data.$length === 0) || !((data.$length === data.$capacity))) {
			err = new Errno(22);
			$s = -1; return err;
			return err;
		}
		p = $indexPtr(data.$array, data.$offset + (data.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		b = (_entry = m.active[ptrType$2.keyFor(p)], _entry !== undefined ? _entry.v : sliceType.nil);
		if (b === sliceType.nil || !($indexPtr(b.$array, b.$offset + 0, ptrType$2) === $indexPtr(data.$array, data.$offset + 0, ptrType$2))) {
			err = new Errno(22);
			$s = -1; return err;
			return err;
		}
		_r = m.munmap($sliceToArray(b), (b.$length >>> 0)); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		errno = _r;
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			err = errno;
			$s = -1; return err;
			return err;
		}
		delete m.active[ptrType$2.keyFor(p)];
		err = $ifaceNil;
		$s = -1; return err;
		return err;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Munmap }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.m = m; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Munmap = function(data) { return this.$val.Munmap(data); };
	Errno.prototype.Error = function() {
		var $ptr, e, s;
		e = this.$val;
		if (0 <= (e >> 0) && (e >> 0) < 106) {
			s = ((e < 0 || e >= errors$1.length) ? $throwRuntimeError("index out of range") : errors$1[e]);
			if (!(s === "")) {
				return s;
			}
		}
		return "errno " + itoa((e >> 0));
	};
	$ptrType(Errno).prototype.Error = function() { return new Errno(this.$get()).Error(); };
	Errno.prototype.Temporary = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 4) || (e === 24) || (e === 54) || (e === 53) || new Errno(e).Timeout();
	};
	$ptrType(Errno).prototype.Temporary = function() { return new Errno(this.$get()).Temporary(); };
	Errno.prototype.Timeout = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 35) || (e === 35) || (e === 60);
	};
	$ptrType(Errno).prototype.Timeout = function() { return new Errno(this.$get()).Timeout(); };
	errnoErr = function(e) {
		var $ptr, _1, e;
		_1 = e;
		if (_1 === (0)) {
			return $ifaceNil;
		} else if (_1 === (35)) {
			return errEAGAIN;
		} else if (_1 === (22)) {
			return errEINVAL;
		} else if (_1 === (2)) {
			return errENOENT;
		}
		return new Errno(e);
	};
	Read = function(fd, p) {
		var $ptr, _tuple, err, fd, n, p;
		n = 0;
		err = $ifaceNil;
		_tuple = read(fd, p);
		n = _tuple[0];
		err = _tuple[1];
		if (false) {
			if (n > 0) {
				race.WriteRange($sliceToArray(p), n);
			}
			if ($interfaceIsEqual(err, $ifaceNil)) {
				race.Acquire((ioSync$24ptr || (ioSync$24ptr = new ptrType$20(function() { return ioSync; }, function($v) { ioSync = $v; }))));
			}
		}
		if (false && n > 0) {
			msanWrite($sliceToArray(p), n);
		}
		return [n, err];
	};
	$pkg.Read = Read;
	Write = function(fd, p) {
		var $ptr, _tuple, err, fd, n, p;
		n = 0;
		err = $ifaceNil;
		if (false) {
			race.ReleaseMerge((ioSync$24ptr || (ioSync$24ptr = new ptrType$20(function() { return ioSync; }, function($v) { ioSync = $v; }))));
		}
		_tuple = write(fd, p);
		n = _tuple[0];
		err = _tuple[1];
		if (false && n > 0) {
			race.ReadRange($sliceToArray(p), n);
		}
		if (false && n > 0) {
			msanRead($sliceToArray(p), n);
		}
		return [n, err];
	};
	$pkg.Write = Write;
	sysctl = function(mib, old, oldlen, new$1, newlen) {
		var $ptr, _p0, _tuple, e1, err, mib, new$1, newlen, old, oldlen;
		err = $ifaceNil;
		_p0 = 0;
		if (mib.$length > 0) {
			_p0 = $sliceToArray(mib);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(202, _p0, (mib.$length >>> 0), old, oldlen, new$1, newlen);
		e1 = _tuple[2];
		use(_p0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	Close = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(6, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Close = Close;
	Fchdir = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(13, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchdir = Fchdir;
	Fchmod = function(fd, mode) {
		var $ptr, _tuple, e1, err, fd, mode;
		err = $ifaceNil;
		_tuple = Syscall(124, (fd >>> 0), (mode >>> 0), 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchmod = Fchmod;
	Fchown = function(fd, uid, gid) {
		var $ptr, _tuple, e1, err, fd, gid, uid;
		err = $ifaceNil;
		_tuple = Syscall(123, (fd >>> 0), (uid >>> 0), (gid >>> 0));
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fchown = Fchown;
	Fstat = function(fd, stat) {
		var $ptr, _array, _struct, _tuple, _view, e1, err, fd, stat;
		err = $ifaceNil;
		_array = new Uint8Array(144);
		_tuple = Syscall(339, (fd >>> 0), _array, 0);
		_struct = stat, _view = new DataView(_array.buffer, _array.byteOffset), _struct.Dev = _view.getInt32(0, true), _struct.Mode = _view.getUint16(4, true), _struct.Nlink = _view.getUint16(6, true), _struct.Ino = new $Uint64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Uid = _view.getUint32(16, true), _struct.Gid = _view.getUint32(20, true), _struct.Rdev = _view.getInt32(24, true), _struct.Pad_cgo_0 = new ($nativeArray($kindUint8))(_array.buffer, $min(_array.byteOffset + 28, _array.buffer.byteLength)), _struct.Atimespec.Sec = new $Int64(_view.getUint32(36, true), _view.getUint32(32, true)), _struct.Atimespec.Nsec = new $Int64(_view.getUint32(44, true), _view.getUint32(40, true)), _struct.Mtimespec.Sec = new $Int64(_view.getUint32(52, true), _view.getUint32(48, true)), _struct.Mtimespec.Nsec = new $Int64(_view.getUint32(60, true), _view.getUint32(56, true)), _struct.Ctimespec.Sec = new $Int64(_view.getUint32(68, true), _view.getUint32(64, true)), _struct.Ctimespec.Nsec = new $Int64(_view.getUint32(76, true), _view.getUint32(72, true)), _struct.Birthtimespec.Sec = new $Int64(_view.getUint32(84, true), _view.getUint32(80, true)), _struct.Birthtimespec.Nsec = new $Int64(_view.getUint32(92, true), _view.getUint32(88, true)), _struct.Size = new $Int64(_view.getUint32(100, true), _view.getUint32(96, true)), _struct.Blocks = new $Int64(_view.getUint32(108, true), _view.getUint32(104, true)), _struct.Blksize = _view.getInt32(112, true), _struct.Flags = _view.getUint32(116, true), _struct.Gen = _view.getUint32(120, true), _struct.Lspare = _view.getInt32(124, true), _struct.Qspare = new ($nativeArray($kindInt64))(_array.buffer, $min(_array.byteOffset + 128, _array.buffer.byteLength));
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fstat = Fstat;
	Fsync = function(fd) {
		var $ptr, _tuple, e1, err, fd;
		err = $ifaceNil;
		_tuple = Syscall(95, (fd >>> 0), 0, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Fsync = Fsync;
	Ftruncate = function(fd, length) {
		var $ptr, _tuple, e1, err, fd, length;
		err = $ifaceNil;
		_tuple = Syscall(201, (fd >>> 0), (length.$low >>> 0), 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Ftruncate = Ftruncate;
	Getdirentries = function(fd, buf, basep) {
		var $ptr, _p0, _tuple, basep, buf, e1, err, fd, n, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (buf.$length > 0) {
			_p0 = $sliceToArray(buf);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(344, (fd >>> 0), _p0, (buf.$length >>> 0), basep, 0, 0);
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Getdirentries = Getdirentries;
	Lstat = function(path, stat) {
		var $ptr, _array, _p0, _struct, _tuple, _tuple$1, _view, e1, err, path, stat;
		err = $ifaceNil;
		_p0 = ptrType$2.nil;
		_tuple = BytePtrFromString(path);
		_p0 = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		_array = new Uint8Array(144);
		_tuple$1 = Syscall(340, _p0, _array, 0);
		_struct = stat, _view = new DataView(_array.buffer, _array.byteOffset), _struct.Dev = _view.getInt32(0, true), _struct.Mode = _view.getUint16(4, true), _struct.Nlink = _view.getUint16(6, true), _struct.Ino = new $Uint64(_view.getUint32(12, true), _view.getUint32(8, true)), _struct.Uid = _view.getUint32(16, true), _struct.Gid = _view.getUint32(20, true), _struct.Rdev = _view.getInt32(24, true), _struct.Pad_cgo_0 = new ($nativeArray($kindUint8))(_array.buffer, $min(_array.byteOffset + 28, _array.buffer.byteLength)), _struct.Atimespec.Sec = new $Int64(_view.getUint32(36, true), _view.getUint32(32, true)), _struct.Atimespec.Nsec = new $Int64(_view.getUint32(44, true), _view.getUint32(40, true)), _struct.Mtimespec.Sec = new $Int64(_view.getUint32(52, true), _view.getUint32(48, true)), _struct.Mtimespec.Nsec = new $Int64(_view.getUint32(60, true), _view.getUint32(56, true)), _struct.Ctimespec.Sec = new $Int64(_view.getUint32(68, true), _view.getUint32(64, true)), _struct.Ctimespec.Nsec = new $Int64(_view.getUint32(76, true), _view.getUint32(72, true)), _struct.Birthtimespec.Sec = new $Int64(_view.getUint32(84, true), _view.getUint32(80, true)), _struct.Birthtimespec.Nsec = new $Int64(_view.getUint32(92, true), _view.getUint32(88, true)), _struct.Size = new $Int64(_view.getUint32(100, true), _view.getUint32(96, true)), _struct.Blocks = new $Int64(_view.getUint32(108, true), _view.getUint32(104, true)), _struct.Blksize = _view.getInt32(112, true), _struct.Flags = _view.getUint32(116, true), _struct.Gen = _view.getUint32(120, true), _struct.Lspare = _view.getInt32(124, true), _struct.Qspare = new ($nativeArray($kindInt64))(_array.buffer, $min(_array.byteOffset + 128, _array.buffer.byteLength));
		e1 = _tuple$1[2];
		use(_p0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	$pkg.Lstat = Lstat;
	Pread = function(fd, p, offset) {
		var $ptr, _p0, _tuple, e1, err, fd, n, offset, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(153, (fd >>> 0), _p0, (p.$length >>> 0), (offset.$low >>> 0), 0, 0);
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Pread = Pread;
	Pwrite = function(fd, p, offset) {
		var $ptr, _p0, _tuple, e1, err, fd, n, offset, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall6(154, (fd >>> 0), _p0, (p.$length >>> 0), (offset.$low >>> 0), 0, 0);
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	$pkg.Pwrite = Pwrite;
	read = function(fd, p) {
		var $ptr, _p0, _tuple, e1, err, fd, n, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall(3, (fd >>> 0), _p0, (p.$length >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	Seek = function(fd, offset, whence) {
		var $ptr, _tuple, e1, err, fd, newoffset, offset, r0, whence;
		newoffset = new $Int64(0, 0);
		err = $ifaceNil;
		_tuple = Syscall(199, (fd >>> 0), (offset.$low >>> 0), (whence >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		newoffset = new $Int64(0, r0.constructor === Number ? r0 : 1);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [newoffset, err];
	};
	$pkg.Seek = Seek;
	write = function(fd, p) {
		var $ptr, _p0, _tuple, e1, err, fd, n, p, r0;
		n = 0;
		err = $ifaceNil;
		_p0 = 0;
		if (p.$length > 0) {
			_p0 = $sliceToArray(p);
		} else {
			_p0 = new Uint8Array(0);
		}
		_tuple = Syscall(4, (fd >>> 0), _p0, (p.$length >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		n = (r0 >> 0);
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [n, err];
	};
	mmap = function(addr, length, prot, flag, fd, pos) {
		var $ptr, _tuple, addr, e1, err, fd, flag, length, pos, prot, r0, ret;
		ret = 0;
		err = $ifaceNil;
		_tuple = Syscall6(197, addr, length, (prot >>> 0), (flag >>> 0), (fd >>> 0), (pos.$low >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		ret = r0;
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [ret, err];
	};
	munmap = function(addr, length) {
		var $ptr, _tuple, addr, e1, err, length;
		err = $ifaceNil;
		_tuple = Syscall(73, addr, length, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	ptrType$27.methods = [{prop: "Mmap", name: "Mmap", pkg: "", typ: $funcType([$Int, $Int64, $Int, $Int, $Int], [sliceType, $error], false)}, {prop: "Munmap", name: "Munmap", pkg: "", typ: $funcType([sliceType], [$error], false)}];
	Errno.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Temporary", name: "Temporary", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $funcType([], [$Bool], false)}];
	ptrType$31.methods = [{prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64, $Int64], false)}, {prop: "Nano", name: "Nano", pkg: "", typ: $funcType([], [$Int64], false)}];
	mmapper.init("syscall", [{prop: "Mutex", name: "", exported: true, typ: sync.Mutex, tag: ""}, {prop: "active", name: "active", exported: false, typ: mapType, tag: ""}, {prop: "mmap", name: "mmap", exported: false, typ: funcType, tag: ""}, {prop: "munmap", name: "munmap", exported: false, typ: funcType$1, tag: ""}]);
	Timespec.init("", [{prop: "Sec", name: "Sec", exported: true, typ: $Int64, tag: ""}, {prop: "Nsec", name: "Nsec", exported: true, typ: $Int64, tag: ""}]);
	Stat_t.init("", [{prop: "Dev", name: "Dev", exported: true, typ: $Int32, tag: ""}, {prop: "Mode", name: "Mode", exported: true, typ: $Uint16, tag: ""}, {prop: "Nlink", name: "Nlink", exported: true, typ: $Uint16, tag: ""}, {prop: "Ino", name: "Ino", exported: true, typ: $Uint64, tag: ""}, {prop: "Uid", name: "Uid", exported: true, typ: $Uint32, tag: ""}, {prop: "Gid", name: "Gid", exported: true, typ: $Uint32, tag: ""}, {prop: "Rdev", name: "Rdev", exported: true, typ: $Int32, tag: ""}, {prop: "Pad_cgo_0", name: "Pad_cgo_0", exported: true, typ: arrayType$1, tag: ""}, {prop: "Atimespec", name: "Atimespec", exported: true, typ: Timespec, tag: ""}, {prop: "Mtimespec", name: "Mtimespec", exported: true, typ: Timespec, tag: ""}, {prop: "Ctimespec", name: "Ctimespec", exported: true, typ: Timespec, tag: ""}, {prop: "Birthtimespec", name: "Birthtimespec", exported: true, typ: Timespec, tag: ""}, {prop: "Size", name: "Size", exported: true, typ: $Int64, tag: ""}, {prop: "Blocks", name: "Blocks", exported: true, typ: $Int64, tag: ""}, {prop: "Blksize", name: "Blksize", exported: true, typ: $Int32, tag: ""}, {prop: "Flags", name: "Flags", exported: true, typ: $Uint32, tag: ""}, {prop: "Gen", name: "Gen", exported: true, typ: $Uint32, tag: ""}, {prop: "Lspare", name: "Lspare", exported: true, typ: $Int32, tag: ""}, {prop: "Qspare", name: "Qspare", exported: true, typ: arrayType$17, tag: ""}]);
	Dirent.init("", [{prop: "Ino", name: "Ino", exported: true, typ: $Uint64, tag: ""}, {prop: "Seekoff", name: "Seekoff", exported: true, typ: $Uint64, tag: ""}, {prop: "Reclen", name: "Reclen", exported: true, typ: $Uint16, tag: ""}, {prop: "Namlen", name: "Namlen", exported: true, typ: $Uint16, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: $Uint8, tag: ""}, {prop: "Name", name: "Name", exported: true, typ: arrayType$14, tag: ""}, {prop: "Pad_cgo_0", name: "Pad_cgo_0", exported: true, typ: arrayType$15, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		lineBuffer = sliceType.nil;
		syscallModule = null;
		envOnce = new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0);
		envLock = new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0);
		env = false;
		freebsdConfArch = "";
		ioSync = new $Int64(0, 0);
		warningPrinted = false;
		alreadyTriedToLoad = false;
		minusOne = -1;
		envs = runtime_envs();
		$pkg.Stdin = 0;
		$pkg.Stdout = 1;
		$pkg.Stderr = 2;
		errEAGAIN = new Errno(35);
		errEINVAL = new Errno(22);
		errENOENT = new Errno(2);
		errors$1 = $toNativeArray($kindString, ["", "operation not permitted", "no such file or directory", "no such process", "interrupted system call", "input/output error", "device not configured", "argument list too long", "exec format error", "bad file descriptor", "no child processes", "resource deadlock avoided", "cannot allocate memory", "permission denied", "bad address", "block device required", "resource busy", "file exists", "cross-device link", "operation not supported by device", "not a directory", "is a directory", "invalid argument", "too many open files in system", "too many open files", "inappropriate ioctl for device", "text file busy", "file too large", "no space left on device", "illegal seek", "read-only file system", "too many links", "broken pipe", "numerical argument out of domain", "result too large", "resource temporarily unavailable", "operation now in progress", "operation already in progress", "socket operation on non-socket", "destination address required", "message too long", "protocol wrong type for socket", "protocol not available", "protocol not supported", "socket type not supported", "operation not supported", "protocol family not supported", "address family not supported by protocol family", "address already in use", "can't assign requested address", "network is down", "network is unreachable", "network dropped connection on reset", "software caused connection abort", "connection reset by peer", "no buffer space available", "socket is already connected", "socket is not connected", "can't send after socket shutdown", "too many references: can't splice", "operation timed out", "connection refused", "too many levels of symbolic links", "file name too long", "host is down", "no route to host", "directory not empty", "too many processes", "too many users", "disc quota exceeded", "stale NFS file handle", "too many levels of remote in path", "RPC struct is bad", "RPC version wrong", "RPC prog. not avail", "program version wrong", "bad procedure for program", "no locks available", "function not implemented", "inappropriate file type or format", "authentication error", "need authenticator", "device power is off", "device error", "value too large to be stored in data type", "bad executable (or shared library)", "bad CPU type in executable", "shared library version mismatch", "malformed Mach-o file", "operation canceled", "identifier removed", "no message of desired type", "illegal byte sequence", "attribute not found", "bad message", "EMULTIHOP (Reserved)", "no message available on STREAM", "ENOLINK (Reserved)", "no STREAM resources", "not a STREAM", "protocol error", "STREAM ioctl timeout", "operation not supported on socket", "policy not found", "state not recoverable", "previous owner died"]);
		mapper = new mmapper.ptr(new sync.Mutex.ptr(0, 0), {}, mmap, munmap);
		minRoutingSockaddrLen = rsaAlignOf(0);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Mutex, Once, ptrType, funcType, ptrType$3;
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "nosync.Mutex", true, "github.com/gopherjs/gopherjs/nosync", true, function(locked_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.locked = false;
			return;
		}
		this.locked = locked_;
	});
	Once = $pkg.Once = $newType(0, $kindStruct, "nosync.Once", true, "github.com/gopherjs/gopherjs/nosync", true, function(doing_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.doing = false;
			this.done = false;
			return;
		}
		this.doing = doing_;
		this.done = done_;
	});
	ptrType = $ptrType(Mutex);
	funcType = $funcType([], [], false);
	ptrType$3 = $ptrType(Once);
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, m;
		m = this;
		if (m.locked) {
			$panic(new $String("nosync: mutex is already locked"));
		}
		m.locked = true;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m;
		m = this;
		if (!m.locked) {
			$panic(new $String("nosync: unlock of unlocked mutex"));
		}
		m.locked = false;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = [o];
		o[0] = this;
		if (o[0].done) {
			$s = -1; return;
			return;
		}
		if (o[0].doing) {
			$panic(new $String("nosync: Do called within f"));
		}
		o[0].doing = true;
		$deferred.push([(function(o) { return function() {
			var $ptr;
			o[0].doing = false;
			o[0].done = true;
		}; })(o), []]);
		$r = f(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	ptrType.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$3.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType], [], false)}];
	Mutex.init("github.com/gopherjs/gopherjs/nosync", [{prop: "locked", name: "locked", exported: false, typ: $Bool, tag: ""}]);
	Once.init("github.com/gopherjs/gopherjs/nosync", [{prop: "doing", name: "doing", exported: false, typ: $Bool, tag: ""}, {prop: "done", name: "done", exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["time"] = (function() {
	var $pkg = {}, $init, errors, js, nosync, runtime, syscall, ParseError, Time, Month, Weekday, Duration, Location, zone, zoneTrans, sliceType, sliceType$1, ptrType, sliceType$2, arrayType, sliceType$3, arrayType$1, arrayType$2, ptrType$1, arrayType$4, ptrType$3, ptrType$6, std0x, longDayNames, shortDayNames, shortMonthNames, longMonthNames, atoiError, errBad, errLeadingInt, months, days, daysBefore, utcLoc, utcLoc$24ptr, localLoc, localLoc$24ptr, localOnce, zoneinfo, badData, _tuple, _r, init, initLocal, runtimeNano, now, indexByte, startsWithLowerCase, nextStdChunk, match, lookup, appendInt, atoi, formatNano, quote, isDigit, getnum, cutspace, skip, Parse, parse, parseTimeZone, parseGMT, parseNanoseconds, leadingInt, absWeekday, absClock, fmtFrac, fmtInt, Since, absDate, daysIn, Now, Unix, isLeap, norm, Date, div, FixedZone;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	runtime = $packages["runtime"];
	syscall = $packages["syscall"];
	ParseError = $pkg.ParseError = $newType(0, $kindStruct, "time.ParseError", true, "time", true, function(Layout_, Value_, LayoutElem_, ValueElem_, Message_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Layout = "";
			this.Value = "";
			this.LayoutElem = "";
			this.ValueElem = "";
			this.Message = "";
			return;
		}
		this.Layout = Layout_;
		this.Value = Value_;
		this.LayoutElem = LayoutElem_;
		this.ValueElem = ValueElem_;
		this.Message = Message_;
	});
	Time = $pkg.Time = $newType(0, $kindStruct, "time.Time", true, "time", true, function(sec_, nsec_, loc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sec = new $Int64(0, 0);
			this.nsec = 0;
			this.loc = ptrType$1.nil;
			return;
		}
		this.sec = sec_;
		this.nsec = nsec_;
		this.loc = loc_;
	});
	Month = $pkg.Month = $newType(4, $kindInt, "time.Month", true, "time", true, null);
	Weekday = $pkg.Weekday = $newType(4, $kindInt, "time.Weekday", true, "time", true, null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "time.Duration", true, "time", true, null);
	Location = $pkg.Location = $newType(0, $kindStruct, "time.Location", true, "time", true, function(name_, zone_, tx_, cacheStart_, cacheEnd_, cacheZone_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.zone = sliceType.nil;
			this.tx = sliceType$1.nil;
			this.cacheStart = new $Int64(0, 0);
			this.cacheEnd = new $Int64(0, 0);
			this.cacheZone = ptrType.nil;
			return;
		}
		this.name = name_;
		this.zone = zone_;
		this.tx = tx_;
		this.cacheStart = cacheStart_;
		this.cacheEnd = cacheEnd_;
		this.cacheZone = cacheZone_;
	});
	zone = $pkg.zone = $newType(0, $kindStruct, "time.zone", true, "time", false, function(name_, offset_, isDST_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.offset = 0;
			this.isDST = false;
			return;
		}
		this.name = name_;
		this.offset = offset_;
		this.isDST = isDST_;
	});
	zoneTrans = $pkg.zoneTrans = $newType(0, $kindStruct, "time.zoneTrans", true, "time", false, function(when_, index_, isstd_, isutc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.when = new $Int64(0, 0);
			this.index = 0;
			this.isstd = false;
			this.isutc = false;
			return;
		}
		this.when = when_;
		this.index = index_;
		this.isstd = isstd_;
		this.isutc = isutc_;
	});
	sliceType = $sliceType(zone);
	sliceType$1 = $sliceType(zoneTrans);
	ptrType = $ptrType(zone);
	sliceType$2 = $sliceType($String);
	arrayType = $arrayType($Uint8, 20);
	sliceType$3 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 9);
	arrayType$2 = $arrayType($Uint8, 64);
	ptrType$1 = $ptrType(Location);
	arrayType$4 = $arrayType($Uint8, 32);
	ptrType$3 = $ptrType(ParseError);
	ptrType$6 = $ptrType(Time);
	init = function() {
		var $ptr;
		Unix(new $Int64(0, 0), new $Int64(0, 0));
	};
	initLocal = function() {
		var $ptr, d, i, j, s;
		d = new ($global.Date)();
		s = $internalize(d, $String);
		i = indexByte(s, 40);
		j = indexByte(s, 41);
		if ((i === -1) || (j === -1)) {
			localLoc.name = "UTC";
			return;
		}
		localLoc.name = $substring(s, (i + 1 >> 0), j);
		localLoc.zone = new sliceType([new zone.ptr(localLoc.name, $imul(($parseInt(d.getTimezoneOffset()) >> 0), -60), false)]);
	};
	runtimeNano = function() {
		var $ptr;
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	now = function() {
		var $ptr, _tmp, _tmp$1, n, nsec, sec, x;
		sec = new $Int64(0, 0);
		nsec = 0;
		n = runtimeNano();
		_tmp = $div64(n, new $Int64(0, 1000000000), false);
		_tmp$1 = ((x = $div64(n, new $Int64(0, 1000000000), true), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		sec = _tmp;
		nsec = _tmp$1;
		return [sec, nsec];
	};
	indexByte = function(s, c) {
		var $ptr, c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	startsWithLowerCase = function(str) {
		var $ptr, c, str;
		if (str.length === 0) {
			return false;
		}
		c = str.charCodeAt(0);
		return 97 <= c && c <= 122;
	};
	nextStdChunk = function(layout) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$51, _tmp$52, _tmp$53, _tmp$54, _tmp$55, _tmp$56, _tmp$57, _tmp$58, _tmp$59, _tmp$6, _tmp$60, _tmp$61, _tmp$62, _tmp$63, _tmp$64, _tmp$65, _tmp$66, _tmp$67, _tmp$68, _tmp$69, _tmp$7, _tmp$70, _tmp$71, _tmp$72, _tmp$73, _tmp$74, _tmp$75, _tmp$76, _tmp$77, _tmp$78, _tmp$79, _tmp$8, _tmp$80, _tmp$81, _tmp$82, _tmp$83, _tmp$84, _tmp$85, _tmp$86, _tmp$9, c, ch, i, j, layout, prefix, std, std$1, suffix, x;
		prefix = "";
		std = 0;
		suffix = "";
		i = 0;
		while (true) {
			if (!(i < layout.length)) { break; }
			c = (layout.charCodeAt(i) >> 0);
			_1 = c;
			if (_1 === (74)) {
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Jan") {
					if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "January") {
						_tmp = $substring(layout, 0, i);
						_tmp$1 = 257;
						_tmp$2 = $substring(layout, (i + 7 >> 0));
						prefix = _tmp;
						std = _tmp$1;
						suffix = _tmp$2;
						return [prefix, std, suffix];
					}
					if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
						_tmp$3 = $substring(layout, 0, i);
						_tmp$4 = 258;
						_tmp$5 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$3;
						std = _tmp$4;
						suffix = _tmp$5;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (77)) {
				if (layout.length >= (i + 3 >> 0)) {
					if ($substring(layout, i, (i + 3 >> 0)) === "Mon") {
						if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Monday") {
							_tmp$6 = $substring(layout, 0, i);
							_tmp$7 = 261;
							_tmp$8 = $substring(layout, (i + 6 >> 0));
							prefix = _tmp$6;
							std = _tmp$7;
							suffix = _tmp$8;
							return [prefix, std, suffix];
						}
						if (!startsWithLowerCase($substring(layout, (i + 3 >> 0)))) {
							_tmp$9 = $substring(layout, 0, i);
							_tmp$10 = 262;
							_tmp$11 = $substring(layout, (i + 3 >> 0));
							prefix = _tmp$9;
							std = _tmp$10;
							suffix = _tmp$11;
							return [prefix, std, suffix];
						}
					}
					if ($substring(layout, i, (i + 3 >> 0)) === "MST") {
						_tmp$12 = $substring(layout, 0, i);
						_tmp$13 = 21;
						_tmp$14 = $substring(layout, (i + 3 >> 0));
						prefix = _tmp$12;
						std = _tmp$13;
						suffix = _tmp$14;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === (48)) {
				if (layout.length >= (i + 2 >> 0) && 49 <= layout.charCodeAt((i + 1 >> 0)) && layout.charCodeAt((i + 1 >> 0)) <= 54) {
					_tmp$15 = $substring(layout, 0, i);
					_tmp$16 = (x = layout.charCodeAt((i + 1 >> 0)) - 49 << 24 >>> 24, ((x < 0 || x >= std0x.length) ? $throwRuntimeError("index out of range") : std0x[x]));
					_tmp$17 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$15;
					std = _tmp$16;
					suffix = _tmp$17;
					return [prefix, std, suffix];
				}
			} else if (_1 === (49)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 53)) {
					_tmp$18 = $substring(layout, 0, i);
					_tmp$19 = 522;
					_tmp$20 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$18;
					std = _tmp$19;
					suffix = _tmp$20;
					return [prefix, std, suffix];
				}
				_tmp$21 = $substring(layout, 0, i);
				_tmp$22 = 259;
				_tmp$23 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$21;
				std = _tmp$22;
				suffix = _tmp$23;
				return [prefix, std, suffix];
			} else if (_1 === (50)) {
				if (layout.length >= (i + 4 >> 0) && $substring(layout, i, (i + 4 >> 0)) === "2006") {
					_tmp$24 = $substring(layout, 0, i);
					_tmp$25 = 273;
					_tmp$26 = $substring(layout, (i + 4 >> 0));
					prefix = _tmp$24;
					std = _tmp$25;
					suffix = _tmp$26;
					return [prefix, std, suffix];
				}
				_tmp$27 = $substring(layout, 0, i);
				_tmp$28 = 263;
				_tmp$29 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$27;
				std = _tmp$28;
				suffix = _tmp$29;
				return [prefix, std, suffix];
			} else if (_1 === (95)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 50)) {
					if (layout.length >= (i + 5 >> 0) && $substring(layout, (i + 1 >> 0), (i + 5 >> 0)) === "2006") {
						_tmp$30 = $substring(layout, 0, (i + 1 >> 0));
						_tmp$31 = 273;
						_tmp$32 = $substring(layout, (i + 5 >> 0));
						prefix = _tmp$30;
						std = _tmp$31;
						suffix = _tmp$32;
						return [prefix, std, suffix];
					}
					_tmp$33 = $substring(layout, 0, i);
					_tmp$34 = 264;
					_tmp$35 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$33;
					std = _tmp$34;
					suffix = _tmp$35;
					return [prefix, std, suffix];
				}
			} else if (_1 === (51)) {
				_tmp$36 = $substring(layout, 0, i);
				_tmp$37 = 523;
				_tmp$38 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$36;
				std = _tmp$37;
				suffix = _tmp$38;
				return [prefix, std, suffix];
			} else if (_1 === (52)) {
				_tmp$39 = $substring(layout, 0, i);
				_tmp$40 = 525;
				_tmp$41 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$39;
				std = _tmp$40;
				suffix = _tmp$41;
				return [prefix, std, suffix];
			} else if (_1 === (53)) {
				_tmp$42 = $substring(layout, 0, i);
				_tmp$43 = 527;
				_tmp$44 = $substring(layout, (i + 1 >> 0));
				prefix = _tmp$42;
				std = _tmp$43;
				suffix = _tmp$44;
				return [prefix, std, suffix];
			} else if (_1 === (80)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 77)) {
					_tmp$45 = $substring(layout, 0, i);
					_tmp$46 = 531;
					_tmp$47 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$45;
					std = _tmp$46;
					suffix = _tmp$47;
					return [prefix, std, suffix];
				}
			} else if (_1 === (112)) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 109)) {
					_tmp$48 = $substring(layout, 0, i);
					_tmp$49 = 532;
					_tmp$50 = $substring(layout, (i + 2 >> 0));
					prefix = _tmp$48;
					std = _tmp$49;
					suffix = _tmp$50;
					return [prefix, std, suffix];
				}
			} else if (_1 === (45)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "-070000") {
					_tmp$51 = $substring(layout, 0, i);
					_tmp$52 = 28;
					_tmp$53 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$51;
					std = _tmp$52;
					suffix = _tmp$53;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "-07:00:00") {
					_tmp$54 = $substring(layout, 0, i);
					_tmp$55 = 31;
					_tmp$56 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$54;
					std = _tmp$55;
					suffix = _tmp$56;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "-0700") {
					_tmp$57 = $substring(layout, 0, i);
					_tmp$58 = 27;
					_tmp$59 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$57;
					std = _tmp$58;
					suffix = _tmp$59;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "-07:00") {
					_tmp$60 = $substring(layout, 0, i);
					_tmp$61 = 30;
					_tmp$62 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$60;
					std = _tmp$61;
					suffix = _tmp$62;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "-07") {
					_tmp$63 = $substring(layout, 0, i);
					_tmp$64 = 29;
					_tmp$65 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$63;
					std = _tmp$64;
					suffix = _tmp$65;
					return [prefix, std, suffix];
				}
			} else if (_1 === (90)) {
				if (layout.length >= (i + 7 >> 0) && $substring(layout, i, (i + 7 >> 0)) === "Z070000") {
					_tmp$66 = $substring(layout, 0, i);
					_tmp$67 = 23;
					_tmp$68 = $substring(layout, (i + 7 >> 0));
					prefix = _tmp$66;
					std = _tmp$67;
					suffix = _tmp$68;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && $substring(layout, i, (i + 9 >> 0)) === "Z07:00:00") {
					_tmp$69 = $substring(layout, 0, i);
					_tmp$70 = 26;
					_tmp$71 = $substring(layout, (i + 9 >> 0));
					prefix = _tmp$69;
					std = _tmp$70;
					suffix = _tmp$71;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && $substring(layout, i, (i + 5 >> 0)) === "Z0700") {
					_tmp$72 = $substring(layout, 0, i);
					_tmp$73 = 22;
					_tmp$74 = $substring(layout, (i + 5 >> 0));
					prefix = _tmp$72;
					std = _tmp$73;
					suffix = _tmp$74;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && $substring(layout, i, (i + 6 >> 0)) === "Z07:00") {
					_tmp$75 = $substring(layout, 0, i);
					_tmp$76 = 25;
					_tmp$77 = $substring(layout, (i + 6 >> 0));
					prefix = _tmp$75;
					std = _tmp$76;
					suffix = _tmp$77;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && $substring(layout, i, (i + 3 >> 0)) === "Z07") {
					_tmp$78 = $substring(layout, 0, i);
					_tmp$79 = 24;
					_tmp$80 = $substring(layout, (i + 3 >> 0));
					prefix = _tmp$78;
					std = _tmp$79;
					suffix = _tmp$80;
					return [prefix, std, suffix];
				}
			} else if (_1 === (46)) {
				if ((i + 1 >> 0) < layout.length && ((layout.charCodeAt((i + 1 >> 0)) === 48) || (layout.charCodeAt((i + 1 >> 0)) === 57))) {
					ch = layout.charCodeAt((i + 1 >> 0));
					j = i + 1 >> 0;
					while (true) {
						if (!(j < layout.length && (layout.charCodeAt(j) === ch))) { break; }
						j = j + (1) >> 0;
					}
					if (!isDigit(layout, j)) {
						std$1 = 32;
						if (layout.charCodeAt((i + 1 >> 0)) === 57) {
							std$1 = 33;
						}
						std$1 = std$1 | ((((j - ((i + 1 >> 0)) >> 0)) << 16 >> 0));
						_tmp$81 = $substring(layout, 0, i);
						_tmp$82 = std$1;
						_tmp$83 = $substring(layout, j);
						prefix = _tmp$81;
						std = _tmp$82;
						suffix = _tmp$83;
						return [prefix, std, suffix];
					}
				}
			}
			i = i + (1) >> 0;
		}
		_tmp$84 = layout;
		_tmp$85 = 0;
		_tmp$86 = "";
		prefix = _tmp$84;
		std = _tmp$85;
		suffix = _tmp$86;
		return [prefix, std, suffix];
	};
	match = function(s1, s2) {
		var $ptr, c1, c2, i, s1, s2;
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			c2 = s2.charCodeAt(i);
			if (!((c1 === c2))) {
				c1 = (c1 | (32)) >>> 0;
				c2 = (c2 | (32)) >>> 0;
				if (!((c1 === c2)) || c1 < 97 || c1 > 122) {
					return false;
				}
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	lookup = function(tab, val) {
		var $ptr, _i, _ref, i, tab, v, val;
		_ref = tab;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (val.length >= v.length && match($substring(val, 0, v.length), v)) {
				return [i, $substring(val, v.length), $ifaceNil];
			}
			_i++;
		}
		return [-1, val, errBad];
	};
	appendInt = function(b, x, width) {
		var $ptr, _q, b, buf, i, q, u, w, width, x;
		u = (x >>> 0);
		if (x < 0) {
			b = $append(b, 45);
			u = (-x >>> 0);
		}
		buf = arrayType.zero();
		i = 20;
		while (true) {
			if (!(u >= 10)) { break; }
			i = i - (1) >> 0;
			q = (_q = u / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((48 + u >>> 0) - (q * 10 >>> 0) >>> 0) << 24 >>> 24));
			u = q;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((48 + u >>> 0) << 24 >>> 24));
		w = 20 - i >> 0;
		while (true) {
			if (!(w < width)) { break; }
			b = $append(b, 48);
			w = w + (1) >> 0;
		}
		return $appendSlice(b, $subslice(new sliceType$3(buf), i));
	};
	atoi = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple$1, err, neg, q, rem, s, x;
		x = 0;
		err = $ifaceNil;
		neg = false;
		if (!(s === "") && ((s.charCodeAt(0) === 45) || (s.charCodeAt(0) === 43))) {
			neg = s.charCodeAt(0) === 45;
			s = $substring(s, 1);
		}
		_tuple$1 = leadingInt(s);
		q = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		x = ((q.$low + ((q.$high >> 31) * 4294967296)) >> 0);
		if (!($interfaceIsEqual(err, $ifaceNil)) || !(rem === "")) {
			_tmp = 0;
			_tmp$1 = atoiError;
			x = _tmp;
			err = _tmp$1;
			return [x, err];
		}
		if (neg) {
			x = -x;
		}
		_tmp$2 = x;
		_tmp$3 = $ifaceNil;
		x = _tmp$2;
		err = _tmp$3;
		return [x, err];
	};
	formatNano = function(b, nanosec, n, trim) {
		var $ptr, _q, _r$1, b, buf, n, nanosec, start, trim, u, x;
		u = nanosec;
		buf = arrayType$1.zero();
		start = 9;
		while (true) {
			if (!(start > 0)) { break; }
			start = start - (1) >> 0;
			((start < 0 || start >= buf.length) ? $throwRuntimeError("index out of range") : buf[start] = (((_r$1 = u % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			u = (_q = u / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		if (n > 9) {
			n = 9;
		}
		if (trim) {
			while (true) {
				if (!(n > 0 && ((x = n - 1 >> 0, ((x < 0 || x >= buf.length) ? $throwRuntimeError("index out of range") : buf[x])) === 48))) { break; }
				n = n - (1) >> 0;
			}
			if (n === 0) {
				return b;
			}
		}
		b = $append(b, 46);
		return $appendSlice(b, $subslice(new sliceType$3(buf), 0, n));
	};
	Time.ptr.prototype.String = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Format("2006-01-02 15:04:05.999999999 -0700 MST"); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.String = function() { return this.$val.String(); };
	Time.ptr.prototype.Format = function(layout) {
		var $ptr, _r$1, b, buf, layout, max, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; b = $f.b; buf = $f.buf; layout = $f.layout; max = $f.max; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		b = sliceType$3.nil;
		max = layout.length + 10 >> 0;
		if (max < 64) {
			buf = arrayType$2.zero();
			b = $subslice(new sliceType$3(buf), 0, 0);
		} else {
			b = $makeSlice(sliceType$3, 0, max);
		}
		_r$1 = t.AppendFormat(b, layout); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		$s = -1; return $bytesToString(b);
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Format }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.b = b; $f.buf = buf; $f.layout = layout; $f.max = max; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Format = function(layout) { return this.$val.Format(layout); };
	Time.ptr.prototype.AppendFormat = function(b, layout) {
		var $ptr, _1, _q, _q$1, _q$2, _q$3, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tuple$1, _tuple$2, _tuple$3, _tuple$4, abs, absoffset, b, day, hour, hr, hr$1, layout, m, min, month, name, offset, prefix, s, sec, std, suffix, t, y, year, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; abs = $f.abs; absoffset = $f.absoffset; b = $f.b; day = $f.day; hour = $f.hour; hr = $f.hr; hr$1 = $f.hr$1; layout = $f.layout; m = $f.m; min = $f.min; month = $f.month; name = $f.name; offset = $f.offset; prefix = $f.prefix; s = $f.s; sec = $f.sec; std = $f.std; suffix = $f.suffix; t = $f.t; y = $f.y; year = $f.year; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.locabs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		abs = _tuple$1[2];
		year = -1;
		month = 0;
		day = 0;
		hour = -1;
		min = 0;
		sec = 0;
		while (true) {
			if (!(!(layout === ""))) { break; }
			_tuple$2 = nextStdChunk(layout);
			prefix = _tuple$2[0];
			std = _tuple$2[1];
			suffix = _tuple$2[2];
			if (!(prefix === "")) {
				b = $appendSlice(b, prefix);
			}
			if (std === 0) {
				break;
			}
			layout = suffix;
			if (year < 0 && !(((std & 256) === 0))) {
				_tuple$3 = absDate(abs, true);
				year = _tuple$3[0];
				month = _tuple$3[1];
				day = _tuple$3[2];
			}
			if (hour < 0 && !(((std & 512) === 0))) {
				_tuple$4 = absClock(abs);
				hour = _tuple$4[0];
				min = _tuple$4[1];
				sec = _tuple$4[2];
			}
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					y = year;
					if (y < 0) {
						y = -y;
					}
					b = appendInt(b, (_r$2 = y % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")), 2);
				} else if (_1 === (273)) {
					b = appendInt(b, year, 4);
				} else if (_1 === (258)) {
					b = $appendSlice(b, $substring(new Month(month).String(), 0, 3));
				} else if (_1 === (257)) {
					m = new Month(month).String();
					b = $appendSlice(b, m);
				} else if (_1 === (259)) {
					b = appendInt(b, (month >> 0), 0);
				} else if (_1 === (260)) {
					b = appendInt(b, (month >> 0), 2);
				} else if (_1 === (262)) {
					b = $appendSlice(b, $substring(new Weekday(absWeekday(abs)).String(), 0, 3));
				} else if (_1 === (261)) {
					s = new Weekday(absWeekday(abs)).String();
					b = $appendSlice(b, s);
				} else if (_1 === (263)) {
					b = appendInt(b, day, 0);
				} else if (_1 === (264)) {
					if (day < 10) {
						b = $append(b, 32);
					}
					b = appendInt(b, day, 0);
				} else if (_1 === (265)) {
					b = appendInt(b, day, 2);
				} else if (_1 === (522)) {
					b = appendInt(b, hour, 2);
				} else if (_1 === (523)) {
					hr = (_r$3 = hour % 12, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
					if (hr === 0) {
						hr = 12;
					}
					b = appendInt(b, hr, 0);
				} else if (_1 === (524)) {
					hr$1 = (_r$4 = hour % 12, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
					if (hr$1 === 0) {
						hr$1 = 12;
					}
					b = appendInt(b, hr$1, 2);
				} else if (_1 === (525)) {
					b = appendInt(b, min, 0);
				} else if (_1 === (526)) {
					b = appendInt(b, min, 2);
				} else if (_1 === (527)) {
					b = appendInt(b, sec, 0);
				} else if (_1 === (528)) {
					b = appendInt(b, sec, 2);
				} else if (_1 === (531)) {
					if (hour >= 12) {
						b = $appendSlice(b, "PM");
					} else {
						b = $appendSlice(b, "AM");
					}
				} else if (_1 === (532)) {
					if (hour >= 12) {
						b = $appendSlice(b, "pm");
					} else {
						b = $appendSlice(b, "am");
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (30)) || (_1 === (28)) || (_1 === (29)) || (_1 === (31))) {
					if ((offset === 0) && ((std === 22) || (std === 25) || (std === 23) || (std === 24) || (std === 26))) {
						b = $append(b, 90);
						break;
					}
					zone$1 = (_q = offset / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					absoffset = offset;
					if (zone$1 < 0) {
						b = $append(b, 45);
						zone$1 = -zone$1;
						absoffset = -absoffset;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$1 = zone$1 / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					if ((std === 25) || (std === 30) || (std === 26) || (std === 31)) {
						b = $append(b, 58);
					}
					if (!((std === 29)) && !((std === 24))) {
						b = appendInt(b, (_r$5 = zone$1 % 60, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero")), 2);
					}
					if ((std === 23) || (std === 28) || (std === 31) || (std === 26)) {
						if ((std === 31) || (std === 26)) {
							b = $append(b, 58);
						}
						b = appendInt(b, (_r$6 = absoffset % 60, _r$6 === _r$6 ? _r$6 : $throwRuntimeError("integer divide by zero")), 2);
					}
				} else if (_1 === (21)) {
					if (!(name === "")) {
						b = $appendSlice(b, name);
						break;
					}
					zone$2 = (_q$2 = offset / 60, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					if (zone$2 < 0) {
						b = $append(b, 45);
						zone$2 = -zone$2;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$3 = zone$2 / 60, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					b = appendInt(b, (_r$7 = zone$2 % 60, _r$7 === _r$7 ? _r$7 : $throwRuntimeError("integer divide by zero")), 2);
				} else if ((_1 === (32)) || (_1 === (33))) {
					b = formatNano(b, (t.Nanosecond() >>> 0), std >> 16 >> 0, (std & 65535) === 33);
				}
			}
		}
		$s = -1; return b;
		return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AppendFormat }; } $f.$ptr = $ptr; $f._1 = _1; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.abs = abs; $f.absoffset = absoffset; $f.b = b; $f.day = day; $f.hour = hour; $f.hr = hr; $f.hr$1 = hr$1; $f.layout = layout; $f.m = m; $f.min = min; $f.month = month; $f.name = name; $f.offset = offset; $f.prefix = prefix; $f.s = s; $f.sec = sec; $f.std = std; $f.suffix = suffix; $f.t = t; $f.y = y; $f.year = year; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AppendFormat = function(b, layout) { return this.$val.AppendFormat(b, layout); };
	quote = function(s) {
		var $ptr, s;
		return "\"" + s + "\"";
	};
	ParseError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Message === "") {
			return "parsing time " + quote(e.Value) + " as " + quote(e.Layout) + ": cannot parse " + quote(e.ValueElem) + " as " + quote(e.LayoutElem);
		}
		return "parsing time " + quote(e.Value) + e.Message;
	};
	ParseError.prototype.Error = function() { return this.$val.Error(); };
	isDigit = function(s, i) {
		var $ptr, c, i, s;
		if (s.length <= i) {
			return false;
		}
		c = s.charCodeAt(i);
		return 48 <= c && c <= 57;
	};
	getnum = function(s, fixed) {
		var $ptr, fixed, s;
		if (!isDigit(s, 0)) {
			return [0, s, errBad];
		}
		if (!isDigit(s, 1)) {
			if (fixed) {
				return [0, s, errBad];
			}
			return [((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), $substring(s, 1), $ifaceNil];
		}
		return [($imul(((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), 10)) + ((s.charCodeAt(1) - 48 << 24 >>> 24) >> 0) >> 0, $substring(s, 2), $ifaceNil];
	};
	cutspace = function(s) {
		var $ptr, s;
		while (true) {
			if (!(s.length > 0 && (s.charCodeAt(0) === 32))) { break; }
			s = $substring(s, 1);
		}
		return s;
	};
	skip = function(value, prefix) {
		var $ptr, prefix, value;
		while (true) {
			if (!(prefix.length > 0)) { break; }
			if (prefix.charCodeAt(0) === 32) {
				if (value.length > 0 && !((value.charCodeAt(0) === 32))) {
					return [value, errBad];
				}
				prefix = cutspace(prefix);
				value = cutspace(value);
				continue;
			}
			if ((value.length === 0) || !((value.charCodeAt(0) === prefix.charCodeAt(0)))) {
				return [value, errBad];
			}
			prefix = $substring(prefix, 1);
			value = $substring(value, 1);
		}
		return [value, $ifaceNil];
	};
	Parse = function(layout, value) {
		var $ptr, _r$1, layout, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; layout = $f.layout; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r$1 = parse(layout, value, $pkg.UTC, $pkg.Local); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.layout = layout; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parse = function(layout, value, defaultLocation, local) {
		var $ptr, _1, _2, _3, _4, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$16, _tuple$17, _tuple$18, _tuple$19, _tuple$2, _tuple$20, _tuple$21, _tuple$22, _tuple$23, _tuple$24, _tuple$25, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, alayout, amSet, avalue, day, defaultLocation, err, hour, hour$1, hr, i, layout, local, min, min$1, mm, month, n, n$1, name, ndigit, nsec, offset, offset$1, ok, ok$1, p, pmSet, prefix, rangeErrString, sec, seconds, sign, ss, std, stdstr, suffix, t, t$1, value, x, x$1, x$2, x$3, x$4, x$5, year, z, zoneName, zoneOffset, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$22 = $f._tmp$22; _tmp$23 = $f._tmp$23; _tmp$24 = $f._tmp$24; _tmp$25 = $f._tmp$25; _tmp$26 = $f._tmp$26; _tmp$27 = $f._tmp$27; _tmp$28 = $f._tmp$28; _tmp$29 = $f._tmp$29; _tmp$3 = $f._tmp$3; _tmp$30 = $f._tmp$30; _tmp$31 = $f._tmp$31; _tmp$32 = $f._tmp$32; _tmp$33 = $f._tmp$33; _tmp$34 = $f._tmp$34; _tmp$35 = $f._tmp$35; _tmp$36 = $f._tmp$36; _tmp$37 = $f._tmp$37; _tmp$38 = $f._tmp$38; _tmp$39 = $f._tmp$39; _tmp$4 = $f._tmp$4; _tmp$40 = $f._tmp$40; _tmp$41 = $f._tmp$41; _tmp$42 = $f._tmp$42; _tmp$43 = $f._tmp$43; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$16 = $f._tuple$16; _tuple$17 = $f._tuple$17; _tuple$18 = $f._tuple$18; _tuple$19 = $f._tuple$19; _tuple$2 = $f._tuple$2; _tuple$20 = $f._tuple$20; _tuple$21 = $f._tuple$21; _tuple$22 = $f._tuple$22; _tuple$23 = $f._tuple$23; _tuple$24 = $f._tuple$24; _tuple$25 = $f._tuple$25; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; alayout = $f.alayout; amSet = $f.amSet; avalue = $f.avalue; day = $f.day; defaultLocation = $f.defaultLocation; err = $f.err; hour = $f.hour; hour$1 = $f.hour$1; hr = $f.hr; i = $f.i; layout = $f.layout; local = $f.local; min = $f.min; min$1 = $f.min$1; mm = $f.mm; month = $f.month; n = $f.n; n$1 = $f.n$1; name = $f.name; ndigit = $f.ndigit; nsec = $f.nsec; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; pmSet = $f.pmSet; prefix = $f.prefix; rangeErrString = $f.rangeErrString; sec = $f.sec; seconds = $f.seconds; sign = $f.sign; ss = $f.ss; std = $f.std; stdstr = $f.stdstr; suffix = $f.suffix; t = $f.t; t$1 = $f.t$1; value = $f.value; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; year = $f.year; z = $f.z; zoneName = $f.zoneName; zoneOffset = $f.zoneOffset; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = layout;
		_tmp$1 = value;
		alayout = _tmp;
		avalue = _tmp$1;
		rangeErrString = "";
		amSet = false;
		pmSet = false;
		year = 0;
		month = 1;
		day = 1;
		hour = 0;
		min = 0;
		sec = 0;
		nsec = 0;
		z = ptrType$1.nil;
		zoneOffset = -1;
		zoneName = "";
		while (true) {
			err = $ifaceNil;
			_tuple$1 = nextStdChunk(layout);
			prefix = _tuple$1[0];
			std = _tuple$1[1];
			suffix = _tuple$1[2];
			stdstr = $substring(layout, prefix.length, (layout.length - suffix.length >> 0));
			_tuple$2 = skip(value, prefix);
			value = _tuple$2[0];
			err = _tuple$2[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
			}
			if (std === 0) {
				if (!((value.length === 0))) {
					$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
					return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
				}
				break;
			}
			layout = suffix;
			p = "";
			switch (0) { default:
				_1 = std & 65535;
				if (_1 === (274)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$2 = $substring(value, 0, 2);
					_tmp$3 = $substring(value, 2);
					p = _tmp$2;
					value = _tmp$3;
					_tuple$3 = atoi(p);
					year = _tuple$3[0];
					err = _tuple$3[1];
					if (year >= 69) {
						year = year + (1900) >> 0;
					} else {
						year = year + (2000) >> 0;
					}
				} else if (_1 === (273)) {
					if (value.length < 4 || !isDigit(value, 0)) {
						err = errBad;
						break;
					}
					_tmp$4 = $substring(value, 0, 4);
					_tmp$5 = $substring(value, 4);
					p = _tmp$4;
					value = _tmp$5;
					_tuple$4 = atoi(p);
					year = _tuple$4[0];
					err = _tuple$4[1];
				} else if (_1 === (258)) {
					_tuple$5 = lookup(shortMonthNames, value);
					month = _tuple$5[0];
					value = _tuple$5[1];
					err = _tuple$5[2];
				} else if (_1 === (257)) {
					_tuple$6 = lookup(longMonthNames, value);
					month = _tuple$6[0];
					value = _tuple$6[1];
					err = _tuple$6[2];
				} else if ((_1 === (259)) || (_1 === (260))) {
					_tuple$7 = getnum(value, std === 260);
					month = _tuple$7[0];
					value = _tuple$7[1];
					err = _tuple$7[2];
					if (month <= 0 || 12 < month) {
						rangeErrString = "month";
					}
				} else if (_1 === (262)) {
					_tuple$8 = lookup(shortDayNames, value);
					value = _tuple$8[1];
					err = _tuple$8[2];
				} else if (_1 === (261)) {
					_tuple$9 = lookup(longDayNames, value);
					value = _tuple$9[1];
					err = _tuple$9[2];
				} else if ((_1 === (263)) || (_1 === (264)) || (_1 === (265))) {
					if ((std === 264) && value.length > 0 && (value.charCodeAt(0) === 32)) {
						value = $substring(value, 1);
					}
					_tuple$10 = getnum(value, std === 265);
					day = _tuple$10[0];
					value = _tuple$10[1];
					err = _tuple$10[2];
					if (day < 0) {
						rangeErrString = "day";
					}
				} else if (_1 === (522)) {
					_tuple$11 = getnum(value, false);
					hour = _tuple$11[0];
					value = _tuple$11[1];
					err = _tuple$11[2];
					if (hour < 0 || 24 <= hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (523)) || (_1 === (524))) {
					_tuple$12 = getnum(value, std === 524);
					hour = _tuple$12[0];
					value = _tuple$12[1];
					err = _tuple$12[2];
					if (hour < 0 || 12 < hour) {
						rangeErrString = "hour";
					}
				} else if ((_1 === (525)) || (_1 === (526))) {
					_tuple$13 = getnum(value, std === 526);
					min = _tuple$13[0];
					value = _tuple$13[1];
					err = _tuple$13[2];
					if (min < 0 || 60 <= min) {
						rangeErrString = "minute";
					}
				} else if ((_1 === (527)) || (_1 === (528))) {
					_tuple$14 = getnum(value, std === 528);
					sec = _tuple$14[0];
					value = _tuple$14[1];
					err = _tuple$14[2];
					if (sec < 0 || 60 <= sec) {
						rangeErrString = "second";
					}
					if (value.length >= 2 && (value.charCodeAt(0) === 46) && isDigit(value, 1)) {
						_tuple$15 = nextStdChunk(layout);
						std = _tuple$15[1];
						std = std & (65535);
						if ((std === 32) || (std === 33)) {
							break;
						}
						n = 2;
						while (true) {
							if (!(n < value.length && isDigit(value, n))) { break; }
							n = n + (1) >> 0;
						}
						_tuple$16 = parseNanoseconds(value, n);
						nsec = _tuple$16[0];
						rangeErrString = _tuple$16[1];
						err = _tuple$16[2];
						value = $substring(value, n);
					}
				} else if (_1 === (531)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$6 = $substring(value, 0, 2);
					_tmp$7 = $substring(value, 2);
					p = _tmp$6;
					value = _tmp$7;
					_2 = p;
					if (_2 === ("PM")) {
						pmSet = true;
					} else if (_2 === ("AM")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if (_1 === (532)) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$8 = $substring(value, 0, 2);
					_tmp$9 = $substring(value, 2);
					p = _tmp$8;
					value = _tmp$9;
					_3 = p;
					if (_3 === ("pm")) {
						pmSet = true;
					} else if (_3 === ("am")) {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if ((_1 === (22)) || (_1 === (25)) || (_1 === (23)) || (_1 === (24)) || (_1 === (26)) || (_1 === (27)) || (_1 === (29)) || (_1 === (30)) || (_1 === (28)) || (_1 === (31))) {
					if (((std === 22) || (std === 24) || (std === 25)) && value.length >= 1 && (value.charCodeAt(0) === 90)) {
						value = $substring(value, 1);
						z = $pkg.UTC;
						break;
					}
					_tmp$10 = "";
					_tmp$11 = "";
					_tmp$12 = "";
					_tmp$13 = "";
					sign = _tmp$10;
					hour$1 = _tmp$11;
					min$1 = _tmp$12;
					seconds = _tmp$13;
					if ((std === 25) || (std === 30)) {
						if (value.length < 6) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58))) {
							err = errBad;
							break;
						}
						_tmp$14 = $substring(value, 0, 1);
						_tmp$15 = $substring(value, 1, 3);
						_tmp$16 = $substring(value, 4, 6);
						_tmp$17 = "00";
						_tmp$18 = $substring(value, 6);
						sign = _tmp$14;
						hour$1 = _tmp$15;
						min$1 = _tmp$16;
						seconds = _tmp$17;
						value = _tmp$18;
					} else if ((std === 29) || (std === 24)) {
						if (value.length < 3) {
							err = errBad;
							break;
						}
						_tmp$19 = $substring(value, 0, 1);
						_tmp$20 = $substring(value, 1, 3);
						_tmp$21 = "00";
						_tmp$22 = "00";
						_tmp$23 = $substring(value, 3);
						sign = _tmp$19;
						hour$1 = _tmp$20;
						min$1 = _tmp$21;
						seconds = _tmp$22;
						value = _tmp$23;
					} else if ((std === 26) || (std === 31)) {
						if (value.length < 9) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58)) || !((value.charCodeAt(6) === 58))) {
							err = errBad;
							break;
						}
						_tmp$24 = $substring(value, 0, 1);
						_tmp$25 = $substring(value, 1, 3);
						_tmp$26 = $substring(value, 4, 6);
						_tmp$27 = $substring(value, 7, 9);
						_tmp$28 = $substring(value, 9);
						sign = _tmp$24;
						hour$1 = _tmp$25;
						min$1 = _tmp$26;
						seconds = _tmp$27;
						value = _tmp$28;
					} else if ((std === 23) || (std === 28)) {
						if (value.length < 7) {
							err = errBad;
							break;
						}
						_tmp$29 = $substring(value, 0, 1);
						_tmp$30 = $substring(value, 1, 3);
						_tmp$31 = $substring(value, 3, 5);
						_tmp$32 = $substring(value, 5, 7);
						_tmp$33 = $substring(value, 7);
						sign = _tmp$29;
						hour$1 = _tmp$30;
						min$1 = _tmp$31;
						seconds = _tmp$32;
						value = _tmp$33;
					} else {
						if (value.length < 5) {
							err = errBad;
							break;
						}
						_tmp$34 = $substring(value, 0, 1);
						_tmp$35 = $substring(value, 1, 3);
						_tmp$36 = $substring(value, 3, 5);
						_tmp$37 = "00";
						_tmp$38 = $substring(value, 5);
						sign = _tmp$34;
						hour$1 = _tmp$35;
						min$1 = _tmp$36;
						seconds = _tmp$37;
						value = _tmp$38;
					}
					_tmp$39 = 0;
					_tmp$40 = 0;
					_tmp$41 = 0;
					hr = _tmp$39;
					mm = _tmp$40;
					ss = _tmp$41;
					_tuple$17 = atoi(hour$1);
					hr = _tuple$17[0];
					err = _tuple$17[1];
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$18 = atoi(min$1);
						mm = _tuple$18[0];
						err = _tuple$18[1];
					}
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$19 = atoi(seconds);
						ss = _tuple$19[0];
						err = _tuple$19[1];
					}
					zoneOffset = ($imul(((($imul(hr, 60)) + mm >> 0)), 60)) + ss >> 0;
					_4 = sign.charCodeAt(0);
					if (_4 === (43)) {
					} else if (_4 === (45)) {
						zoneOffset = -zoneOffset;
					} else {
						err = errBad;
					}
				} else if (_1 === (21)) {
					if (value.length >= 3 && $substring(value, 0, 3) === "UTC") {
						z = $pkg.UTC;
						value = $substring(value, 3);
						break;
					}
					_tuple$20 = parseTimeZone(value);
					n$1 = _tuple$20[0];
					ok = _tuple$20[1];
					if (!ok) {
						err = errBad;
						break;
					}
					_tmp$42 = $substring(value, 0, n$1);
					_tmp$43 = $substring(value, n$1);
					zoneName = _tmp$42;
					value = _tmp$43;
				} else if (_1 === (32)) {
					ndigit = 1 + ((std >> 16 >> 0)) >> 0;
					if (value.length < ndigit) {
						err = errBad;
						break;
					}
					_tuple$21 = parseNanoseconds(value, ndigit);
					nsec = _tuple$21[0];
					rangeErrString = _tuple$21[1];
					err = _tuple$21[2];
					value = $substring(value, ndigit);
				} else if (_1 === (33)) {
					if (value.length < 2 || !((value.charCodeAt(0) === 46)) || value.charCodeAt(1) < 48 || 57 < value.charCodeAt(1)) {
						break;
					}
					i = 0;
					while (true) {
						if (!(i < 9 && (i + 1 >> 0) < value.length && 48 <= value.charCodeAt((i + 1 >> 0)) && value.charCodeAt((i + 1 >> 0)) <= 57)) { break; }
						i = i + (1) >> 0;
					}
					_tuple$22 = parseNanoseconds(value, 1 + i >> 0);
					nsec = _tuple$22[0];
					rangeErrString = _tuple$22[1];
					err = _tuple$22[2];
					value = $substring(value, (1 + i >> 0));
				}
			}
			if (!(rangeErrString === "")) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
			}
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
			}
		}
		if (pmSet && hour < 12) {
			hour = hour + (12) >> 0;
		} else if (amSet && (hour === 12)) {
			hour = 0;
		}
		if (day > daysIn((month >> 0), year)) {
			$s = -1; return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
			return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
		}
		/* */ if (!(z === ptrType$1.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(z === ptrType$1.nil)) { */ case 1:
			_r$1 = Date(year, (month >> 0), day, hour, min, sec, nsec, z); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return [_r$1, $ifaceNil];
			return [_r$1, $ifaceNil];
		/* } */ case 2:
		/* */ if (!((zoneOffset === -1))) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!((zoneOffset === -1))) { */ case 4:
			_r$2 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			t = $clone(_r$2, Time);
			t.sec = (x = t.sec, x$1 = new $Int64(0, zoneOffset), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low));
			_r$3 = local.lookup((x$2 = t.sec, new $Int64(x$2.$high + -15, x$2.$low + 2288912640))); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$23 = _r$3;
			name = _tuple$23[0];
			offset = _tuple$23[1];
			if ((offset === zoneOffset) && (zoneName === "" || name === zoneName)) {
				t.loc = local;
				$s = -1; return [t, $ifaceNil];
				return [t, $ifaceNil];
			}
			t.loc = FixedZone(zoneName, zoneOffset);
			$s = -1; return [t, $ifaceNil];
			return [t, $ifaceNil];
		/* } */ case 5:
		/* */ if (!(zoneName === "")) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!(zoneName === "")) { */ case 8:
			_r$4 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 10; case 10: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			t$1 = $clone(_r$4, Time);
			_r$5 = local.lookupName(zoneName, (x$3 = t$1.sec, new $Int64(x$3.$high + -15, x$3.$low + 2288912640))); /* */ $s = 11; case 11: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_tuple$24 = _r$5;
			offset$1 = _tuple$24[0];
			ok$1 = _tuple$24[2];
			if (ok$1) {
				t$1.sec = (x$4 = t$1.sec, x$5 = new $Int64(0, offset$1), new $Int64(x$4.$high - x$5.$high, x$4.$low - x$5.$low));
				t$1.loc = local;
				$s = -1; return [t$1, $ifaceNil];
				return [t$1, $ifaceNil];
			}
			if (zoneName.length > 3 && $substring(zoneName, 0, 3) === "GMT") {
				_tuple$25 = atoi($substring(zoneName, 3));
				offset$1 = _tuple$25[0];
				offset$1 = $imul(offset$1, (3600));
			}
			t$1.loc = FixedZone(zoneName, offset$1);
			$s = -1; return [t$1, $ifaceNil];
			return [t$1, $ifaceNil];
		/* } */ case 9:
		_r$6 = Date(year, (month >> 0), day, hour, min, sec, nsec, defaultLocation); /* */ $s = 12; case 12: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		$s = -1; return [_r$6, $ifaceNil];
		return [_r$6, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parse }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$22 = _tmp$22; $f._tmp$23 = _tmp$23; $f._tmp$24 = _tmp$24; $f._tmp$25 = _tmp$25; $f._tmp$26 = _tmp$26; $f._tmp$27 = _tmp$27; $f._tmp$28 = _tmp$28; $f._tmp$29 = _tmp$29; $f._tmp$3 = _tmp$3; $f._tmp$30 = _tmp$30; $f._tmp$31 = _tmp$31; $f._tmp$32 = _tmp$32; $f._tmp$33 = _tmp$33; $f._tmp$34 = _tmp$34; $f._tmp$35 = _tmp$35; $f._tmp$36 = _tmp$36; $f._tmp$37 = _tmp$37; $f._tmp$38 = _tmp$38; $f._tmp$39 = _tmp$39; $f._tmp$4 = _tmp$4; $f._tmp$40 = _tmp$40; $f._tmp$41 = _tmp$41; $f._tmp$42 = _tmp$42; $f._tmp$43 = _tmp$43; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$16 = _tuple$16; $f._tuple$17 = _tuple$17; $f._tuple$18 = _tuple$18; $f._tuple$19 = _tuple$19; $f._tuple$2 = _tuple$2; $f._tuple$20 = _tuple$20; $f._tuple$21 = _tuple$21; $f._tuple$22 = _tuple$22; $f._tuple$23 = _tuple$23; $f._tuple$24 = _tuple$24; $f._tuple$25 = _tuple$25; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.alayout = alayout; $f.amSet = amSet; $f.avalue = avalue; $f.day = day; $f.defaultLocation = defaultLocation; $f.err = err; $f.hour = hour; $f.hour$1 = hour$1; $f.hr = hr; $f.i = i; $f.layout = layout; $f.local = local; $f.min = min; $f.min$1 = min$1; $f.mm = mm; $f.month = month; $f.n = n; $f.n$1 = n$1; $f.name = name; $f.ndigit = ndigit; $f.nsec = nsec; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.pmSet = pmSet; $f.prefix = prefix; $f.rangeErrString = rangeErrString; $f.sec = sec; $f.seconds = seconds; $f.sign = sign; $f.ss = ss; $f.std = std; $f.stdstr = stdstr; $f.suffix = suffix; $f.t = t; $f.t$1 = t$1; $f.value = value; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.year = year; $f.z = z; $f.zoneName = zoneName; $f.zoneOffset = zoneOffset; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseTimeZone = function(value) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, length, nUpper, ok, value;
		length = 0;
		ok = false;
		if (value.length < 3) {
			_tmp = 0;
			_tmp$1 = false;
			length = _tmp;
			ok = _tmp$1;
			return [length, ok];
		}
		if (value.length >= 4 && ($substring(value, 0, 4) === "ChST" || $substring(value, 0, 4) === "MeST")) {
			_tmp$2 = 4;
			_tmp$3 = true;
			length = _tmp$2;
			ok = _tmp$3;
			return [length, ok];
		}
		if ($substring(value, 0, 3) === "GMT") {
			length = parseGMT(value);
			_tmp$4 = length;
			_tmp$5 = true;
			length = _tmp$4;
			ok = _tmp$5;
			return [length, ok];
		}
		nUpper = 0;
		nUpper = 0;
		while (true) {
			if (!(nUpper < 6)) { break; }
			if (nUpper >= value.length) {
				break;
			}
			c = value.charCodeAt(nUpper);
			if (c < 65 || 90 < c) {
				break;
			}
			nUpper = nUpper + (1) >> 0;
		}
		_1 = nUpper;
		if ((_1 === (0)) || (_1 === (1)) || (_1 === (2)) || (_1 === (6))) {
			_tmp$6 = 0;
			_tmp$7 = false;
			length = _tmp$6;
			ok = _tmp$7;
			return [length, ok];
		} else if (_1 === (5)) {
			if (value.charCodeAt(4) === 84) {
				_tmp$8 = 5;
				_tmp$9 = true;
				length = _tmp$8;
				ok = _tmp$9;
				return [length, ok];
			}
		} else if (_1 === (4)) {
			if (value.charCodeAt(3) === 84) {
				_tmp$10 = 4;
				_tmp$11 = true;
				length = _tmp$10;
				ok = _tmp$11;
				return [length, ok];
			}
		} else if (_1 === (3)) {
			_tmp$12 = 3;
			_tmp$13 = true;
			length = _tmp$12;
			ok = _tmp$13;
			return [length, ok];
		}
		_tmp$14 = 0;
		_tmp$15 = false;
		length = _tmp$14;
		ok = _tmp$15;
		return [length, ok];
	};
	parseGMT = function(value) {
		var $ptr, _tuple$1, err, rem, sign, value, x;
		value = $substring(value, 3);
		if (value.length === 0) {
			return 3;
		}
		sign = value.charCodeAt(0);
		if (!((sign === 45)) && !((sign === 43))) {
			return 3;
		}
		_tuple$1 = leadingInt($substring(value, 1));
		x = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return 3;
		}
		if (sign === 45) {
			x = new $Int64(-x.$high, -x.$low);
		}
		if ((x.$high === 0 && x.$low === 0) || (x.$high < -1 || (x.$high === -1 && x.$low < 4294967282)) || (0 < x.$high || (0 === x.$high && 12 < x.$low))) {
			return 3;
		}
		return (3 + value.length >> 0) - rem.length >> 0;
	};
	parseNanoseconds = function(value, nbytes) {
		var $ptr, _tuple$1, err, i, nbytes, ns, rangeErrString, scaleDigits, value;
		ns = 0;
		rangeErrString = "";
		err = $ifaceNil;
		if (!((value.charCodeAt(0) === 46))) {
			err = errBad;
			return [ns, rangeErrString, err];
		}
		_tuple$1 = atoi($substring(value, 1, nbytes));
		ns = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ns, rangeErrString, err];
		}
		if (ns < 0 || 1000000000 <= ns) {
			rangeErrString = "fractional second";
			return [ns, rangeErrString, err];
		}
		scaleDigits = 10 - nbytes >> 0;
		i = 0;
		while (true) {
			if (!(i < scaleDigits)) { break; }
			ns = $imul(ns, (10));
			i = i + (1) >> 0;
		}
		return [ns, rangeErrString, err];
	};
	leadingInt = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, c, err, i, rem, s, x, x$1, x$2, x$3;
		x = new $Int64(0, 0);
		rem = "";
		err = $ifaceNil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c < 48 || c > 57) {
				break;
			}
			if ((x.$high > 214748364 || (x.$high === 214748364 && x.$low > 3435973836))) {
				_tmp = new $Int64(0, 0);
				_tmp$1 = "";
				_tmp$2 = errLeadingInt;
				x = _tmp;
				rem = _tmp$1;
				err = _tmp$2;
				return [x, rem, err];
			}
			x = (x$1 = (x$2 = $mul64(x, new $Int64(0, 10)), x$3 = new $Int64(0, c), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low)), new $Int64(x$1.$high - 0, x$1.$low - 48));
			if ((x.$high < 0 || (x.$high === 0 && x.$low < 0))) {
				_tmp$3 = new $Int64(0, 0);
				_tmp$4 = "";
				_tmp$5 = errLeadingInt;
				x = _tmp$3;
				rem = _tmp$4;
				err = _tmp$5;
				return [x, rem, err];
			}
			i = i + (1) >> 0;
		}
		_tmp$6 = x;
		_tmp$7 = $substring(s, i);
		_tmp$8 = $ifaceNil;
		x = _tmp$6;
		rem = _tmp$7;
		err = _tmp$8;
		return [x, rem, err];
	};
	Time.ptr.prototype.After = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low > x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec > u.nsec;
	};
	Time.prototype.After = function(u) { return this.$val.After(u); };
	Time.ptr.prototype.Before = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high < x$1.$high || (x.$high === x$1.$high && x.$low < x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec < u.nsec;
	};
	Time.prototype.Before = function(u) { return this.$val.Before(u); };
	Time.ptr.prototype.Equal = function(u) {
		var $ptr, t, u, x, x$1;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high === x$1.$high && x.$low === x$1.$low)) && (t.nsec === u.nsec);
	};
	Time.prototype.Equal = function(u) { return this.$val.Equal(u); };
	Month.prototype.String = function() {
		var $ptr, m, x;
		m = this.$val;
		return (x = m - 1 >> 0, ((x < 0 || x >= months.length) ? $throwRuntimeError("index out of range") : months[x]));
	};
	$ptrType(Month).prototype.String = function() { return new Month(this.$get()).String(); };
	Weekday.prototype.String = function() {
		var $ptr, d;
		d = this.$val;
		return ((d < 0 || d >= days.length) ? $throwRuntimeError("index out of range") : days[d]);
	};
	$ptrType(Weekday).prototype.String = function() { return new Weekday(this.$get()).String(); };
	Time.ptr.prototype.IsZero = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, (x.$high === 0 && x.$low === 0)) && (t.nsec === 0);
	};
	Time.prototype.IsZero = function() { return this.$val.IsZero(); };
	Time.ptr.prototype.abs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, l, offset, sec, t, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; l = $f.l; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 6:
				sec = (x$3 = new $Int64(0, l.cacheZone.offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
				$s = 8; continue;
			/* } else { */ case 7:
				_r$2 = l.lookup(sec); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				offset = _tuple$1[1];
				sec = (x$4 = new $Int64(0, offset), new $Int64(sec.$high + x$4.$high, sec.$low + x$4.$low));
			/* } */ case 8:
		/* } */ case 5:
		$s = -1; return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.abs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.l = l; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.abs = function() { return this.$val.abs(); };
	Time.ptr.prototype.locabs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, abs, l, name, offset, sec, t, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; abs = $f.abs; l = $f.l; name = $f.name; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		abs = new $Uint64(0, 0);
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 7:
				name = l.cacheZone.name;
				offset = l.cacheZone.offset;
				$s = 9; continue;
			/* } else { */ case 8:
				_r$2 = l.lookup(sec); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				name = _tuple$1[0];
				offset = _tuple$1[1];
			/* } */ case 9:
			sec = (x$3 = new $Int64(0, offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
			$s = 6; continue;
		/* } else { */ case 5:
			name = "UTC";
		/* } */ case 6:
		abs = (x$4 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$4.$high, x$4.$low));
		$s = -1; return [name, offset, abs];
		return [name, offset, abs];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.locabs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.abs = abs; $f.l = l; $f.name = name; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.locabs = function() { return this.$val.locabs(); };
	Time.ptr.prototype.Date = function() {
		var $ptr, _r$1, _tuple$1, day, month, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; month = $f.month; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		$s = -1; return [year, month, day];
		return [year, month, day];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.month = month; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Date = function() { return this.$val.Date(); };
	Time.ptr.prototype.Year = function() {
		var $ptr, _r$1, _tuple$1, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		$s = -1; return year;
		return year;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Year }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Year = function() { return this.$val.Year(); };
	Time.ptr.prototype.Month = function() {
		var $ptr, _r$1, _tuple$1, month, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; month = $f.month; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		month = _tuple$1[1];
		$s = -1; return month;
		return month;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Month }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.month = month; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Month = function() { return this.$val.Month(); };
	Time.ptr.prototype.Day = function() {
		var $ptr, _r$1, _tuple$1, day, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		day = _tuple$1[2];
		$s = -1; return day;
		return day;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Day }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Day = function() { return this.$val.Day(); };
	Time.ptr.prototype.Weekday = function() {
		var $ptr, _r$1, _r$2, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absWeekday(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Weekday }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Weekday = function() { return this.$val.Weekday(); };
	absWeekday = function(abs) {
		var $ptr, _q, abs, sec;
		sec = $div64((new $Uint64(abs.$high + 0, abs.$low + 86400)), new $Uint64(0, 604800), true);
		return ((_q = (sec.$low >> 0) / 86400, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
	};
	Time.ptr.prototype.ISOWeek = function() {
		var $ptr, _q, _r$1, _r$2, _r$3, _r$4, _r$5, _tuple$1, day, dec31wday, jan1wday, month, t, wday, week, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _tuple$1 = $f._tuple$1; day = $f.day; dec31wday = $f.dec31wday; jan1wday = $f.jan1wday; month = $f.month; t = $f.t; wday = $f.wday; week = $f.week; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		week = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		_r$3 = t.Weekday(); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		wday = (_r$2 = ((_r$3 + 6 >> 0) >> 0) % 7, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero"));
		week = (_q = (((yday - wday >> 0) + 7 >> 0)) / 7, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		jan1wday = (_r$4 = (((wday - yday >> 0) + 371 >> 0)) % 7, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		if (1 <= jan1wday && jan1wday <= 3) {
			week = week + (1) >> 0;
		}
		if (week === 0) {
			year = year - (1) >> 0;
			week = 52;
			if ((jan1wday === 4) || ((jan1wday === 5) && isLeap(year))) {
				week = week + (1) >> 0;
			}
		}
		if ((month === 12) && day >= 29 && wday < 3) {
			dec31wday = (_r$5 = (((wday + 31 >> 0) - day >> 0)) % 7, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero"));
			if (0 <= dec31wday && dec31wday <= 2) {
				year = year + (1) >> 0;
				week = 1;
			}
		}
		$s = -1; return [year, week];
		return [year, week];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.ISOWeek }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._tuple$1 = _tuple$1; $f.day = day; $f.dec31wday = dec31wday; $f.jan1wday = jan1wday; $f.month = month; $f.t = t; $f.wday = wday; $f.week = week; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.ISOWeek = function() { return this.$val.ISOWeek(); };
	Time.ptr.prototype.Clock = function() {
		var $ptr, _r$1, _r$2, _tuple$1, hour, min, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; hour = $f.hour; min = $f.min; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		hour = 0;
		min = 0;
		sec = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absClock(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		hour = _tuple$1[0];
		min = _tuple$1[1];
		sec = _tuple$1[2];
		$s = -1; return [hour, min, sec];
		return [hour, min, sec];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Clock }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.hour = hour; $f.min = min; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Clock = function() { return this.$val.Clock(); };
	absClock = function(abs) {
		var $ptr, _q, _q$1, abs, hour, min, sec;
		hour = 0;
		min = 0;
		sec = 0;
		sec = ($div64(abs, new $Uint64(0, 86400), true).$low >> 0);
		hour = (_q = sec / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(hour, 3600))) >> 0;
		min = (_q$1 = sec / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(min, 60))) >> 0;
		return [hour, min, sec];
	};
	Time.ptr.prototype.Hour = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Hour }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Hour = function() { return this.$val.Hour(); };
	Time.ptr.prototype.Minute = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Minute }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Minute = function() { return this.$val.Minute(); };
	Time.ptr.prototype.Second = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Second }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Second = function() { return this.$val.Second(); };
	Time.ptr.prototype.Nanosecond = function() {
		var $ptr, t;
		t = $clone(this, Time);
		return (t.nsec >> 0);
	};
	Time.prototype.Nanosecond = function() { return this.$val.Nanosecond(); };
	Time.ptr.prototype.YearDay = function() {
		var $ptr, _r$1, _tuple$1, t, yday, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; yday = $f.yday; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		yday = _tuple$1[3];
		$s = -1; return yday + 1 >> 0;
		return yday + 1 >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.YearDay }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.yday = yday; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.YearDay = function() { return this.$val.YearDay(); };
	Duration.prototype.String = function() {
		var $ptr, _tuple$1, _tuple$2, buf, d, neg, prec, u, w;
		d = this;
		buf = arrayType$4.zero();
		w = 32;
		u = new $Uint64(d.$high, d.$low);
		neg = (d.$high < 0 || (d.$high === 0 && d.$low < 0));
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000000))) {
			prec = 0;
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			w = w - (1) >> 0;
			if ((u.$high === 0 && u.$low === 0)) {
				return "0s";
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000))) {
				prec = 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 110);
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000))) {
				prec = 3;
				w = w - (1) >> 0;
				$copyString($subslice(new sliceType$3(buf), w), "\xC2\xB5");
			} else {
				prec = 6;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
			}
			_tuple$1 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, prec);
			w = _tuple$1[0];
			u = _tuple$1[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
		} else {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			_tuple$2 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, 9);
			w = _tuple$2[0];
			u = _tuple$2[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
			u = $div64(u, (new $Uint64(0, 60)), false);
			if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
				w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
				u = $div64(u, (new $Uint64(0, 60)), false);
				if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
					w = w - (1) >> 0;
					((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 104);
					w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
				}
			}
		}
		if (neg) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
		}
		return $bytesToString($subslice(new sliceType$3(buf), w));
	};
	$ptrType(Duration).prototype.String = function() { return this.$get().String(); };
	fmtFrac = function(buf, v, prec) {
		var $ptr, _tmp, _tmp$1, buf, digit, i, nv, nw, prec, print, v, w;
		nw = 0;
		nv = new $Uint64(0, 0);
		w = buf.$length;
		print = false;
		i = 0;
		while (true) {
			if (!(i < prec)) { break; }
			digit = $div64(v, new $Uint64(0, 10), true);
			print = print || !((digit.$high === 0 && digit.$low === 0));
			if (print) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = ((digit.$low << 24 >>> 24) + 48 << 24 >>> 24));
			}
			v = $div64(v, (new $Uint64(0, 10)), false);
			i = i + (1) >> 0;
		}
		if (print) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
		}
		_tmp = w;
		_tmp$1 = v;
		nw = _tmp;
		nv = _tmp$1;
		return [nw, nv];
	};
	fmtInt = function(buf, v) {
		var $ptr, buf, v, w;
		w = buf.$length;
		if ((v.$high === 0 && v.$low === 0)) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 48);
		} else {
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = (($div64(v, new $Uint64(0, 10), true).$low << 24 >>> 24) + 48 << 24 >>> 24));
				v = $div64(v, (new $Uint64(0, 10)), false);
			}
		}
		return w;
	};
	Duration.prototype.Nanoseconds = function() {
		var $ptr, d;
		d = this;
		return new $Int64(d.$high, d.$low);
	};
	$ptrType(Duration).prototype.Nanoseconds = function() { return this.$get().Nanoseconds(); };
	Duration.prototype.Seconds = function() {
		var $ptr, d, nsec, sec;
		d = this;
		sec = $div64(d, new Duration(0, 1000000000), false);
		nsec = $div64(d, new Duration(0, 1000000000), true);
		return $flatten64(sec) + $flatten64(nsec) * 1e-09;
	};
	$ptrType(Duration).prototype.Seconds = function() { return this.$get().Seconds(); };
	Duration.prototype.Minutes = function() {
		var $ptr, d, min, nsec;
		d = this;
		min = $div64(d, new Duration(13, 4165425152), false);
		nsec = $div64(d, new Duration(13, 4165425152), true);
		return $flatten64(min) + $flatten64(nsec) * 1.6666666666666667e-11;
	};
	$ptrType(Duration).prototype.Minutes = function() { return this.$get().Minutes(); };
	Duration.prototype.Hours = function() {
		var $ptr, d, hour, nsec;
		d = this;
		hour = $div64(d, new Duration(838, 817405952), false);
		nsec = $div64(d, new Duration(838, 817405952), true);
		return $flatten64(hour) + $flatten64(nsec) * 2.777777777777778e-13;
	};
	$ptrType(Duration).prototype.Hours = function() { return this.$get().Hours(); };
	Time.ptr.prototype.Add = function(d) {
		var $ptr, d, nsec, t, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		t = $clone(this, Time);
		t.sec = (x = t.sec, x$1 = (x$2 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$2.$high, x$2.$low)), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		nsec = t.nsec + ((x$3 = $div64(d, new Duration(0, 1000000000), true), x$3.$low + ((x$3.$high >> 31) * 4294967296)) >> 0) >> 0;
		if (nsec >= 1000000000) {
			t.sec = (x$4 = t.sec, x$5 = new $Int64(0, 1), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
			nsec = nsec - (1000000000) >> 0;
		} else if (nsec < 0) {
			t.sec = (x$6 = t.sec, x$7 = new $Int64(0, 1), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low));
			nsec = nsec + (1000000000) >> 0;
		}
		t.nsec = nsec;
		return t;
	};
	Time.prototype.Add = function(d) { return this.$val.Add(d); };
	Time.ptr.prototype.Sub = function(u) {
		var $ptr, d, t, u, x, x$1, x$2, x$3, x$4;
		u = $clone(u, Time);
		t = $clone(this, Time);
		d = (x = $mul64((x$1 = (x$2 = t.sec, x$3 = u.sec, new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low)), new Duration(x$1.$high, x$1.$low)), new Duration(0, 1000000000)), x$4 = new Duration(0, (t.nsec - u.nsec >> 0)), new Duration(x.$high + x$4.$high, x.$low + x$4.$low));
		if (u.Add(d).Equal(t)) {
			return d;
		} else if (t.Before(u)) {
			return new Duration(-2147483648, 0);
		} else {
			return new Duration(2147483647, 4294967295);
		}
	};
	Time.prototype.Sub = function(u) { return this.$val.Sub(u); };
	Since = function(t) {
		var $ptr, t;
		t = $clone(t, Time);
		return Now().Sub(t);
	};
	$pkg.Since = Since;
	Time.ptr.prototype.AddDate = function(years, months$1, days$1) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, day, days$1, hour, min, month, months$1, sec, t, year, years, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; day = $f.day; days$1 = $f.days$1; hour = $f.hour; min = $f.min; month = $f.month; months$1 = $f.months$1; sec = $f.sec; t = $f.t; year = $f.year; years = $f.years; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Date(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		_r$2 = t.Clock(); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		hour = _tuple$2[0];
		min = _tuple$2[1];
		sec = _tuple$2[2];
		_r$3 = Date(year + years >> 0, month + (months$1 >> 0) >> 0, day + days$1 >> 0, hour, min, sec, (t.nsec >> 0), t.loc); /* */ $s = 3; case 3: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		$s = -1; return _r$3;
		return _r$3;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AddDate }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.day = day; $f.days$1 = days$1; $f.hour = hour; $f.min = min; $f.month = month; $f.months$1 = months$1; $f.sec = sec; $f.t = t; $f.year = year; $f.years = years; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AddDate = function(years, months$1, days$1) { return this.$val.AddDate(years, months$1, days$1); };
	Time.ptr.prototype.date = function(full) {
		var $ptr, _r$1, _r$2, _tuple$1, day, full, month, t, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; day = $f.day; full = $f.full; month = $f.month; t = $f.t; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absDate(_r$1, full); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		$s = -1; return [year, month, day, yday];
		return [year, month, day, yday];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.day = day; $f.full = full; $f.month = month; $f.t = t; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.date = function(full) { return this.$val.date(full); };
	absDate = function(abs, full) {
		var $ptr, _q, abs, begin, d, day, end, full, month, n, x, x$1, x$10, x$11, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, yday, year;
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		d = $div64(abs, new $Uint64(0, 86400), false);
		n = $div64(d, new $Uint64(0, 146097), false);
		y = $mul64(new $Uint64(0, 400), n);
		d = (x = $mul64(new $Uint64(0, 146097), n), new $Uint64(d.$high - x.$high, d.$low - x.$low));
		n = $div64(d, new $Uint64(0, 36524), false);
		n = (x$1 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$1.$high, n.$low - x$1.$low));
		y = (x$2 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high + x$2.$high, y.$low + x$2.$low));
		d = (x$3 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high - x$3.$high, d.$low - x$3.$low));
		n = $div64(d, new $Uint64(0, 1461), false);
		y = (x$4 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high + x$4.$high, y.$low + x$4.$low));
		d = (x$5 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high - x$5.$high, d.$low - x$5.$low));
		n = $div64(d, new $Uint64(0, 365), false);
		n = (x$6 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$6.$high, n.$low - x$6.$low));
		y = (x$7 = n, new $Uint64(y.$high + x$7.$high, y.$low + x$7.$low));
		d = (x$8 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high - x$8.$high, d.$low - x$8.$low));
		year = ((x$9 = (x$10 = new $Int64(y.$high, y.$low), new $Int64(x$10.$high + -69, x$10.$low + 4075721025)), x$9.$low + ((x$9.$high >> 31) * 4294967296)) >> 0);
		yday = (d.$low >> 0);
		if (!full) {
			return [year, month, day, yday];
		}
		day = yday;
		if (isLeap(year)) {
			if (day > 59) {
				day = day - (1) >> 0;
			} else if ((day === 59)) {
				month = 2;
				day = 29;
				return [year, month, day, yday];
			}
		}
		month = ((_q = day / 31, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
		end = ((x$11 = month + 1 >> 0, ((x$11 < 0 || x$11 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$11])) >> 0);
		begin = 0;
		if (day >= end) {
			month = month + (1) >> 0;
			begin = end;
		} else {
			begin = (((month < 0 || month >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[month]) >> 0);
		}
		month = month + (1) >> 0;
		day = (day - begin >> 0) + 1 >> 0;
		return [year, month, day, yday];
	};
	daysIn = function(m, year) {
		var $ptr, m, x, year;
		if ((m === 2) && isLeap(year)) {
			return 29;
		}
		return ((((m < 0 || m >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[m]) - (x = m - 1 >> 0, ((x < 0 || x >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x])) >> 0) >> 0);
	};
	Now = function() {
		var $ptr, _tuple$1, nsec, sec;
		_tuple$1 = now();
		sec = _tuple$1[0];
		nsec = _tuple$1[1];
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), nsec, $pkg.Local);
	};
	$pkg.Now = Now;
	Time.ptr.prototype.UTC = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.UTC;
		return t;
	};
	Time.prototype.UTC = function() { return this.$val.UTC(); };
	Time.ptr.prototype.Local = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.Local;
		return t;
	};
	Time.prototype.Local = function() { return this.$val.Local(); };
	Time.ptr.prototype.In = function(loc) {
		var $ptr, loc, t;
		t = $clone(this, Time);
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Time.In"));
		}
		t.loc = loc;
		return t;
	};
	Time.prototype.In = function(loc) { return this.$val.In(loc); };
	Time.ptr.prototype.Location = function() {
		var $ptr, l, t;
		t = $clone(this, Time);
		l = t.loc;
		if (l === ptrType$1.nil) {
			l = $pkg.UTC;
		}
		return l;
	};
	Time.prototype.Location = function() { return this.$val.Location(); };
	Time.ptr.prototype.Zone = function() {
		var $ptr, _r$1, _tuple$1, name, offset, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; name = $f.name; offset = $f.offset; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		t = $clone(this, Time);
		_r$1 = t.loc.lookup((x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640))); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		$s = -1; return [name, offset];
		return [name, offset];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Zone }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.name = name; $f.offset = offset; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Zone = function() { return this.$val.Zone(); };
	Time.ptr.prototype.Unix = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
	};
	Time.prototype.Unix = function() { return this.$val.Unix(); };
	Time.ptr.prototype.UnixNano = function() {
		var $ptr, t, x, x$1, x$2;
		t = $clone(this, Time);
		return (x = $mul64(((x$1 = t.sec, new $Int64(x$1.$high + -15, x$1.$low + 2288912640))), new $Int64(0, 1000000000)), x$2 = new $Int64(0, t.nsec), new $Int64(x.$high + x$2.$high, x.$low + x$2.$low));
	};
	Time.prototype.UnixNano = function() { return this.$val.UnixNano(); };
	Time.ptr.prototype.MarshalBinary = function() {
		var $ptr, _q, _r$1, _r$2, _tuple$1, enc, offset, offsetMin, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; enc = $f.enc; offset = $f.offset; offsetMin = $f.offsetMin; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		offsetMin = 0;
		/* */ if (t.Location() === utcLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (t.Location() === utcLoc) { */ case 1:
			offsetMin = -1;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = t.Zone(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			offset = _tuple$1[1];
			if (!(((_r$2 = offset % 60, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0))) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
			}
			offset = (_q = offset / (60), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			if (offset < -32768 || (offset === -1) || offset > 32767) {
				$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
			}
			offsetMin = (offset << 16 >> 16);
		/* } */ case 3:
		enc = new sliceType$3([1, ($shiftRightInt64(t.sec, 56).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 48).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 40).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 32).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 24).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 16).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 8).$low << 24 >>> 24), (t.sec.$low << 24 >>> 24), ((t.nsec >> 24 >> 0) << 24 >>> 24), ((t.nsec >> 16 >> 0) << 24 >>> 24), ((t.nsec >> 8 >> 0) << 24 >>> 24), (t.nsec << 24 >>> 24), ((offsetMin >> 8 << 16 >> 16) << 24 >>> 24), (offsetMin << 24 >>> 24)]);
		$s = -1; return [enc, $ifaceNil];
		return [enc, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalBinary }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.enc = enc; $f.offset = offset; $f.offsetMin = offsetMin; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalBinary = function() { return this.$val.MarshalBinary(); };
	Time.ptr.prototype.UnmarshalBinary = function(data$1) {
		var $ptr, _r$1, _tuple$1, buf, data$1, localoff, offset, t, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; buf = $f.buf; data$1 = $f.data$1; localoff = $f.localoff; offset = $f.offset; t = $f.t; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		buf = data$1;
		if (buf.$length === 0) {
			$s = -1; return errors.New("Time.UnmarshalBinary: no data");
			return errors.New("Time.UnmarshalBinary: no data");
		}
		if (!(((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) === 1))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: unsupported version");
			return errors.New("Time.UnmarshalBinary: unsupported version");
		}
		if (!((buf.$length === 15))) {
			$s = -1; return errors.New("Time.UnmarshalBinary: invalid length");
			return errors.New("Time.UnmarshalBinary: invalid length");
		}
		buf = $subslice(buf, 1);
		t.sec = (x = (x$1 = (x$2 = (x$3 = (x$4 = (x$5 = (x$6 = new $Int64(0, (7 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 7])), x$7 = $shiftLeft64(new $Int64(0, (6 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 6])), 8), new $Int64(x$6.$high | x$7.$high, (x$6.$low | x$7.$low) >>> 0)), x$8 = $shiftLeft64(new $Int64(0, (5 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 5])), 16), new $Int64(x$5.$high | x$8.$high, (x$5.$low | x$8.$low) >>> 0)), x$9 = $shiftLeft64(new $Int64(0, (4 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 4])), 24), new $Int64(x$4.$high | x$9.$high, (x$4.$low | x$9.$low) >>> 0)), x$10 = $shiftLeft64(new $Int64(0, (3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3])), 32), new $Int64(x$3.$high | x$10.$high, (x$3.$low | x$10.$low) >>> 0)), x$11 = $shiftLeft64(new $Int64(0, (2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2])), 40), new $Int64(x$2.$high | x$11.$high, (x$2.$low | x$11.$low) >>> 0)), x$12 = $shiftLeft64(new $Int64(0, (1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1])), 48), new $Int64(x$1.$high | x$12.$high, (x$1.$low | x$12.$low) >>> 0)), x$13 = $shiftLeft64(new $Int64(0, (0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0])), 56), new $Int64(x.$high | x$13.$high, (x.$low | x$13.$low) >>> 0));
		buf = $subslice(buf, 8);
		t.nsec = ((((3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3]) >> 0) | (((2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2]) >> 0) << 8 >> 0)) | (((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) >> 0) << 16 >> 0)) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) >> 0) << 24 >> 0);
		buf = $subslice(buf, 4);
		offset = $imul(((((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) << 16 >> 16) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) << 16 >> 16) << 8 << 16 >> 16)) >> 0), 60);
		/* */ if (offset === -60) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (offset === -60) { */ case 1:
			t.loc = utcLoc;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = $pkg.Local.lookup((x$14 = t.sec, new $Int64(x$14.$high + -15, x$14.$low + 2288912640))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			localoff = _tuple$1[1];
			if (offset === localoff) {
				t.loc = $pkg.Local;
			} else {
				t.loc = FixedZone("", offset);
			}
		/* } */ case 3:
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalBinary }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.buf = buf; $f.data$1 = data$1; $f.localoff = localoff; $f.offset = offset; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalBinary = function(data$1) { return this.$val.UnmarshalBinary(data$1); };
	Time.ptr.prototype.GobEncode = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.MarshalBinary(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobEncode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobEncode = function() { return this.$val.GobEncode(); };
	Time.ptr.prototype.GobDecode = function(data$1) {
		var $ptr, _r$1, data$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; data$1 = $f.data$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r$1 = t.UnmarshalBinary(data$1); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobDecode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.data$1 = data$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobDecode = function(data$1) { return this.$val.GobDecode(data$1); };
	Time.ptr.prototype.MarshalJSON = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
			return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 37);
		b = $append(b, 34);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		b = _r$2;
		b = $append(b, 34);
		$s = -1; return [b, $ifaceNil];
		return [b, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalJSON = function() { return this.$val.MarshalJSON(); };
	Time.ptr.prototype.UnmarshalJSON = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		err = $ifaceNil;
		_r$1 = Parse("\"2006-01-02T15:04:05Z07:00\"", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		$s = -1; return err;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalJSON = function(data$1) { return this.$val.UnmarshalJSON(data$1); };
	Time.ptr.prototype.MarshalText = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			$s = -1; return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
			return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 35);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return [_r$2, $ifaceNil];
		return [_r$2, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalText = function() { return this.$val.MarshalText(); };
	Time.ptr.prototype.UnmarshalText = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		err = $ifaceNil;
		_r$1 = Parse("2006-01-02T15:04:05Z07:00", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		$s = -1; return err;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalText = function(data$1) { return this.$val.UnmarshalText(data$1); };
	Unix = function(sec, nsec) {
		var $ptr, n, nsec, sec, x, x$1, x$2, x$3;
		if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0)) || (nsec.$high > 0 || (nsec.$high === 0 && nsec.$low >= 1000000000))) {
			n = $div64(nsec, new $Int64(0, 1000000000), false);
			sec = (x = n, new $Int64(sec.$high + x.$high, sec.$low + x.$low));
			nsec = (x$1 = $mul64(n, new $Int64(0, 1000000000)), new $Int64(nsec.$high - x$1.$high, nsec.$low - x$1.$low));
			if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0))) {
				nsec = (x$2 = new $Int64(0, 1000000000), new $Int64(nsec.$high + x$2.$high, nsec.$low + x$2.$low));
				sec = (x$3 = new $Int64(0, 1), new $Int64(sec.$high - x$3.$high, sec.$low - x$3.$low));
			}
		}
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), ((nsec.$low + ((nsec.$high >> 31) * 4294967296)) >> 0), $pkg.Local);
	};
	$pkg.Unix = Unix;
	isLeap = function(year) {
		var $ptr, _r$1, _r$2, _r$3, year;
		return ((_r$1 = year % 4, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0) && (!(((_r$2 = year % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0)) || ((_r$3 = year % 400, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero")) === 0));
	};
	norm = function(hi, lo, base) {
		var $ptr, _q, _q$1, _tmp, _tmp$1, base, hi, lo, n, n$1, nhi, nlo;
		nhi = 0;
		nlo = 0;
		if (lo < 0) {
			n = (_q = ((-lo - 1 >> 0)) / base, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) + 1 >> 0;
			hi = hi - (n) >> 0;
			lo = lo + (($imul(n, base))) >> 0;
		}
		if (lo >= base) {
			n$1 = (_q$1 = lo / base, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			hi = hi + (n$1) >> 0;
			lo = lo - (($imul(n$1, base))) >> 0;
		}
		_tmp = hi;
		_tmp$1 = lo;
		nhi = _tmp;
		nlo = _tmp$1;
		return [nhi, nlo];
	};
	Date = function(year, month, day, hour, min, sec, nsec, loc) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, abs, d, day, end, hour, loc, m, min, month, n, nsec, offset, sec, start, unix, utc, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; abs = $f.abs; d = $f.d; day = $f.day; end = $f.end; hour = $f.hour; loc = $f.loc; m = $f.m; min = $f.min; month = $f.month; n = $f.n; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; start = $f.start; unix = $f.unix; utc = $f.utc; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; y = $f.y; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Date"));
		}
		m = (month >> 0) - 1 >> 0;
		_tuple$1 = norm(year, m, 12);
		year = _tuple$1[0];
		m = _tuple$1[1];
		month = (m >> 0) + 1 >> 0;
		_tuple$2 = norm(sec, nsec, 1000000000);
		sec = _tuple$2[0];
		nsec = _tuple$2[1];
		_tuple$3 = norm(min, sec, 60);
		min = _tuple$3[0];
		sec = _tuple$3[1];
		_tuple$4 = norm(hour, min, 60);
		hour = _tuple$4[0];
		min = _tuple$4[1];
		_tuple$5 = norm(day, hour, 24);
		day = _tuple$5[0];
		hour = _tuple$5[1];
		y = (x = (x$1 = new $Int64(0, year), new $Int64(x$1.$high - -69, x$1.$low - 4075721025)), new $Uint64(x.$high, x.$low));
		n = $div64(y, new $Uint64(0, 400), false);
		y = (x$2 = $mul64(new $Uint64(0, 400), n), new $Uint64(y.$high - x$2.$high, y.$low - x$2.$low));
		d = $mul64(new $Uint64(0, 146097), n);
		n = $div64(y, new $Uint64(0, 100), false);
		y = (x$3 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high - x$3.$high, y.$low - x$3.$low));
		d = (x$4 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high + x$4.$high, d.$low + x$4.$low));
		n = $div64(y, new $Uint64(0, 4), false);
		y = (x$5 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high - x$5.$high, y.$low - x$5.$low));
		d = (x$6 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high + x$6.$high, d.$low + x$6.$low));
		n = y;
		d = (x$7 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high + x$7.$high, d.$low + x$7.$low));
		d = (x$8 = new $Uint64(0, (x$9 = month - 1 >> 0, ((x$9 < 0 || x$9 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$9]))), new $Uint64(d.$high + x$8.$high, d.$low + x$8.$low));
		if (isLeap(year) && month >= 3) {
			d = (x$10 = new $Uint64(0, 1), new $Uint64(d.$high + x$10.$high, d.$low + x$10.$low));
		}
		d = (x$11 = new $Uint64(0, (day - 1 >> 0)), new $Uint64(d.$high + x$11.$high, d.$low + x$11.$low));
		abs = $mul64(d, new $Uint64(0, 86400));
		abs = (x$12 = new $Uint64(0, ((($imul(hour, 3600)) + ($imul(min, 60)) >> 0) + sec >> 0)), new $Uint64(abs.$high + x$12.$high, abs.$low + x$12.$low));
		unix = (x$13 = new $Int64(abs.$high, abs.$low), new $Int64(x$13.$high + -2147483647, x$13.$low + 3844486912));
		_r$1 = loc.lookup(unix); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$6 = _r$1;
		offset = _tuple$6[1];
		start = _tuple$6[3];
		end = _tuple$6[4];
		/* */ if (!((offset === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((offset === 0))) { */ case 2:
				utc = (x$14 = new $Int64(0, offset), new $Int64(unix.$high - x$14.$high, unix.$low - x$14.$low));
				/* */ if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { $s = 5; continue; }
				/* */ if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { */ case 5:
					_r$2 = loc.lookup(new $Int64(start.$high - 0, start.$low - 1)); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$7 = _r$2;
					offset = _tuple$7[1];
					$s = 7; continue;
				/* } else if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { */ case 6:
					_r$3 = loc.lookup(end); /* */ $s = 9; case 9: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple$8 = _r$3;
					offset = _tuple$8[1];
				/* } */ case 7:
			case 4:
			unix = (x$15 = new $Int64(0, offset), new $Int64(unix.$high - x$15.$high, unix.$low - x$15.$low));
		/* } */ case 3:
		$s = -1; return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f.abs = abs; $f.d = d; $f.day = day; $f.end = end; $f.hour = hour; $f.loc = loc; $f.m = m; $f.min = min; $f.month = month; $f.n = n; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.start = start; $f.unix = unix; $f.utc = utc; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.y = y; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Date = Date;
	Time.ptr.prototype.Truncate = function(d) {
		var $ptr, _tuple$1, d, r, t;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		return t.Add(new Duration(-r.$high, -r.$low));
	};
	Time.prototype.Truncate = function(d) { return this.$val.Truncate(d); };
	Time.ptr.prototype.Round = function(d) {
		var $ptr, _tuple$1, d, r, t, x;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		if ((x = new Duration(r.$high + r.$high, r.$low + r.$low), (x.$high < d.$high || (x.$high === d.$high && x.$low < d.$low)))) {
			return t.Add(new Duration(-r.$high, -r.$low));
		}
		return t.Add(new Duration(d.$high - r.$high, d.$low - r.$low));
	};
	Time.prototype.Round = function(d) { return this.$val.Round(d); };
	div = function(t, d) {
		var $ptr, _q, _r$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, d, d0, d1, d1$1, neg, nsec, qmod2, r, sec, t, tmp, u0, u0x, u1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		qmod2 = 0;
		r = new Duration(0, 0);
		t = $clone(t, Time);
		neg = false;
		nsec = t.nsec;
		if ((x = t.sec, (x.$high < 0 || (x.$high === 0 && x.$low < 0)))) {
			neg = true;
			t.sec = (x$1 = t.sec, new $Int64(-x$1.$high, -x$1.$low));
			nsec = -nsec;
			if (nsec < 0) {
				nsec = nsec + (1000000000) >> 0;
				t.sec = (x$2 = t.sec, x$3 = new $Int64(0, 1), new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low));
			}
		}
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 1000000000)) && (x$4 = $div64(new Duration(0, 1000000000), (new Duration(d.$high + d.$high, d.$low + d.$low)), true), (x$4.$high === 0 && x$4.$low === 0))) {
			qmod2 = ((_q = nsec / ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0) & 1;
			r = new Duration(0, (_r$1 = nsec % ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")));
		} else if ((x$5 = $div64(d, new Duration(0, 1000000000), true), (x$5.$high === 0 && x$5.$low === 0))) {
			d1 = (x$6 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$6.$high, x$6.$low));
			qmod2 = ((x$7 = $div64(t.sec, d1, false), x$7.$low + ((x$7.$high >> 31) * 4294967296)) >> 0) & 1;
			r = (x$8 = $mul64((x$9 = $div64(t.sec, d1, true), new Duration(x$9.$high, x$9.$low)), new Duration(0, 1000000000)), x$10 = new Duration(0, nsec), new Duration(x$8.$high + x$10.$high, x$8.$low + x$10.$low));
		} else {
			sec = (x$11 = t.sec, new $Uint64(x$11.$high, x$11.$low));
			tmp = $mul64(($shiftRightUint64(sec, 32)), new $Uint64(0, 1000000000));
			u1 = $shiftRightUint64(tmp, 32);
			u0 = $shiftLeft64(tmp, 32);
			tmp = $mul64((new $Uint64(sec.$high & 0, (sec.$low & 4294967295) >>> 0)), new $Uint64(0, 1000000000));
			_tmp = u0;
			_tmp$1 = new $Uint64(u0.$high + tmp.$high, u0.$low + tmp.$low);
			u0x = _tmp;
			u0 = _tmp$1;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$12 = new $Uint64(0, 1), new $Uint64(u1.$high + x$12.$high, u1.$low + x$12.$low));
			}
			_tmp$2 = u0;
			_tmp$3 = (x$13 = new $Uint64(0, nsec), new $Uint64(u0.$high + x$13.$high, u0.$low + x$13.$low));
			u0x = _tmp$2;
			u0 = _tmp$3;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$14 = new $Uint64(0, 1), new $Uint64(u1.$high + x$14.$high, u1.$low + x$14.$low));
			}
			d1$1 = new $Uint64(d.$high, d.$low);
			while (true) {
				if (!(!((x$15 = $shiftRightUint64(d1$1, 63), (x$15.$high === 0 && x$15.$low === 1))))) { break; }
				d1$1 = $shiftLeft64(d1$1, (1));
			}
			d0 = new $Uint64(0, 0);
			while (true) {
				qmod2 = 0;
				if ((u1.$high > d1$1.$high || (u1.$high === d1$1.$high && u1.$low > d1$1.$low)) || (u1.$high === d1$1.$high && u1.$low === d1$1.$low) && (u0.$high > d0.$high || (u0.$high === d0.$high && u0.$low >= d0.$low))) {
					qmod2 = 1;
					_tmp$4 = u0;
					_tmp$5 = new $Uint64(u0.$high - d0.$high, u0.$low - d0.$low);
					u0x = _tmp$4;
					u0 = _tmp$5;
					if ((u0.$high > u0x.$high || (u0.$high === u0x.$high && u0.$low > u0x.$low))) {
						u1 = (x$16 = new $Uint64(0, 1), new $Uint64(u1.$high - x$16.$high, u1.$low - x$16.$low));
					}
					u1 = (x$17 = d1$1, new $Uint64(u1.$high - x$17.$high, u1.$low - x$17.$low));
				}
				if ((d1$1.$high === 0 && d1$1.$low === 0) && (x$18 = new $Uint64(d.$high, d.$low), (d0.$high === x$18.$high && d0.$low === x$18.$low))) {
					break;
				}
				d0 = $shiftRightUint64(d0, (1));
				d0 = (x$19 = $shiftLeft64((new $Uint64(d1$1.$high & 0, (d1$1.$low & 1) >>> 0)), 63), new $Uint64(d0.$high | x$19.$high, (d0.$low | x$19.$low) >>> 0));
				d1$1 = $shiftRightUint64(d1$1, (1));
			}
			r = new Duration(u0.$high, u0.$low);
		}
		if (neg && !((r.$high === 0 && r.$low === 0))) {
			qmod2 = (qmod2 ^ (1)) >> 0;
			r = new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		return [qmod2, r];
	};
	Location.ptr.prototype.get = function() {
		var $ptr, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		if (l === ptrType$1.nil) {
			$s = -1; return utcLoc;
			return utcLoc;
		}
		/* */ if (l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === localLoc) { */ case 1:
			$r = localOnce.Do(initLocal); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$s = -1; return l;
		return l;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.get }; } $f.$ptr = $ptr; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.get = function() { return this.$val.get(); };
	Location.ptr.prototype.String = function() {
		var $ptr, _r$1, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1.name;
		return _r$1.name;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.String = function() { return this.$val.String(); };
	FixedZone = function(name, offset) {
		var $ptr, l, name, offset, x;
		l = new Location.ptr(name, new sliceType([new zone.ptr(name, offset, false)]), new sliceType$1([new zoneTrans.ptr(new $Int64(-2147483648, 0), 0, false, false)]), new $Int64(-2147483648, 0), new $Int64(2147483647, 4294967295), ptrType.nil);
		l.cacheZone = (x = l.zone, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		return l;
	};
	$pkg.FixedZone = FixedZone;
	Location.ptr.prototype.lookup = function(sec) {
		var $ptr, _q, _r$1, end, hi, isDST, l, lim, lo, m, name, offset, sec, start, tx, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, zone$1, zone$2, zone$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; end = $f.end; hi = $f.hi; isDST = $f.isDST; l = $f.l; lim = $f.lim; lo = $f.lo; m = $f.m; name = $f.name; offset = $f.offset; sec = $f.sec; start = $f.start; tx = $f.tx; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; zone$1 = $f.zone$1; zone$2 = $f.zone$2; zone$3 = $f.zone$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		isDST = false;
		start = new $Int64(0, 0);
		end = new $Int64(0, 0);
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		if (l.zone.$length === 0) {
			name = "UTC";
			offset = 0;
			isDST = false;
			start = new $Int64(-2147483648, 0);
			end = new $Int64(2147483647, 4294967295);
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		zone$1 = l.cacheZone;
		if (!(zone$1 === ptrType.nil) && (x = l.cacheStart, (x.$high < sec.$high || (x.$high === sec.$high && x.$low <= sec.$low))) && (x$1 = l.cacheEnd, (sec.$high < x$1.$high || (sec.$high === x$1.$high && sec.$low < x$1.$low)))) {
			name = zone$1.name;
			offset = zone$1.offset;
			isDST = zone$1.isDST;
			start = l.cacheStart;
			end = l.cacheEnd;
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		if ((l.tx.$length === 0) || (x$2 = (x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).when, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) {
			zone$2 = (x$4 = l.zone, x$5 = l.lookupFirstZone(), ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5]));
			name = zone$2.name;
			offset = zone$2.offset;
			isDST = zone$2.isDST;
			start = new $Int64(-2147483648, 0);
			if (l.tx.$length > 0) {
				end = (x$6 = l.tx, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])).when;
			} else {
				end = new $Int64(2147483647, 4294967295);
			}
			$s = -1; return [name, offset, isDST, start, end];
			return [name, offset, isDST, start, end];
		}
		tx = l.tx;
		end = new $Int64(2147483647, 4294967295);
		lo = 0;
		hi = tx.$length;
		while (true) {
			if (!((hi - lo >> 0) > 1)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			lim = ((m < 0 || m >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + m]).when;
			if ((sec.$high < lim.$high || (sec.$high === lim.$high && sec.$low < lim.$low))) {
				end = lim;
				hi = m;
			} else {
				lo = m;
			}
		}
		zone$3 = (x$7 = l.zone, x$8 = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).index, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8]));
		name = zone$3.name;
		offset = zone$3.offset;
		isDST = zone$3.isDST;
		start = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).when;
		$s = -1; return [name, offset, isDST, start, end];
		return [name, offset, isDST, start, end];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookup }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.end = end; $f.hi = hi; $f.isDST = isDST; $f.l = l; $f.lim = lim; $f.lo = lo; $f.m = m; $f.name = name; $f.offset = offset; $f.sec = sec; $f.start = start; $f.tx = tx; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.zone$3 = zone$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookup = function(sec) { return this.$val.lookup(sec); };
	Location.ptr.prototype.lookupFirstZone = function() {
		var $ptr, _i, _ref, l, x, x$1, x$2, x$3, x$4, x$5, zi, zi$1;
		l = this;
		if (!l.firstZoneUsed()) {
			return 0;
		}
		if (l.tx.$length > 0 && (x = l.zone, x$1 = (x$2 = l.tx, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])).index, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).isDST) {
			zi = ((x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).index >> 0) - 1 >> 0;
			while (true) {
				if (!(zi >= 0)) { break; }
				if (!(x$4 = l.zone, ((zi < 0 || zi >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + zi])).isDST) {
					return zi;
				}
				zi = zi - (1) >> 0;
			}
		}
		_ref = l.zone;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			zi$1 = _i;
			if (!(x$5 = l.zone, ((zi$1 < 0 || zi$1 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + zi$1])).isDST) {
				return zi$1;
			}
			_i++;
		}
		return 0;
	};
	Location.prototype.lookupFirstZone = function() { return this.$val.lookupFirstZone(); };
	Location.ptr.prototype.firstZoneUsed = function() {
		var $ptr, _i, _ref, l, tx;
		l = this;
		_ref = l.tx;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			tx = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), zoneTrans);
			if (tx.index === 0) {
				return true;
			}
			_i++;
		}
		return false;
	};
	Location.prototype.firstZoneUsed = function() { return this.$val.firstZoneUsed(); };
	Location.ptr.prototype.lookupName = function(name, unix) {
		var $ptr, _i, _i$1, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple$1, i, i$1, isDST, isDST$1, l, nam, name, offset, offset$1, ok, unix, x, x$1, x$2, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple$1 = $f._tuple$1; i = $f.i; i$1 = $f.i$1; isDST = $f.isDST; isDST$1 = $f.isDST$1; l = $f.l; nam = $f.nam; name = $f.name; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; unix = $f.unix; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		offset = 0;
		isDST = false;
		ok = false;
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		_ref = l.zone;
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			zone$1 = (x = l.zone, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			/* */ if (zone$1.name === name) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (zone$1.name === name) { */ case 4:
				_r$2 = l.lookup((x$1 = new $Int64(0, zone$1.offset), new $Int64(unix.$high - x$1.$high, unix.$low - x$1.$low))); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				nam = _tuple$1[0];
				offset$1 = _tuple$1[1];
				isDST$1 = _tuple$1[2];
				if (nam === zone$1.name) {
					_tmp = offset$1;
					_tmp$1 = isDST$1;
					_tmp$2 = true;
					offset = _tmp;
					isDST = _tmp$1;
					ok = _tmp$2;
					$s = -1; return [offset, isDST, ok];
					return [offset, isDST, ok];
				}
			/* } */ case 5:
			_i++;
		/* } */ $s = 2; continue; case 3:
		_ref$1 = l.zone;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			zone$2 = (x$2 = l.zone, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			if (zone$2.name === name) {
				_tmp$3 = zone$2.offset;
				_tmp$4 = zone$2.isDST;
				_tmp$5 = true;
				offset = _tmp$3;
				isDST = _tmp$4;
				ok = _tmp$5;
				$s = -1; return [offset, isDST, ok];
				return [offset, isDST, ok];
			}
			_i$1++;
		}
		$s = -1; return [offset, isDST, ok];
		return [offset, isDST, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookupName }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple$1 = _tuple$1; $f.i = i; $f.i$1 = i$1; $f.isDST = isDST; $f.isDST$1 = isDST$1; $f.l = l; $f.nam = nam; $f.name = name; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.unix = unix; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookupName = function(name, unix) { return this.$val.lookupName(name, unix); };
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Time.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Format", name: "Format", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "AppendFormat", name: "AppendFormat", pkg: "", typ: $funcType([sliceType$3, $String], [sliceType$3], false)}, {prop: "After", name: "After", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Before", name: "Before", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Equal", name: "Equal", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "IsZero", name: "IsZero", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "abs", name: "abs", pkg: "time", typ: $funcType([], [$Uint64], false)}, {prop: "locabs", name: "locabs", pkg: "time", typ: $funcType([], [$String, $Int, $Uint64], false)}, {prop: "Date", name: "Date", pkg: "", typ: $funcType([], [$Int, Month, $Int], false)}, {prop: "Year", name: "Year", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Month", name: "Month", pkg: "", typ: $funcType([], [Month], false)}, {prop: "Day", name: "Day", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Weekday", name: "Weekday", pkg: "", typ: $funcType([], [Weekday], false)}, {prop: "ISOWeek", name: "ISOWeek", pkg: "", typ: $funcType([], [$Int, $Int], false)}, {prop: "Clock", name: "Clock", pkg: "", typ: $funcType([], [$Int, $Int, $Int], false)}, {prop: "Hour", name: "Hour", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Minute", name: "Minute", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Second", name: "Second", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Nanosecond", name: "Nanosecond", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "YearDay", name: "YearDay", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Time], [Duration], false)}, {prop: "AddDate", name: "AddDate", pkg: "", typ: $funcType([$Int, $Int, $Int], [Time], false)}, {prop: "date", name: "date", pkg: "time", typ: $funcType([$Bool], [$Int, Month, $Int, $Int], false)}, {prop: "UTC", name: "UTC", pkg: "", typ: $funcType([], [Time], false)}, {prop: "Local", name: "Local", pkg: "", typ: $funcType([], [Time], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([ptrType$1], [Time], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "Zone", name: "Zone", pkg: "", typ: $funcType([], [$String, $Int], false)}, {prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "UnixNano", name: "UnixNano", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "MarshalBinary", name: "MarshalBinary", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "GobEncode", name: "GobEncode", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Time], false)}];
	ptrType$6.methods = [{prop: "UnmarshalBinary", name: "UnmarshalBinary", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "GobDecode", name: "GobDecode", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType$3], [$error], false)}];
	Month.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Weekday.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Duration.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Nanoseconds", name: "Nanoseconds", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seconds", name: "Seconds", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Minutes", name: "Minutes", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Hours", name: "Hours", pkg: "", typ: $funcType([], [$Float64], false)}];
	ptrType$1.methods = [{prop: "get", name: "get", pkg: "time", typ: $funcType([], [ptrType$1], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "lookup", name: "lookup", pkg: "time", typ: $funcType([$Int64], [$String, $Int, $Bool, $Int64, $Int64], false)}, {prop: "lookupFirstZone", name: "lookupFirstZone", pkg: "time", typ: $funcType([], [$Int], false)}, {prop: "firstZoneUsed", name: "firstZoneUsed", pkg: "time", typ: $funcType([], [$Bool], false)}, {prop: "lookupName", name: "lookupName", pkg: "time", typ: $funcType([$String, $Int64], [$Int, $Bool, $Bool], false)}];
	ParseError.init("", [{prop: "Layout", name: "Layout", exported: true, typ: $String, tag: ""}, {prop: "Value", name: "Value", exported: true, typ: $String, tag: ""}, {prop: "LayoutElem", name: "LayoutElem", exported: true, typ: $String, tag: ""}, {prop: "ValueElem", name: "ValueElem", exported: true, typ: $String, tag: ""}, {prop: "Message", name: "Message", exported: true, typ: $String, tag: ""}]);
	Time.init("time", [{prop: "sec", name: "sec", exported: false, typ: $Int64, tag: ""}, {prop: "nsec", name: "nsec", exported: false, typ: $Int32, tag: ""}, {prop: "loc", name: "loc", exported: false, typ: ptrType$1, tag: ""}]);
	Location.init("time", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "zone", name: "zone", exported: false, typ: sliceType, tag: ""}, {prop: "tx", name: "tx", exported: false, typ: sliceType$1, tag: ""}, {prop: "cacheStart", name: "cacheStart", exported: false, typ: $Int64, tag: ""}, {prop: "cacheEnd", name: "cacheEnd", exported: false, typ: $Int64, tag: ""}, {prop: "cacheZone", name: "cacheZone", exported: false, typ: ptrType, tag: ""}]);
	zone.init("time", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "offset", name: "offset", exported: false, typ: $Int, tag: ""}, {prop: "isDST", name: "isDST", exported: false, typ: $Bool, tag: ""}]);
	zoneTrans.init("time", [{prop: "when", name: "when", exported: false, typ: $Int64, tag: ""}, {prop: "index", name: "index", exported: false, typ: $Uint8, tag: ""}, {prop: "isstd", name: "isstd", exported: false, typ: $Bool, tag: ""}, {prop: "isutc", name: "isutc", exported: false, typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		localLoc = new Location.ptr("", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		localOnce = new nosync.Once.ptr(false, false);
		std0x = $toNativeArray($kindInt, [260, 265, 524, 526, 528, 274]);
		longDayNames = new sliceType$2(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		shortDayNames = new sliceType$2(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
		shortMonthNames = new sliceType$2(["---", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
		longMonthNames = new sliceType$2(["---", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		atoiError = errors.New("time: invalid number");
		errBad = errors.New("bad value for field");
		errLeadingInt = errors.New("time: bad [0-9]*");
		months = $toNativeArray($kindString, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		days = $toNativeArray($kindString, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		daysBefore = $toNativeArray($kindInt32, [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]);
		utcLoc = new Location.ptr("UTC", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		$pkg.UTC = utcLoc;
		$pkg.Local = localLoc;
		_r = syscall.Getenv("ZONEINFO"); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		zoneinfo = _tuple[0];
		badData = errors.New("malformed time zone information");
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["os"] = (function() {
	var $pkg = {}, $init, errors, js, io, runtime, sync, atomic, syscall, time, PathError, SyscallError, LinkError, File, file, dirInfo, FileInfo, FileMode, fileStat, sliceType, ptrType, sliceType$1, ptrType$1, sliceType$2, ptrType$2, ptrType$3, ptrType$4, arrayType, ptrType$12, funcType$1, ptrType$13, arrayType$2, arrayType$5, ptrType$15, errFinished, lstat, useSyscallwd, supportsCloseOnExec, runtime_args, init, NewSyscallError, IsNotExist, isNotExist, fixCount, sigpipe, syscallMode, NewFile, epipecheck, Lstat, basename, init$1, useSyscallwdDarwin, init$2, fillFileStatFromSys, timespecToTime, init$3;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	atomic = $packages["sync/atomic"];
	syscall = $packages["syscall"];
	time = $packages["time"];
	PathError = $pkg.PathError = $newType(0, $kindStruct, "os.PathError", true, "os", true, function(Op_, Path_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = "";
			this.Path = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Op = Op_;
		this.Path = Path_;
		this.Err = Err_;
	});
	SyscallError = $pkg.SyscallError = $newType(0, $kindStruct, "os.SyscallError", true, "os", true, function(Syscall_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Syscall = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Syscall = Syscall_;
		this.Err = Err_;
	});
	LinkError = $pkg.LinkError = $newType(0, $kindStruct, "os.LinkError", true, "os", true, function(Op_, Old_, New_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Op = "";
			this.Old = "";
			this.New = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Op = Op_;
		this.Old = Old_;
		this.New = New_;
		this.Err = Err_;
	});
	File = $pkg.File = $newType(0, $kindStruct, "os.File", true, "os", true, function(file_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.file = ptrType$12.nil;
			return;
		}
		this.file = file_;
	});
	file = $pkg.file = $newType(0, $kindStruct, "os.file", true, "os", false, function(fd_, name_, dirinfo_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.fd = 0;
			this.name = "";
			this.dirinfo = ptrType.nil;
			return;
		}
		this.fd = fd_;
		this.name = name_;
		this.dirinfo = dirinfo_;
	});
	dirInfo = $pkg.dirInfo = $newType(0, $kindStruct, "os.dirInfo", true, "os", false, function(buf_, nbuf_, bufp_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType$1.nil;
			this.nbuf = 0;
			this.bufp = 0;
			return;
		}
		this.buf = buf_;
		this.nbuf = nbuf_;
		this.bufp = bufp_;
	});
	FileInfo = $pkg.FileInfo = $newType(8, $kindInterface, "os.FileInfo", true, "os", true, null);
	FileMode = $pkg.FileMode = $newType(4, $kindUint32, "os.FileMode", true, "os", true, null);
	fileStat = $pkg.fileStat = $newType(0, $kindStruct, "os.fileStat", true, "os", false, function(name_, size_, mode_, modTime_, sys_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.size = new $Int64(0, 0);
			this.mode = 0;
			this.modTime = new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil);
			this.sys = new syscall.Stat_t.ptr(0, 0, 0, new $Uint64(0, 0), 0, 0, 0, arrayType.zero(), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new $Int64(0, 0), new $Int64(0, 0), 0, 0, 0, 0, arrayType$2.zero());
			return;
		}
		this.name = name_;
		this.size = size_;
		this.mode = mode_;
		this.modTime = modTime_;
		this.sys = sys_;
	});
	sliceType = $sliceType($String);
	ptrType = $ptrType(dirInfo);
	sliceType$1 = $sliceType($Uint8);
	ptrType$1 = $ptrType(File);
	sliceType$2 = $sliceType(FileInfo);
	ptrType$2 = $ptrType(PathError);
	ptrType$3 = $ptrType(LinkError);
	ptrType$4 = $ptrType(SyscallError);
	arrayType = $arrayType($Uint8, 4);
	ptrType$12 = $ptrType(file);
	funcType$1 = $funcType([ptrType$12], [$error], false);
	ptrType$13 = $ptrType(time.Location);
	arrayType$2 = $arrayType($Int64, 2);
	arrayType$5 = $arrayType($Uint8, 32);
	ptrType$15 = $ptrType(fileStat);
	runtime_args = function() {
		var $ptr;
		return $pkg.Args;
	};
	init = function() {
		var $ptr, argv, i, process;
		process = $global.process;
		if (!(process === undefined)) {
			argv = process.argv;
			$pkg.Args = $makeSlice(sliceType, ($parseInt(argv.length) - 1 >> 0));
			i = 0;
			while (true) {
				if (!(i < ($parseInt(argv.length) - 1 >> 0))) { break; }
				((i < 0 || i >= $pkg.Args.$length) ? $throwRuntimeError("index out of range") : $pkg.Args.$array[$pkg.Args.$offset + i] = $internalize(argv[(i + 1 >> 0)], $String));
				i = i + (1) >> 0;
			}
		}
		if ($pkg.Args.$length === 0) {
			$pkg.Args = new sliceType(["?"]);
		}
	};
	File.ptr.prototype.readdirnames = function(n) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, _tuple$2, d, err, errno, f, n, names, nb, nc, size;
		names = sliceType.nil;
		err = $ifaceNil;
		f = this;
		if (f.file.dirinfo === ptrType.nil) {
			f.file.dirinfo = new dirInfo.ptr(sliceType$1.nil, 0, 0);
			f.file.dirinfo.buf = $makeSlice(sliceType$1, 4096);
		}
		d = f.file.dirinfo;
		size = n;
		if (size <= 0) {
			size = 100;
			n = -1;
		}
		names = $makeSlice(sliceType, 0, size);
		while (true) {
			if (!(!((n === 0)))) { break; }
			if (d.bufp >= d.nbuf) {
				d.bufp = 0;
				errno = $ifaceNil;
				_tuple$1 = syscall.ReadDirent(f.file.fd, d.buf);
				_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
				d.nbuf = _tuple[0];
				errno = _tuple[1];
				if (!($interfaceIsEqual(errno, $ifaceNil))) {
					_tmp = names;
					_tmp$1 = NewSyscallError("readdirent", errno);
					names = _tmp;
					err = _tmp$1;
					return [names, err];
				}
				if (d.nbuf <= 0) {
					break;
				}
			}
			_tmp$2 = 0;
			_tmp$3 = 0;
			nb = _tmp$2;
			nc = _tmp$3;
			_tuple$2 = syscall.ParseDirent($subslice(d.buf, d.bufp, d.nbuf), n, names);
			nb = _tuple$2[0];
			nc = _tuple$2[1];
			names = _tuple$2[2];
			d.bufp = d.bufp + (nb) >> 0;
			n = n - (nc) >> 0;
		}
		if (n >= 0 && (names.$length === 0)) {
			_tmp$4 = names;
			_tmp$5 = io.EOF;
			names = _tmp$4;
			err = _tmp$5;
			return [names, err];
		}
		_tmp$6 = names;
		_tmp$7 = $ifaceNil;
		names = _tmp$6;
		err = _tmp$7;
		return [names, err];
	};
	File.prototype.readdirnames = function(n) { return this.$val.readdirnames(n); };
	File.ptr.prototype.Readdir = function(n) {
		var $ptr, _r, f, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = this;
		if (f === ptrType$1.nil) {
			$s = -1; return [sliceType$2.nil, $pkg.ErrInvalid];
			return [sliceType$2.nil, $pkg.ErrInvalid];
		}
		_r = f.readdir(n); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: File.ptr.prototype.Readdir }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	File.prototype.Readdir = function(n) { return this.$val.Readdir(n); };
	File.ptr.prototype.Readdirnames = function(n) {
		var $ptr, _tmp, _tmp$1, _tuple, err, f, n, names;
		names = sliceType.nil;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = sliceType.nil;
			_tmp$1 = $pkg.ErrInvalid;
			names = _tmp;
			err = _tmp$1;
			return [names, err];
		}
		_tuple = f.readdirnames(n);
		names = _tuple[0];
		err = _tuple[1];
		return [names, err];
	};
	File.prototype.Readdirnames = function(n) { return this.$val.Readdirnames(n); };
	PathError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Op + " " + e.Path + ": " + _r;
		return e.Op + " " + e.Path + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: PathError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	PathError.prototype.Error = function() { return this.$val.Error(); };
	SyscallError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Syscall + ": " + _r;
		return e.Syscall + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: SyscallError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	SyscallError.prototype.Error = function() { return this.$val.Error(); };
	NewSyscallError = function(syscall$1, err) {
		var $ptr, err, syscall$1;
		if ($interfaceIsEqual(err, $ifaceNil)) {
			return $ifaceNil;
		}
		return new SyscallError.ptr(syscall$1, err);
	};
	$pkg.NewSyscallError = NewSyscallError;
	IsNotExist = function(err) {
		var $ptr, err;
		return isNotExist(err);
	};
	$pkg.IsNotExist = IsNotExist;
	isNotExist = function(err) {
		var $ptr, _ref, err, pe, pe$1, pe$2, pe$3;
		_ref = err;
		if (_ref === $ifaceNil) {
			pe = _ref;
			return false;
		} else if ($assertType(_ref, ptrType$2, true)[1]) {
			pe$1 = _ref.$val;
			err = pe$1.Err;
		} else if ($assertType(_ref, ptrType$3, true)[1]) {
			pe$2 = _ref.$val;
			err = pe$2.Err;
		} else if ($assertType(_ref, ptrType$4, true)[1]) {
			pe$3 = _ref.$val;
			err = pe$3.Err;
		}
		return $interfaceIsEqual(err, new syscall.Errno(2)) || $interfaceIsEqual(err, $pkg.ErrNotExist);
	};
	File.ptr.prototype.Name = function() {
		var $ptr, f;
		f = this;
		return f.file.name;
	};
	File.prototype.Name = function() { return this.$val.Name(); };
	LinkError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return e.Op + " " + e.Old + " " + e.New + ": " + _r;
		return e.Op + " " + e.Old + " " + e.New + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: LinkError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	LinkError.prototype.Error = function() { return this.$val.Error(); };
	File.ptr.prototype.Read = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, b, e, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.read(b);
		n = _tuple[0];
		e = _tuple[1];
		if ((n === 0) && b.$length > 0 && $interfaceIsEqual(e, $ifaceNil)) {
			_tmp$2 = 0;
			_tmp$3 = io.EOF;
			n = _tmp$2;
			err = _tmp$3;
			return [n, err];
		}
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("read", f.file.name, e);
		}
		_tmp$4 = n;
		_tmp$5 = err;
		n = _tmp$4;
		err = _tmp$5;
		return [n, err];
	};
	File.prototype.Read = function(b) { return this.$val.Read(b); };
	File.ptr.prototype.ReadAt = function(b, off) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, f, m, n, off, x;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		while (true) {
			if (!(b.$length > 0)) { break; }
			_tuple = f.pread(b, off);
			m = _tuple[0];
			e = _tuple[1];
			if ((m === 0) && $interfaceIsEqual(e, $ifaceNil)) {
				_tmp$2 = n;
				_tmp$3 = io.EOF;
				n = _tmp$2;
				err = _tmp$3;
				return [n, err];
			}
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = new PathError.ptr("read", f.file.name, e);
				break;
			}
			n = n + (m) >> 0;
			b = $subslice(b, m);
			off = (x = new $Int64(0, m), new $Int64(off.$high + x.$high, off.$low + x.$low));
		}
		return [n, err];
	};
	File.prototype.ReadAt = function(b, off) { return this.$val.ReadAt(b, off); };
	File.ptr.prototype.Write = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.write(b);
		n = _tuple[0];
		e = _tuple[1];
		if (n < 0) {
			n = 0;
		}
		if (!((n === b.$length))) {
			err = io.ErrShortWrite;
		}
		epipecheck(f, e);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("write", f.file.name, e);
		}
		_tmp$2 = n;
		_tmp$3 = err;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
	};
	File.prototype.Write = function(b) { return this.$val.Write(b); };
	File.ptr.prototype.WriteAt = function(b, off) {
		var $ptr, _tmp, _tmp$1, _tuple, b, e, err, f, m, n, off, x;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		while (true) {
			if (!(b.$length > 0)) { break; }
			_tuple = f.pwrite(b, off);
			m = _tuple[0];
			e = _tuple[1];
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = new PathError.ptr("write", f.file.name, e);
				break;
			}
			n = n + (m) >> 0;
			b = $subslice(b, m);
			off = (x = new $Int64(0, m), new $Int64(off.$high + x.$high, off.$low + x.$low));
		}
		return [n, err];
	};
	File.prototype.WriteAt = function(b, off) { return this.$val.WriteAt(b, off); };
	File.ptr.prototype.Seek = function(offset, whence) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, e, err, f, offset, r, ret, whence;
		ret = new $Int64(0, 0);
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = new $Int64(0, 0);
			_tmp$1 = $pkg.ErrInvalid;
			ret = _tmp;
			err = _tmp$1;
			return [ret, err];
		}
		_tuple = f.seek(offset, whence);
		r = _tuple[0];
		e = _tuple[1];
		if ($interfaceIsEqual(e, $ifaceNil) && !(f.file.dirinfo === ptrType.nil) && !((r.$high === 0 && r.$low === 0))) {
			e = new syscall.Errno(21);
		}
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			_tmp$2 = new $Int64(0, 0);
			_tmp$3 = new PathError.ptr("seek", f.file.name, e);
			ret = _tmp$2;
			err = _tmp$3;
			return [ret, err];
		}
		_tmp$4 = r;
		_tmp$5 = $ifaceNil;
		ret = _tmp$4;
		err = _tmp$5;
		return [ret, err];
	};
	File.prototype.Seek = function(offset, whence) { return this.$val.Seek(offset, whence); };
	File.ptr.prototype.WriteString = function(s) {
		var $ptr, _tmp, _tmp$1, _tuple, err, f, n, s;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (f === ptrType$1.nil) {
			_tmp = 0;
			_tmp$1 = $pkg.ErrInvalid;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		_tuple = f.Write(new sliceType$1($stringToBytes(s)));
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	File.ptr.prototype.Chdir = function() {
		var $ptr, e, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchdir(f.file.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chdir", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chdir = function() { return this.$val.Chdir(); };
	fixCount = function(n, err) {
		var $ptr, err, n;
		if (n < 0) {
			n = 0;
		}
		return [n, err];
	};
	sigpipe = function() {
		$throwRuntimeError("native function not implemented: os.sigpipe");
	};
	syscallMode = function(i) {
		var $ptr, i, o;
		o = 0;
		o = (o | ((new FileMode(i).Perm() >>> 0))) >>> 0;
		if (!((((i & 8388608) >>> 0) === 0))) {
			o = (o | (2048)) >>> 0;
		}
		if (!((((i & 4194304) >>> 0) === 0))) {
			o = (o | (1024)) >>> 0;
		}
		if (!((((i & 1048576) >>> 0) === 0))) {
			o = (o | (512)) >>> 0;
		}
		return o;
	};
	File.ptr.prototype.Chmod = function(mode) {
		var $ptr, e, f, mode;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchmod(f.file.fd, syscallMode(mode));
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chmod", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chmod = function(mode) { return this.$val.Chmod(mode); };
	File.ptr.prototype.Chown = function(uid, gid) {
		var $ptr, e, f, gid, uid;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fchown(f.file.fd, uid, gid);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("chown", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Chown = function(uid, gid) { return this.$val.Chown(uid, gid); };
	File.ptr.prototype.Truncate = function(size) {
		var $ptr, e, f, size;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Ftruncate(f.file.fd, size);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return new PathError.ptr("truncate", f.file.name, e);
		}
		return $ifaceNil;
	};
	File.prototype.Truncate = function(size) { return this.$val.Truncate(size); };
	File.ptr.prototype.Sync = function() {
		var $ptr, e, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		e = syscall.Fsync(f.file.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			return NewSyscallError("fsync", e);
		}
		return $ifaceNil;
	};
	File.prototype.Sync = function() { return this.$val.Sync(); };
	File.ptr.prototype.Fd = function() {
		var $ptr, f;
		f = this;
		if (f === ptrType$1.nil) {
			return 4294967295;
		}
		return (f.file.fd >>> 0);
	};
	File.prototype.Fd = function() { return this.$val.Fd(); };
	NewFile = function(fd, name) {
		var $ptr, f, fd, fdi, name;
		fdi = (fd >> 0);
		if (fdi < 0) {
			return ptrType$1.nil;
		}
		f = new File.ptr(new file.ptr(fdi, name, ptrType.nil));
		runtime.SetFinalizer(f.file, new funcType$1($methodExpr(ptrType$12, "close")));
		return f;
	};
	$pkg.NewFile = NewFile;
	epipecheck = function(file$1, e) {
		var $ptr, e, file$1;
		if ($interfaceIsEqual(e, new syscall.Errno(32)) && ((file$1.file.fd === 1) || (file$1.file.fd === 2))) {
			sigpipe();
		}
	};
	File.ptr.prototype.Close = function() {
		var $ptr, f;
		f = this;
		if (f === ptrType$1.nil) {
			return $pkg.ErrInvalid;
		}
		return f.file.close();
	};
	File.prototype.Close = function() { return this.$val.Close(); };
	file.ptr.prototype.close = function() {
		var $ptr, e, err, file$1;
		file$1 = this;
		if (file$1 === ptrType$12.nil || file$1.fd < 0) {
			return new syscall.Errno(22);
		}
		err = $ifaceNil;
		e = syscall.Close(file$1.fd);
		if (!($interfaceIsEqual(e, $ifaceNil))) {
			err = new PathError.ptr("close", file$1.name, e);
		}
		file$1.fd = -1;
		runtime.SetFinalizer(file$1, $ifaceNil);
		return err;
	};
	file.prototype.close = function() { return this.$val.close(); };
	File.ptr.prototype.Stat = function() {
		var $ptr, err, f, fs;
		f = this;
		if (f === ptrType$1.nil) {
			return [$ifaceNil, $pkg.ErrInvalid];
		}
		fs = new fileStat.ptr("", new $Int64(0, 0), 0, new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil), new syscall.Stat_t.ptr(0, 0, 0, new $Uint64(0, 0), 0, 0, 0, arrayType.zero(), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new $Int64(0, 0), new $Int64(0, 0), 0, 0, 0, 0, arrayType$2.zero()));
		err = syscall.Fstat(f.file.fd, fs.sys);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [$ifaceNil, new PathError.ptr("stat", f.file.name, err)];
		}
		fillFileStatFromSys(fs, f.file.name);
		return [fs, $ifaceNil];
	};
	File.prototype.Stat = function() { return this.$val.Stat(); };
	Lstat = function(name) {
		var $ptr, err, fs, name;
		fs = new fileStat.ptr("", new $Int64(0, 0), 0, new time.Time.ptr(new $Int64(0, 0), 0, ptrType$13.nil), new syscall.Stat_t.ptr(0, 0, 0, new $Uint64(0, 0), 0, 0, 0, arrayType.zero(), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new syscall.Timespec.ptr(new $Int64(0, 0), new $Int64(0, 0)), new $Int64(0, 0), new $Int64(0, 0), 0, 0, 0, 0, arrayType$2.zero()));
		err = syscall.Lstat(name, fs.sys);
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [$ifaceNil, new PathError.ptr("lstat", name, err)];
		}
		fillFileStatFromSys(fs, name);
		return [fs, $ifaceNil];
	};
	$pkg.Lstat = Lstat;
	File.ptr.prototype.readdir = function(n) {
		var $ptr, _i, _r, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, _tuple$1, dirname, err, f, fi, filename, fip, lerr, n, names, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; dirname = $f.dirname; err = $f.err; f = $f.f; fi = $f.fi; filename = $f.filename; fip = $f.fip; lerr = $f.lerr; n = $f.n; names = $f.names; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fi = sliceType$2.nil;
		err = $ifaceNil;
		f = this;
		dirname = f.file.name;
		if (dirname === "") {
			dirname = ".";
		}
		_tuple = f.Readdirnames(n);
		names = _tuple[0];
		err = _tuple[1];
		fi = $makeSlice(sliceType$2, 0, names.$length);
		_ref = names;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			filename = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_r = lstat(dirname + "/" + filename); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple$1 = _r;
			fip = _tuple$1[0];
			lerr = _tuple$1[1];
			if (IsNotExist(lerr)) {
				_i++;
				/* continue; */ $s = 1; continue;
			}
			if (!($interfaceIsEqual(lerr, $ifaceNil))) {
				_tmp = fi;
				_tmp$1 = lerr;
				fi = _tmp;
				err = _tmp$1;
				$s = -1; return [fi, err];
				return [fi, err];
			}
			fi = $append(fi, fip);
			_i++;
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = fi;
		_tmp$3 = err;
		fi = _tmp$2;
		err = _tmp$3;
		$s = -1; return [fi, err];
		return [fi, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: File.ptr.prototype.readdir }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.dirname = dirname; $f.err = err; $f.f = f; $f.fi = fi; $f.filename = filename; $f.fip = fip; $f.lerr = lerr; $f.n = n; $f.names = names; $f.$s = $s; $f.$r = $r; return $f;
	};
	File.prototype.readdir = function(n) { return this.$val.readdir(n); };
	File.ptr.prototype.read = function(b) {
		var $ptr, _tuple, _tuple$1, b, err, f, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (true && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Read(f.file.fd, b);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.read = function(b) { return this.$val.read(b); };
	File.ptr.prototype.pread = function(b, off) {
		var $ptr, _tuple, _tuple$1, b, err, f, n, off;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (true && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Pread(f.file.fd, b, off);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.pread = function(b, off) { return this.$val.pread(b, off); };
	File.ptr.prototype.write = function(b) {
		var $ptr, _tmp, _tmp$1, _tuple, _tuple$1, b, bcap, err, err$1, f, m, n;
		n = 0;
		err = $ifaceNil;
		f = this;
		while (true) {
			bcap = b;
			if (true && bcap.$length > 1073741824) {
				bcap = $subslice(bcap, 0, 1073741824);
			}
			_tuple$1 = syscall.Write(f.file.fd, bcap);
			_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
			m = _tuple[0];
			err$1 = _tuple[1];
			n = n + (m) >> 0;
			if (0 < m && m < bcap.$length || $interfaceIsEqual(err$1, new syscall.Errno(4))) {
				b = $subslice(b, m);
				continue;
			}
			if (true && !((bcap.$length === b.$length)) && $interfaceIsEqual(err$1, $ifaceNil)) {
				b = $subslice(b, m);
				continue;
			}
			_tmp = n;
			_tmp$1 = err$1;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
	};
	File.prototype.write = function(b) { return this.$val.write(b); };
	File.ptr.prototype.pwrite = function(b, off) {
		var $ptr, _tuple, _tuple$1, b, err, f, n, off;
		n = 0;
		err = $ifaceNil;
		f = this;
		if (true && b.$length > 1073741824) {
			b = $subslice(b, 0, 1073741824);
		}
		_tuple$1 = syscall.Pwrite(f.file.fd, b, off);
		_tuple = fixCount(_tuple$1[0], _tuple$1[1]);
		n = _tuple[0];
		err = _tuple[1];
		return [n, err];
	};
	File.prototype.pwrite = function(b, off) { return this.$val.pwrite(b, off); };
	File.ptr.prototype.seek = function(offset, whence) {
		var $ptr, _tuple, err, f, offset, ret, whence;
		ret = new $Int64(0, 0);
		err = $ifaceNil;
		f = this;
		_tuple = syscall.Seek(f.file.fd, offset, whence);
		ret = _tuple[0];
		err = _tuple[1];
		return [ret, err];
	};
	File.prototype.seek = function(offset, whence) { return this.$val.seek(offset, whence); };
	basename = function(name) {
		var $ptr, i, name;
		i = name.length - 1 >> 0;
		while (true) {
			if (!(i > 0 && (name.charCodeAt(i) === 47))) { break; }
			name = $substring(name, 0, i);
			i = i - (1) >> 0;
		}
		i = i - (1) >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			if (name.charCodeAt(i) === 47) {
				name = $substring(name, (i + 1 >> 0));
				break;
			}
			i = i - (1) >> 0;
		}
		return name;
	};
	init$1 = function() {
		var $ptr;
		useSyscallwd = useSyscallwdDarwin;
	};
	useSyscallwdDarwin = function(err) {
		var $ptr, err;
		return !($interfaceIsEqual(err, new syscall.Errno(45)));
	};
	init$2 = function() {
		var $ptr;
		if (false) {
			return;
		}
		$pkg.Args = runtime_args();
	};
	fillFileStatFromSys = function(fs, name) {
		var $ptr, _1, fs, name;
		fs.name = basename(name);
		fs.size = fs.sys.Size;
		time.Time.copy(fs.modTime, timespecToTime(fs.sys.Mtimespec));
		fs.mode = (((fs.sys.Mode & 511) >>> 0) >>> 0);
		_1 = (fs.sys.Mode & 61440) >>> 0;
		if ((_1 === (24576)) || (_1 === (57344))) {
			fs.mode = (fs.mode | (67108864)) >>> 0;
		} else if (_1 === (8192)) {
			fs.mode = (fs.mode | (69206016)) >>> 0;
		} else if (_1 === (16384)) {
			fs.mode = (fs.mode | (2147483648)) >>> 0;
		} else if (_1 === (4096)) {
			fs.mode = (fs.mode | (33554432)) >>> 0;
		} else if (_1 === (40960)) {
			fs.mode = (fs.mode | (134217728)) >>> 0;
		} else if (_1 === (32768)) {
		} else if (_1 === (49152)) {
			fs.mode = (fs.mode | (16777216)) >>> 0;
		}
		if (!((((fs.sys.Mode & 1024) >>> 0) === 0))) {
			fs.mode = (fs.mode | (4194304)) >>> 0;
		}
		if (!((((fs.sys.Mode & 2048) >>> 0) === 0))) {
			fs.mode = (fs.mode | (8388608)) >>> 0;
		}
		if (!((((fs.sys.Mode & 512) >>> 0) === 0))) {
			fs.mode = (fs.mode | (1048576)) >>> 0;
		}
	};
	timespecToTime = function(ts) {
		var $ptr, ts;
		ts = $clone(ts, syscall.Timespec);
		return time.Unix(ts.Sec, ts.Nsec);
	};
	init$3 = function() {
		var $ptr, _i, _ref, _rune, _tuple, err, i, osver;
		_tuple = syscall.Sysctl("kern.osrelease");
		osver = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return;
		}
		i = 0;
		_ref = osver;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			if (!((osver.charCodeAt(i) === 46))) {
				_i += _rune[1];
				continue;
			}
			_i += _rune[1];
		}
		if (i > 2 || (i === 2) && osver.charCodeAt(0) >= 49 && osver.charCodeAt(1) >= 49) {
			supportsCloseOnExec = true;
		}
	};
	FileMode.prototype.String = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, _rune, _rune$1, buf, c, c$1, i, i$1, m, w, y, y$1;
		m = this.$val;
		buf = arrayType$5.zero();
		w = 0;
		_ref = "dalTLDpSugct";
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			if (!((((m & (((y = ((31 - i >> 0) >>> 0), y < 32 ? (1 << y) : 0) >>> 0))) >>> 0) === 0))) {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = (c << 24 >>> 24));
				w = w + (1) >> 0;
			}
			_i += _rune[1];
		}
		if (w === 0) {
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
			w = w + (1) >> 0;
		}
		_ref$1 = "rwxrwxrwx";
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.length)) { break; }
			_rune$1 = $decodeRune(_ref$1, _i$1);
			i$1 = _i$1;
			c$1 = _rune$1[0];
			if (!((((m & (((y$1 = ((8 - i$1 >> 0) >>> 0), y$1 < 32 ? (1 << y$1) : 0) >>> 0))) >>> 0) === 0))) {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = (c$1 << 24 >>> 24));
			} else {
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
			}
			w = w + (1) >> 0;
			_i$1 += _rune$1[1];
		}
		return $bytesToString($subslice(new sliceType$1(buf), 0, w));
	};
	$ptrType(FileMode).prototype.String = function() { return new FileMode(this.$get()).String(); };
	FileMode.prototype.IsDir = function() {
		var $ptr, m;
		m = this.$val;
		return !((((m & 2147483648) >>> 0) === 0));
	};
	$ptrType(FileMode).prototype.IsDir = function() { return new FileMode(this.$get()).IsDir(); };
	FileMode.prototype.IsRegular = function() {
		var $ptr, m;
		m = this.$val;
		return ((m & 2399141888) >>> 0) === 0;
	};
	$ptrType(FileMode).prototype.IsRegular = function() { return new FileMode(this.$get()).IsRegular(); };
	FileMode.prototype.Perm = function() {
		var $ptr, m;
		m = this.$val;
		return (m & 511) >>> 0;
	};
	$ptrType(FileMode).prototype.Perm = function() { return new FileMode(this.$get()).Perm(); };
	fileStat.ptr.prototype.Name = function() {
		var $ptr, fs;
		fs = this;
		return fs.name;
	};
	fileStat.prototype.Name = function() { return this.$val.Name(); };
	fileStat.ptr.prototype.IsDir = function() {
		var $ptr, fs;
		fs = this;
		return new FileMode(fs.Mode()).IsDir();
	};
	fileStat.prototype.IsDir = function() { return this.$val.IsDir(); };
	fileStat.ptr.prototype.Size = function() {
		var $ptr, fs;
		fs = this;
		return fs.size;
	};
	fileStat.prototype.Size = function() { return this.$val.Size(); };
	fileStat.ptr.prototype.Mode = function() {
		var $ptr, fs;
		fs = this;
		return fs.mode;
	};
	fileStat.prototype.Mode = function() { return this.$val.Mode(); };
	fileStat.ptr.prototype.ModTime = function() {
		var $ptr, fs;
		fs = this;
		return fs.modTime;
	};
	fileStat.prototype.ModTime = function() { return this.$val.ModTime(); };
	fileStat.ptr.prototype.Sys = function() {
		var $ptr, fs;
		fs = this;
		return fs.sys;
	};
	fileStat.prototype.Sys = function() { return this.$val.Sys(); };
	ptrType$2.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "readdirnames", name: "readdirnames", pkg: "os", typ: $funcType([$Int], [sliceType, $error], false)}, {prop: "Readdir", name: "Readdir", pkg: "", typ: $funcType([$Int], [sliceType$2, $error], false)}, {prop: "Readdirnames", name: "Readdirnames", pkg: "", typ: $funcType([$Int], [sliceType, $error], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "ReadAt", name: "ReadAt", pkg: "", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "WriteAt", name: "WriteAt", pkg: "", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "Seek", name: "Seek", pkg: "", typ: $funcType([$Int64, $Int], [$Int64, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}, {prop: "Chdir", name: "Chdir", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Chmod", name: "Chmod", pkg: "", typ: $funcType([FileMode], [$error], false)}, {prop: "Chown", name: "Chown", pkg: "", typ: $funcType([$Int, $Int], [$error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([$Int64], [$error], false)}, {prop: "Sync", name: "Sync", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Fd", name: "Fd", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [$error], false)}, {prop: "Stat", name: "Stat", pkg: "", typ: $funcType([], [FileInfo, $error], false)}, {prop: "readdir", name: "readdir", pkg: "os", typ: $funcType([$Int], [sliceType$2, $error], false)}, {prop: "read", name: "read", pkg: "os", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "pread", name: "pread", pkg: "os", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "write", name: "write", pkg: "os", typ: $funcType([sliceType$1], [$Int, $error], false)}, {prop: "pwrite", name: "pwrite", pkg: "os", typ: $funcType([sliceType$1, $Int64], [$Int, $error], false)}, {prop: "seek", name: "seek", pkg: "os", typ: $funcType([$Int64, $Int], [$Int64, $error], false)}];
	ptrType$12.methods = [{prop: "close", name: "close", pkg: "os", typ: $funcType([], [$error], false)}];
	FileMode.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "IsRegular", name: "IsRegular", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Perm", name: "Perm", pkg: "", typ: $funcType([], [FileMode], false)}];
	ptrType$15.methods = [{prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Mode", name: "Mode", pkg: "", typ: $funcType([], [FileMode], false)}, {prop: "ModTime", name: "ModTime", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Sys", name: "Sys", pkg: "", typ: $funcType([], [$emptyInterface], false)}];
	PathError.init("", [{prop: "Op", name: "Op", exported: true, typ: $String, tag: ""}, {prop: "Path", name: "Path", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	SyscallError.init("", [{prop: "Syscall", name: "Syscall", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	LinkError.init("", [{prop: "Op", name: "Op", exported: true, typ: $String, tag: ""}, {prop: "Old", name: "Old", exported: true, typ: $String, tag: ""}, {prop: "New", name: "New", exported: true, typ: $String, tag: ""}, {prop: "Err", name: "Err", exported: true, typ: $error, tag: ""}]);
	File.init("os", [{prop: "file", name: "", exported: false, typ: ptrType$12, tag: ""}]);
	file.init("os", [{prop: "fd", name: "fd", exported: false, typ: $Int, tag: ""}, {prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "dirinfo", name: "dirinfo", exported: false, typ: ptrType, tag: ""}]);
	dirInfo.init("os", [{prop: "buf", name: "buf", exported: false, typ: sliceType$1, tag: ""}, {prop: "nbuf", name: "nbuf", exported: false, typ: $Int, tag: ""}, {prop: "bufp", name: "bufp", exported: false, typ: $Int, tag: ""}]);
	FileInfo.init([{prop: "IsDir", name: "IsDir", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ModTime", name: "ModTime", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Mode", name: "Mode", pkg: "", typ: $funcType([], [FileMode], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Sys", name: "Sys", pkg: "", typ: $funcType([], [$emptyInterface], false)}]);
	fileStat.init("os", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "size", name: "size", exported: false, typ: $Int64, tag: ""}, {prop: "mode", name: "mode", exported: false, typ: FileMode, tag: ""}, {prop: "modTime", name: "modTime", exported: false, typ: time.Time, tag: ""}, {prop: "sys", name: "sys", exported: false, typ: syscall.Stat_t, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.Args = sliceType.nil;
		supportsCloseOnExec = false;
		$pkg.ErrInvalid = errors.New("invalid argument");
		$pkg.ErrPermission = errors.New("permission denied");
		$pkg.ErrExist = errors.New("file already exists");
		$pkg.ErrNotExist = errors.New("file does not exist");
		errFinished = errors.New("os: process already finished");
		$pkg.Stdin = NewFile((syscall.Stdin >>> 0), "/dev/stdin");
		$pkg.Stdout = NewFile((syscall.Stdout >>> 0), "/dev/stdout");
		$pkg.Stderr = NewFile((syscall.Stderr >>> 0), "/dev/stderr");
		useSyscallwd = (function(param) {
			var $ptr, param;
			return true;
		});
		lstat = Lstat;
		init();
		init$1();
		init$2();
		init$3();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["reflect"] = (function() {
	var $pkg = {}, $init, errors, js, math, runtime, strconv, sync, uncommonType, funcType, name, nameData, mapIter, Type, Kind, tflag, rtype, typeAlg, method, ChanDir, arrayType, chanType, imethod, interfaceType, mapType, ptrType, sliceType, structField, structType, Method, nameOff, typeOff, textOff, StructField, StructTag, fieldScan, Value, flag, ValueError, sliceType$1, ptrType$1, sliceType$2, sliceType$3, mapType$1, structType$1, sliceType$5, ptrType$3, funcType$1, sliceType$6, ptrType$4, ptrType$5, sliceType$7, sliceType$8, ptrType$6, ptrType$7, structType$8, sliceType$9, sliceType$10, sliceType$11, sliceType$12, ptrType$8, ptrType$9, sliceType$14, sliceType$15, ptrType$10, sliceType$16, ptrType$16, sliceType$18, ptrType$17, funcType$3, funcType$4, funcType$5, arrayType$12, ptrType$18, initialized, uncommonTypeMap, nameMap, nameOffList, typeOffList, callHelper, jsObjectPtr, selectHelper, kindNames, methodCache, uint8Type, init, jsType, reflectType, setKindType, newName, newNameOff, newTypeOff, internalStr, isWrapped, copyStruct, makeValue, MakeSlice, TypeOf, ValueOf, FuncOf, SliceOf, Zero, unsafe_New, makeInt, typedmemmove, keyFor, mapaccess, mapassign, mapdelete, mapiterinit, mapiterkey, mapiternext, maplen, cvtDirect, methodReceiver, valueInterface, ifaceE2I, methodName, makeMethodValue, wrapJsObject, unwrapJsObject, getJsTag, chanrecv, chansend, PtrTo, implements$1, directlyAssignable, haveIdenticalUnderlyingType, toType, ifaceIndir, overflowFloat32, New, convertOp, makeFloat, makeComplex, makeString, makeBytes, makeRunes, cvtInt, cvtUint, cvtFloatInt, cvtFloatUint, cvtIntFloat, cvtUintFloat, cvtFloat, cvtComplex, cvtIntString, cvtUintString, cvtBytesString, cvtStringBytes, cvtRunesString, cvtStringRunes, cvtT2I, cvtI2I;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	math = $packages["math"];
	runtime = $packages["runtime"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	uncommonType = $pkg.uncommonType = $newType(0, $kindStruct, "reflect.uncommonType", true, "reflect", false, function(pkgPath_, mcount_, _$2_, moff_, _$4_, _methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.pkgPath = 0;
			this.mcount = 0;
			this._$2 = 0;
			this.moff = 0;
			this._$4 = 0;
			this._methods = sliceType$3.nil;
			return;
		}
		this.pkgPath = pkgPath_;
		this.mcount = mcount_;
		this._$2 = _$2_;
		this.moff = moff_;
		this._$4 = _$4_;
		this._methods = _methods_;
	});
	funcType = $pkg.funcType = $newType(0, $kindStruct, "reflect.funcType", true, "reflect", false, function(rtype_, inCount_, outCount_, _in_, _out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.inCount = 0;
			this.outCount = 0;
			this._in = sliceType$2.nil;
			this._out = sliceType$2.nil;
			return;
		}
		this.rtype = rtype_;
		this.inCount = inCount_;
		this.outCount = outCount_;
		this._in = _in_;
		this._out = _out_;
	});
	name = $pkg.name = $newType(0, $kindStruct, "reflect.name", true, "reflect", false, function(bytes_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.bytes = ptrType$5.nil;
			return;
		}
		this.bytes = bytes_;
	});
	nameData = $pkg.nameData = $newType(0, $kindStruct, "reflect.nameData", true, "reflect", false, function(name_, tag_, pkgPath_, exported_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.tag = "";
			this.pkgPath = "";
			this.exported = false;
			return;
		}
		this.name = name_;
		this.tag = tag_;
		this.pkgPath = pkgPath_;
		this.exported = exported_;
	});
	mapIter = $pkg.mapIter = $newType(0, $kindStruct, "reflect.mapIter", true, "reflect", false, function(t_, m_, keys_, i_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.t = $ifaceNil;
			this.m = null;
			this.keys = null;
			this.i = 0;
			return;
		}
		this.t = t_;
		this.m = m_;
		this.keys = keys_;
		this.i = i_;
	});
	Type = $pkg.Type = $newType(8, $kindInterface, "reflect.Type", true, "reflect", true, null);
	Kind = $pkg.Kind = $newType(4, $kindUint, "reflect.Kind", true, "reflect", true, null);
	tflag = $pkg.tflag = $newType(1, $kindUint8, "reflect.tflag", true, "reflect", false, null);
	rtype = $pkg.rtype = $newType(0, $kindStruct, "reflect.rtype", true, "reflect", false, function(size_, ptrdata_, hash_, tflag_, align_, fieldAlign_, kind_, alg_, gcdata_, str_, ptrToThis_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.size = 0;
			this.ptrdata = 0;
			this.hash = 0;
			this.tflag = 0;
			this.align = 0;
			this.fieldAlign = 0;
			this.kind = 0;
			this.alg = ptrType$4.nil;
			this.gcdata = ptrType$5.nil;
			this.str = 0;
			this.ptrToThis = 0;
			return;
		}
		this.size = size_;
		this.ptrdata = ptrdata_;
		this.hash = hash_;
		this.tflag = tflag_;
		this.align = align_;
		this.fieldAlign = fieldAlign_;
		this.kind = kind_;
		this.alg = alg_;
		this.gcdata = gcdata_;
		this.str = str_;
		this.ptrToThis = ptrToThis_;
	});
	typeAlg = $pkg.typeAlg = $newType(0, $kindStruct, "reflect.typeAlg", true, "reflect", false, function(hash_, equal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.hash = $throwNilPointerError;
			this.equal = $throwNilPointerError;
			return;
		}
		this.hash = hash_;
		this.equal = equal_;
	});
	method = $pkg.method = $newType(0, $kindStruct, "reflect.method", true, "reflect", false, function(name_, mtyp_, ifn_, tfn_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.mtyp = 0;
			this.ifn = 0;
			this.tfn = 0;
			return;
		}
		this.name = name_;
		this.mtyp = mtyp_;
		this.ifn = ifn_;
		this.tfn = tfn_;
	});
	ChanDir = $pkg.ChanDir = $newType(4, $kindInt, "reflect.ChanDir", true, "reflect", true, null);
	arrayType = $pkg.arrayType = $newType(0, $kindStruct, "reflect.arrayType", true, "reflect", false, function(rtype_, elem_, slice_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.slice = ptrType$1.nil;
			this.len = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.slice = slice_;
		this.len = len_;
	});
	chanType = $pkg.chanType = $newType(0, $kindStruct, "reflect.chanType", true, "reflect", false, function(rtype_, elem_, dir_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			this.dir = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.dir = dir_;
	});
	imethod = $pkg.imethod = $newType(0, $kindStruct, "reflect.imethod", true, "reflect", false, function(name_, typ_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = 0;
			this.typ = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
	});
	interfaceType = $pkg.interfaceType = $newType(0, $kindStruct, "reflect.interfaceType", true, "reflect", false, function(rtype_, pkgPath_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$5.nil);
			this.methods = sliceType$7.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.methods = methods_;
	});
	mapType = $pkg.mapType = $newType(0, $kindStruct, "reflect.mapType", true, "reflect", false, function(rtype_, key_, elem_, bucket_, hmap_, keysize_, indirectkey_, valuesize_, indirectvalue_, bucketsize_, reflexivekey_, needkeyupdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.key = ptrType$1.nil;
			this.elem = ptrType$1.nil;
			this.bucket = ptrType$1.nil;
			this.hmap = ptrType$1.nil;
			this.keysize = 0;
			this.indirectkey = 0;
			this.valuesize = 0;
			this.indirectvalue = 0;
			this.bucketsize = 0;
			this.reflexivekey = false;
			this.needkeyupdate = false;
			return;
		}
		this.rtype = rtype_;
		this.key = key_;
		this.elem = elem_;
		this.bucket = bucket_;
		this.hmap = hmap_;
		this.keysize = keysize_;
		this.indirectkey = indirectkey_;
		this.valuesize = valuesize_;
		this.indirectvalue = indirectvalue_;
		this.bucketsize = bucketsize_;
		this.reflexivekey = reflexivekey_;
		this.needkeyupdate = needkeyupdate_;
	});
	ptrType = $pkg.ptrType = $newType(0, $kindStruct, "reflect.ptrType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	sliceType = $pkg.sliceType = $newType(0, $kindStruct, "reflect.sliceType", true, "reflect", false, function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	structField = $pkg.structField = $newType(0, $kindStruct, "reflect.structField", true, "reflect", false, function(name_, typ_, offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = new name.ptr(ptrType$5.nil);
			this.typ = ptrType$1.nil;
			this.offset = 0;
			return;
		}
		this.name = name_;
		this.typ = typ_;
		this.offset = offset_;
	});
	structType = $pkg.structType = $newType(0, $kindStruct, "reflect.structType", true, "reflect", false, function(rtype_, pkgPath_, fields_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
			this.pkgPath = new name.ptr(ptrType$5.nil);
			this.fields = sliceType$8.nil;
			return;
		}
		this.rtype = rtype_;
		this.pkgPath = pkgPath_;
		this.fields = fields_;
	});
	Method = $pkg.Method = $newType(0, $kindStruct, "reflect.Method", true, "reflect", true, function(Name_, PkgPath_, Type_, Func_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Func = new Value.ptr(ptrType$1.nil, 0, 0);
			this.Index = 0;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Func = Func_;
		this.Index = Index_;
	});
	nameOff = $pkg.nameOff = $newType(4, $kindInt32, "reflect.nameOff", true, "reflect", false, null);
	typeOff = $pkg.typeOff = $newType(4, $kindInt32, "reflect.typeOff", true, "reflect", false, null);
	textOff = $pkg.textOff = $newType(4, $kindInt32, "reflect.textOff", true, "reflect", false, null);
	StructField = $pkg.StructField = $newType(0, $kindStruct, "reflect.StructField", true, "reflect", true, function(Name_, PkgPath_, Type_, Tag_, Offset_, Index_, Anonymous_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Tag = "";
			this.Offset = 0;
			this.Index = sliceType$14.nil;
			this.Anonymous = false;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Tag = Tag_;
		this.Offset = Offset_;
		this.Index = Index_;
		this.Anonymous = Anonymous_;
	});
	StructTag = $pkg.StructTag = $newType(8, $kindString, "reflect.StructTag", true, "reflect", true, null);
	fieldScan = $pkg.fieldScan = $newType(0, $kindStruct, "reflect.fieldScan", true, "reflect", false, function(typ_, index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$10.nil;
			this.index = sliceType$14.nil;
			return;
		}
		this.typ = typ_;
		this.index = index_;
	});
	Value = $pkg.Value = $newType(0, $kindStruct, "reflect.Value", true, "reflect", true, function(typ_, ptr_, flag_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$1.nil;
			this.ptr = 0;
			this.flag = 0;
			return;
		}
		this.typ = typ_;
		this.ptr = ptr_;
		this.flag = flag_;
	});
	flag = $pkg.flag = $newType(4, $kindUintptr, "reflect.flag", true, "reflect", false, null);
	ValueError = $pkg.ValueError = $newType(0, $kindStruct, "reflect.ValueError", true, "reflect", true, function(Method_, Kind_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.Kind = 0;
			return;
		}
		this.Method = Method_;
		this.Kind = Kind_;
	});
	sliceType$1 = $sliceType(name);
	ptrType$1 = $ptrType(rtype);
	sliceType$2 = $sliceType(ptrType$1);
	sliceType$3 = $sliceType(method);
	mapType$1 = $mapType(ptrType$1, sliceType$3);
	structType$1 = $structType("reflect", [{prop: "RWMutex", name: "", exported: true, typ: sync.RWMutex, tag: ""}, {prop: "m", name: "m", exported: false, typ: mapType$1, tag: ""}]);
	sliceType$5 = $sliceType($emptyInterface);
	ptrType$3 = $ptrType(js.Object);
	funcType$1 = $funcType([sliceType$5], [ptrType$3], true);
	sliceType$6 = $sliceType($String);
	ptrType$4 = $ptrType(typeAlg);
	ptrType$5 = $ptrType($Uint8);
	sliceType$7 = $sliceType(imethod);
	sliceType$8 = $sliceType(structField);
	ptrType$6 = $ptrType(uncommonType);
	ptrType$7 = $ptrType(nameData);
	structType$8 = $structType("reflect", [{prop: "str", name: "str", exported: false, typ: $String, tag: ""}]);
	sliceType$9 = $sliceType(ptrType$3);
	sliceType$10 = $sliceType(Value);
	sliceType$11 = $sliceType(Type);
	sliceType$12 = $sliceType(sliceType$9);
	ptrType$8 = $ptrType(interfaceType);
	ptrType$9 = $ptrType(imethod);
	sliceType$14 = $sliceType($Int);
	sliceType$15 = $sliceType(fieldScan);
	ptrType$10 = $ptrType(structType);
	sliceType$16 = $sliceType($Uint8);
	ptrType$16 = $ptrType($UnsafePointer);
	sliceType$18 = $sliceType($Int32);
	ptrType$17 = $ptrType(funcType);
	funcType$3 = $funcType([$String], [$Bool], false);
	funcType$4 = $funcType([$UnsafePointer, $Uintptr], [$Uintptr], false);
	funcType$5 = $funcType([$UnsafePointer, $UnsafePointer], [$Bool], false);
	arrayType$12 = $arrayType($Uintptr, 2);
	ptrType$18 = $ptrType(ValueError);
	init = function() {
		var $ptr, used, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; used = $f.used; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		used = (function(i) {
			var $ptr, i;
		});
		$r = used((x = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$1 = new uncommonType.ptr(0, 0, 0, 0, 0, sliceType$3.nil), new x$1.constructor.elem(x$1))); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$2 = new method.ptr(0, 0, 0, 0), new x$2.constructor.elem(x$2))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$3 = new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, 0), new x$3.constructor.elem(x$3))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$4 = new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, 0), new x$4.constructor.elem(x$4))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$5 = new funcType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), 0, 0, sliceType$2.nil, sliceType$2.nil), new x$5.constructor.elem(x$5))); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$6 = new interfaceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new name.ptr(ptrType$5.nil), sliceType$7.nil), new x$6.constructor.elem(x$6))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$7 = new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false), new x$7.constructor.elem(x$7))); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$8 = new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil), new x$8.constructor.elem(x$8))); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$9 = new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), ptrType$1.nil), new x$9.constructor.elem(x$9))); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$10 = new structType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), new name.ptr(ptrType$5.nil), sliceType$8.nil), new x$10.constructor.elem(x$10))); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$11 = new imethod.ptr(0, 0), new x$11.constructor.elem(x$11))); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$12 = new structField.ptr(new name.ptr(ptrType$5.nil), ptrType$1.nil, 0), new x$12.constructor.elem(x$12))); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = true;
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: init }; } $f.$ptr = $ptr; $f.used = used; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	jsType = function(typ) {
		var $ptr, typ;
		return typ.jsType;
	};
	reflectType = function(typ) {
		var $ptr, _1, _i, _i$1, _i$2, _i$3, _i$4, _key, _ref, _ref$1, _ref$2, _ref$3, _ref$4, dir, f, fields, i, i$1, i$2, i$3, i$4, imethods, in$1, m, m$1, methodSet, methods, out, outCount, params, reflectFields, reflectMethods, results, rt, typ, ut;
		if (typ.reflectType === undefined) {
			rt = new rtype.ptr((($parseInt(typ.size) >> 0) >>> 0), 0, 0, 0, 0, 0, (($parseInt(typ.kind) >> 0) << 24 >>> 24), ptrType$4.nil, ptrType$5.nil, newNameOff(newName(internalStr(typ.string), "", "", !!(typ.exported))), 0);
			rt.jsType = typ;
			typ.reflectType = rt;
			methodSet = $methodSet(typ);
			if (!(($parseInt(methodSet.length) === 0)) || !!(typ.named)) {
				rt.tflag = (rt.tflag | (1)) >>> 0;
				if (!!(typ.named)) {
					rt.tflag = (rt.tflag | (4)) >>> 0;
				}
				reflectMethods = $makeSlice(sliceType$3, $parseInt(methodSet.length));
				_ref = reflectMethods;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i = _i;
					m = methodSet[i];
					method.copy(((i < 0 || i >= reflectMethods.$length) ? $throwRuntimeError("index out of range") : reflectMethods.$array[reflectMethods.$offset + i]), new method.ptr(newNameOff(newName(internalStr(m.name), "", "", internalStr(m.pkg) === "")), newTypeOff(reflectType(m.typ)), 0, 0));
					_i++;
				}
				ut = new uncommonType.ptr(newNameOff(newName(internalStr(typ.pkg), "", "", false)), ($parseInt(methodSet.length) << 16 >>> 16), 0, 0, 0, reflectMethods);
				_key = rt; (uncommonTypeMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: ut };
				ut.jsType = typ;
			}
			_1 = rt.Kind();
			if (_1 === (17)) {
				setKindType(rt, new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem), ptrType$1.nil, (($parseInt(typ.len) >> 0) >>> 0)));
			} else if (_1 === (18)) {
				dir = 3;
				if (!!(typ.sendOnly)) {
					dir = 2;
				}
				if (!!(typ.recvOnly)) {
					dir = 1;
				}
				setKindType(rt, new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem), (dir >>> 0)));
			} else if (_1 === (19)) {
				params = typ.params;
				in$1 = $makeSlice(sliceType$2, $parseInt(params.length));
				_ref$1 = in$1;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					i$1 = _i$1;
					((i$1 < 0 || i$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i$1] = reflectType(params[i$1]));
					_i$1++;
				}
				results = typ.results;
				out = $makeSlice(sliceType$2, $parseInt(results.length));
				_ref$2 = out;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					((i$2 < 0 || i$2 >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i$2] = reflectType(results[i$2]));
					_i$2++;
				}
				outCount = ($parseInt(results.length) << 16 >>> 16);
				if (!!(typ.variadic)) {
					outCount = (outCount | (32768)) >>> 0;
				}
				setKindType(rt, new funcType.ptr($clone(rt, rtype), ($parseInt(params.length) << 16 >>> 16), outCount, in$1, out));
			} else if (_1 === (20)) {
				methods = typ.methods;
				imethods = $makeSlice(sliceType$7, $parseInt(methods.length));
				_ref$3 = imethods;
				_i$3 = 0;
				while (true) {
					if (!(_i$3 < _ref$3.$length)) { break; }
					i$3 = _i$3;
					m$1 = methods[i$3];
					imethod.copy(((i$3 < 0 || i$3 >= imethods.$length) ? $throwRuntimeError("index out of range") : imethods.$array[imethods.$offset + i$3]), new imethod.ptr(newNameOff(newName(internalStr(m$1.name), "", "", internalStr(m$1.pkg) === "")), newTypeOff(reflectType(m$1.typ))));
					_i$3++;
				}
				setKindType(rt, new interfaceType.ptr($clone(rt, rtype), new name.ptr(ptrType$5.nil), imethods));
			} else if (_1 === (21)) {
				setKindType(rt, new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.key), reflectType(typ.elem), ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false));
			} else if (_1 === (22)) {
				setKindType(rt, new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (23)) {
				setKindType(rt, new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0), reflectType(typ.elem)));
			} else if (_1 === (25)) {
				fields = typ.fields;
				reflectFields = $makeSlice(sliceType$8, $parseInt(fields.length));
				_ref$4 = reflectFields;
				_i$4 = 0;
				while (true) {
					if (!(_i$4 < _ref$4.$length)) { break; }
					i$4 = _i$4;
					f = fields[i$4];
					structField.copy(((i$4 < 0 || i$4 >= reflectFields.$length) ? $throwRuntimeError("index out of range") : reflectFields.$array[reflectFields.$offset + i$4]), new structField.ptr($clone(newName(internalStr(f.name), internalStr(f.tag), "", !!(f.exported)), name), reflectType(f.typ), (i$4 >>> 0)));
					_i$4++;
				}
				setKindType(rt, new structType.ptr($clone(rt, rtype), $clone(newName(internalStr(typ.pkgPath), "", "", false), name), reflectFields));
			}
		}
		return typ.reflectType;
	};
	setKindType = function(rt, kindType) {
		var $ptr, kindType, rt;
		rt.kindType = kindType;
		kindType.rtype = rt;
	};
	uncommonType.ptr.prototype.methods = function() {
		var $ptr, t;
		t = this;
		return t._methods;
	};
	uncommonType.prototype.methods = function() { return this.$val.methods(); };
	rtype.ptr.prototype.uncommon = function() {
		var $ptr, _entry, t;
		t = this;
		return (_entry = uncommonTypeMap[ptrType$1.keyFor(t)], _entry !== undefined ? _entry.v : ptrType$6.nil);
	};
	rtype.prototype.uncommon = function() { return this.$val.uncommon(); };
	funcType.ptr.prototype.in$ = function() {
		var $ptr, t;
		t = this;
		return t._in;
	};
	funcType.prototype.in$ = function() { return this.$val.in$(); };
	funcType.ptr.prototype.out = function() {
		var $ptr, t;
		t = this;
		return t._out;
	};
	funcType.prototype.out = function() { return this.$val.out(); };
	name.ptr.prototype.name = function() {
		var $ptr, _entry, n, s;
		s = "";
		n = $clone(this, name);
		s = (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).name;
		return s;
	};
	name.prototype.name = function() { return this.$val.name(); };
	name.ptr.prototype.tag = function() {
		var $ptr, _entry, n, s;
		s = "";
		n = $clone(this, name);
		s = (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).tag;
		return s;
	};
	name.prototype.tag = function() { return this.$val.tag(); };
	name.ptr.prototype.pkgPath = function() {
		var $ptr, _entry, n;
		n = $clone(this, name);
		return (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).pkgPath;
	};
	name.prototype.pkgPath = function() { return this.$val.pkgPath(); };
	name.ptr.prototype.isExported = function() {
		var $ptr, _entry, n;
		n = $clone(this, name);
		return (_entry = nameMap[ptrType$5.keyFor(n.bytes)], _entry !== undefined ? _entry.v : ptrType$7.nil).exported;
	};
	name.prototype.isExported = function() { return this.$val.isExported(); };
	newName = function(n, tag, pkgPath, exported) {
		var $ptr, _key, b, exported, n, pkgPath, tag;
		b = $newDataPointer(0, ptrType$5);
		_key = b; (nameMap || $throwRuntimeError("assignment to entry in nil map"))[ptrType$5.keyFor(_key)] = { k: _key, v: new nameData.ptr(n, tag, pkgPath, exported) };
		return new name.ptr(b);
	};
	rtype.ptr.prototype.nameOff = function(off) {
		var $ptr, off, t, x;
		t = this;
		return (x = (off >> 0), ((x < 0 || x >= nameOffList.$length) ? $throwRuntimeError("index out of range") : nameOffList.$array[nameOffList.$offset + x]));
	};
	rtype.prototype.nameOff = function(off) { return this.$val.nameOff(off); };
	newNameOff = function(n) {
		var $ptr, i, n;
		n = $clone(n, name);
		i = nameOffList.$length;
		nameOffList = $append(nameOffList, n);
		return (i >> 0);
	};
	rtype.ptr.prototype.typeOff = function(off) {
		var $ptr, off, t, x;
		t = this;
		return (x = (off >> 0), ((x < 0 || x >= typeOffList.$length) ? $throwRuntimeError("index out of range") : typeOffList.$array[typeOffList.$offset + x]));
	};
	rtype.prototype.typeOff = function(off) { return this.$val.typeOff(off); };
	newTypeOff = function(t) {
		var $ptr, i, t;
		i = typeOffList.$length;
		typeOffList = $append(typeOffList, t);
		return (i >> 0);
	};
	internalStr = function(strObj) {
		var $ptr, c, strObj;
		c = new structType$8.ptr("");
		c.str = strObj;
		return c.str;
	};
	isWrapped = function(typ) {
		var $ptr, typ;
		return !!(jsType(typ).wrapped);
	};
	copyStruct = function(dst, src, typ) {
		var $ptr, dst, fields, i, prop, src, typ;
		fields = jsType(typ).fields;
		i = 0;
		while (true) {
			if (!(i < $parseInt(fields.length))) { break; }
			prop = $internalize(fields[i].prop, $String);
			dst[$externalize(prop, $String)] = src[$externalize(prop, $String)];
			i = i + (1) >> 0;
		}
	};
	makeValue = function(t, v, fl) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _v, _v$1, fl, rt, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _v = $f._v; _v$1 = $f._v$1; fl = $f.fl; rt = $f.rt; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rt = _r;
		_r$1 = t.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (_r$1 === 17) { _v$1 = true; $s = 5; continue s; }
		_r$2 = t.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v$1 = _r$2 === 25; case 5:
		if (_v$1) { _v = true; $s = 4; continue s; }
		_r$3 = t.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3 === 22; case 4:
		/* */ if (_v) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_v) { */ case 2:
			_r$4 = t.Kind(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			$s = -1; return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
			return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
		/* } */ case 3:
		_r$5 = t.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeValue }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._v = _v; $f._v$1 = _v$1; $f.fl = fl; $f.rt = rt; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeSlice = function(typ, len, cap) {
		var $ptr, _r, _r$1, cap, len, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; len = $f.len; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		typ = [typ];
		_r = typ[0].Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 23))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 23))) { */ case 1:
			$panic(new $String("reflect.MakeSlice of non-slice type"));
		/* } */ case 2:
		if (len < 0) {
			$panic(new $String("reflect.MakeSlice: negative len"));
		}
		if (cap < 0) {
			$panic(new $String("reflect.MakeSlice: negative cap"));
		}
		if (len > cap) {
			$panic(new $String("reflect.MakeSlice: len > cap"));
		}
		_r$1 = makeValue(typ[0], $makeSlice(jsType(typ[0]), len, cap, (function(typ) { return function $b() {
			var $ptr, _r$1, _r$2, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = typ[0].Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = jsType(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			$s = -1; return _r$2.zero();
			return _r$2.zero();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.$s = $s; $f.$r = $r; return $f;
		}; })(typ)), 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeSlice }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.len = len; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeSlice = MakeSlice;
	TypeOf = function(i) {
		var $ptr, i;
		if (!initialized) {
			return new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, 0, 0);
		}
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return $ifaceNil;
		}
		return reflectType(i.constructor);
	};
	$pkg.TypeOf = TypeOf;
	ValueOf = function(i) {
		var $ptr, _r, i, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(i, $ifaceNil)) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = makeValue(reflectType(i.constructor), i.$val, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ValueOf }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ValueOf = ValueOf;
	FuncOf = function(in$1, out, variadic) {
		var $ptr, _i, _i$1, _r, _ref, _ref$1, _v, _v$1, i, i$1, in$1, jsIn, jsOut, out, v, v$1, variadic, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _v = $f._v; _v$1 = $f._v$1; i = $f.i; i$1 = $f.i$1; in$1 = $f.in$1; jsIn = $f.jsIn; jsOut = $f.jsOut; out = $f.out; v = $f.v; v$1 = $f.v$1; variadic = $f.variadic; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (!(variadic)) { _v = false; $s = 3; continue s; }
		if (in$1.$length === 0) { _v$1 = true; $s = 4; continue s; }
		_r = (x = in$1.$length - 1 >> 0, ((x < 0 || x >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x])).Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v$1 = !((_r === 23)); case 4:
		_v = _v$1; case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect.FuncOf: last arg of variadic func must be slice"));
		/* } */ case 2:
		jsIn = $makeSlice(sliceType$9, in$1.$length);
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= jsIn.$length) ? $throwRuntimeError("index out of range") : jsIn.$array[jsIn.$offset + i] = jsType(v));
			_i++;
		}
		jsOut = $makeSlice(sliceType$9, out.$length);
		_ref$1 = out;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			v$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			((i$1 < 0 || i$1 >= jsOut.$length) ? $throwRuntimeError("index out of range") : jsOut.$array[jsOut.$offset + i$1] = jsType(v$1));
			_i$1++;
		}
		$s = -1; return reflectType($funcType($externalize(jsIn, sliceType$9), $externalize(jsOut, sliceType$9), $externalize(variadic, $Bool)));
		return reflectType($funcType($externalize(jsIn, sliceType$9), $externalize(jsOut, sliceType$9), $externalize(variadic, $Bool)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: FuncOf }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._v = _v; $f._v$1 = _v$1; $f.i = i; $f.i$1 = i$1; $f.in$1 = in$1; $f.jsIn = jsIn; $f.jsOut = jsOut; $f.out = out; $f.v = v; $f.v$1 = v$1; $f.variadic = variadic; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.FuncOf = FuncOf;
	rtype.ptr.prototype.ptrTo = function() {
		var $ptr, t;
		t = this;
		return reflectType($ptrType(jsType(t)));
	};
	rtype.prototype.ptrTo = function() { return this.$val.ptrTo(); };
	SliceOf = function(t) {
		var $ptr, t;
		return reflectType($sliceType(jsType(t)));
	};
	$pkg.SliceOf = SliceOf;
	Zero = function(typ) {
		var $ptr, _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeValue(typ, jsType(typ).zero(), 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Zero }; } $f.$ptr = $ptr; $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Zero = Zero;
	unsafe_New = function(typ) {
		var $ptr, _1, typ;
		_1 = typ.Kind();
		if (_1 === (25)) {
			return new (jsType(typ).ptr)();
		} else if (_1 === (17)) {
			return jsType(typ).zero();
		} else {
			return $newDataPointer(jsType(typ).zero(), jsType(typ.ptrTo()));
		}
	};
	makeInt = function(f, bits, t) {
		var $ptr, _1, _r, bits, f, ptr, t, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; bits = $f.bits; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.Kind();
		if (_1 === (3)) {
			ptr.$set((bits.$low << 24 >> 24));
		} else if (_1 === (4)) {
			ptr.$set((bits.$low << 16 >> 16));
		} else if ((_1 === (2)) || (_1 === (5))) {
			ptr.$set((bits.$low >> 0));
		} else if (_1 === (6)) {
			ptr.$set(new $Int64(bits.$high, bits.$low));
		} else if (_1 === (8)) {
			ptr.$set((bits.$low << 24 >>> 24));
		} else if (_1 === (9)) {
			ptr.$set((bits.$low << 16 >>> 16));
		} else if ((_1 === (7)) || (_1 === (10)) || (_1 === (12))) {
			ptr.$set((bits.$low >>> 0));
		} else if (_1 === (11)) {
			ptr.$set(bits);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeInt }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.bits = bits; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	typedmemmove = function(t, dst, src) {
		var $ptr, dst, src, t;
		dst.$set(src.$get());
	};
	keyFor = function(t, key) {
		var $ptr, k, key, kv, t;
		kv = key;
		if (!(kv.$get === undefined)) {
			kv = kv.$get();
		}
		k = $internalize(jsType(t.Key()).keyFor(kv), $String);
		return [kv, k];
	};
	mapaccess = function(t, m, key) {
		var $ptr, _tuple, entry, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		entry = m[$externalize(k, $String)];
		if (entry === undefined) {
			return 0;
		}
		return $newDataPointer(entry.v, jsType(PtrTo(t.Elem())));
	};
	mapassign = function(t, m, key, val) {
		var $ptr, _r, _tuple, entry, et, jsVal, k, key, kv, m, newVal, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; entry = $f.entry; et = $f.et; jsVal = $f.jsVal; k = $f.k; key = $f.key; kv = $f.kv; m = $f.m; newVal = $f.newVal; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = keyFor(t, key);
		kv = _tuple[0];
		k = _tuple[1];
		jsVal = val.$get();
		et = t.Elem();
		_r = et.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === 25) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === 25) { */ case 1:
			newVal = jsType(et).zero();
			copyStruct(newVal, jsVal, et);
			jsVal = newVal;
		/* } */ case 2:
		entry = new ($global.Object)();
		entry.k = kv;
		entry.v = jsVal;
		m[$externalize(k, $String)] = entry;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapassign }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.entry = entry; $f.et = et; $f.jsVal = jsVal; $f.k = k; $f.key = key; $f.kv = kv; $f.m = m; $f.newVal = newVal; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapdelete = function(t, m, key) {
		var $ptr, _tuple, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		delete m[$externalize(k, $String)];
	};
	mapiterinit = function(t, m) {
		var $ptr, m, t;
		return new mapIter.ptr(t, m, $keys(m), 0);
	};
	mapiterkey = function(it) {
		var $ptr, _r, _r$1, _r$2, it, iter, k, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; it = $f.it; iter = $f.iter; k = $f.k; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		iter = it;
		k = iter.keys[iter.i];
		_r = iter.t.Key(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = PtrTo(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = jsType(_r$1); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapiterkey }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.it = it; $f.iter = iter; $f.k = k; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapiternext = function(it) {
		var $ptr, it, iter;
		iter = it;
		iter.i = iter.i + (1) >> 0;
	};
	maplen = function(m) {
		var $ptr, m;
		return $parseInt($keys(m).length);
	};
	cvtDirect = function(v, typ) {
		var $ptr, _1, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, k, slice, srcVal, typ, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; k = $f.k; slice = $f.slice; srcVal = $f.srcVal; typ = $f.typ; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		srcVal = v.object();
		/* */ if (srcVal === jsType(v.typ).nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (srcVal === jsType(v.typ).nil) { */ case 1:
			_r = makeValue(typ, jsType(typ).nil, v.flag); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
			return _r;
		/* } */ case 2:
		val = null;
			_r$1 = typ.Kind(); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			k = _r$1;
			_1 = k;
			/* */ if (_1 === (23)) { $s = 6; continue; }
			/* */ if (_1 === (22)) { $s = 7; continue; }
			/* */ if (_1 === (25)) { $s = 8; continue; }
			/* */ if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_1 === (23)) { */ case 6:
				slice = new (jsType(typ))(srcVal.$array);
				slice.$offset = srcVal.$offset;
				slice.$length = srcVal.$length;
				slice.$capacity = srcVal.$capacity;
				val = $newDataPointer(slice, jsType(PtrTo(typ)));
				$s = 11; continue;
			/* } else if (_1 === (22)) { */ case 7:
				_r$2 = typ.Elem(); /* */ $s = 14; case 14: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$3 = _r$2.Kind(); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 25) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (_r$3 === 25) { */ case 12:
					_r$4 = typ.Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_r$4, v.typ.Elem())) { $s = 16; continue; }
					/* */ $s = 17; continue;
					/* if ($interfaceIsEqual(_r$4, v.typ.Elem())) { */ case 16:
						val = srcVal;
						/* break; */ $s = 4; continue;
					/* } */ case 17:
					val = new (jsType(typ))();
					_arg = val;
					_arg$1 = srcVal;
					_r$5 = typ.Elem(); /* */ $s = 19; case 19: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_arg$2 = _r$5;
					$r = copyStruct(_arg, _arg$1, _arg$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* break; */ $s = 4; continue;
				/* } */ case 13:
				val = new (jsType(typ))(srcVal.$get, srcVal.$set);
				$s = 11; continue;
			/* } else if (_1 === (25)) { */ case 8:
				val = new (jsType(typ).ptr)();
				copyStruct(val, srcVal, typ);
				$s = 11; continue;
			/* } else if ((_1 === (17)) || (_1 === (1)) || (_1 === (18)) || (_1 === (19)) || (_1 === (20)) || (_1 === (21)) || (_1 === (24))) { */ case 9:
				val = v.ptr;
				$s = 11; continue;
			/* } else { */ case 10:
				$panic(new ValueError.ptr("reflect.Convert", k));
			/* } */ case 11:
		case 4:
		_r$6 = typ.common(); /* */ $s = 21; case 21: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_r$7 = typ.Kind(); /* */ $s = 22; case 22: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtDirect }; } $f.$ptr = $ptr; $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f.k = k; $f.slice = slice; $f.srcVal = srcVal; $f.typ = typ; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	methodReceiver = function(op, v, i) {
		var $ptr, _$37, fn, i, m, m$1, op, prop, rcvr, t, tt, ut, v, x, x$1;
		_$37 = ptrType$1.nil;
		t = ptrType$1.nil;
		fn = 0;
		v = v;
		prop = "";
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if (i < 0 || i >= tt.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!tt.rtype.nameOff(m.name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = tt.rtype.typeOff(m.typ);
			prop = tt.rtype.nameOff(m.name).name();
		} else {
			ut = v.typ.uncommon();
			if (ut === ptrType$6.nil || (i >>> 0) >= (ut.mcount >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])), method);
			if (!v.typ.nameOff(m$1.name).isExported()) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = v.typ.typeOff(m$1.mtyp);
			prop = $internalize($methodSet(jsType(v.typ))[i].prop, $String);
		}
		rcvr = v.object();
		if (isWrapped(v.typ)) {
			rcvr = new (jsType(v.typ))(rcvr);
		}
		fn = rcvr[$externalize(prop, $String)];
		return [_$37, t, fn];
	};
	valueInterface = function(v, safe) {
		var $ptr, _r, safe, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; safe = $f.safe; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.Interface", 0));
		}
		if (safe && !((((v.flag & 96) >>> 0) === 0))) {
			$panic(new $String("reflect.Value.Interface: cannot return value obtained from unexported field or method"));
		}
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Interface", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		if (isWrapped(v.typ)) {
			$s = -1; return new (jsType(v.typ))(v.object());
			return new (jsType(v.typ))(v.object());
		}
		$s = -1; return v.object();
		return v.object();
		/* */ } return; } if ($f === undefined) { $f = { $blk: valueInterface }; } $f.$ptr = $ptr; $f._r = _r; $f.safe = safe; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ifaceE2I = function(t, src, dst) {
		var $ptr, dst, src, t;
		dst.$set(src);
	};
	methodName = function() {
		var $ptr;
		return "?FIXME?";
	};
	makeMethodValue = function(op, v) {
		var $ptr, _r, _tuple, fn, fv, op, rcvr, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; fn = $f.fn; fv = $f.fv; op = $f.op; rcvr = $f.rcvr; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fn = [fn];
		rcvr = [rcvr];
		v = v;
		if (((v.flag & 512) >>> 0) === 0) {
			$panic(new $String("reflect: internal error: invalid use of makePartialFunc"));
		}
		_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
		fn[0] = _tuple[2];
		rcvr[0] = v.object();
		if (isWrapped(v.typ)) {
			rcvr[0] = new (jsType(v.typ))(rcvr[0]);
		}
		fv = js.MakeFunc((function(fn, rcvr) { return function(this$1, arguments$1) {
			var $ptr, arguments$1, this$1;
			return new $jsObjectPtr(fn[0].apply(rcvr[0], $externalize(arguments$1, sliceType$9)));
		}; })(fn, rcvr));
		_r = v.Type().common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeMethodValue }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.fn = fn; $f.fv = fv; $f.op = op; $f.rcvr = rcvr; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.ptr.prototype.pointers = function() {
		var $ptr, _1, t;
		t = this;
		_1 = t.Kind();
		if ((_1 === (22)) || (_1 === (21)) || (_1 === (18)) || (_1 === (19)) || (_1 === (25)) || (_1 === (17))) {
			return true;
		} else {
			return false;
		}
	};
	rtype.prototype.pointers = function() { return this.$val.pointers(); };
	rtype.ptr.prototype.Comparable = function() {
		var $ptr, _1, _r, _r$1, _r$2, i, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; i = $f.i; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
			_1 = t.Kind();
			/* */ if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { $s = 2; continue; }
			/* */ if (_1 === (17)) { $s = 3; continue; }
			/* */ if (_1 === (25)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((_1 === (19)) || (_1 === (23)) || (_1 === (21))) { */ case 2:
				$s = -1; return false;
				return false;
			/* } else if (_1 === (17)) { */ case 3:
				_r = t.Elem().Comparable(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (25)) { */ case 4:
				i = 0;
				/* while (true) { */ case 7:
					/* if (!(i < t.NumField())) { break; } */ if(!(i < t.NumField())) { $s = 8; continue; }
					_r$1 = t.Field(i); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = _r$1.Type.Comparable(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* */ if (!_r$2) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!_r$2) { */ case 9:
						$s = -1; return false;
						return false;
					/* } */ case 10:
					i = i + (1) >> 0;
				/* } */ $s = 7; continue; case 8:
			/* } */ case 5:
		case 1:
		$s = -1; return true;
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Comparable }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.i = i; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Comparable = function() { return this.$val.Comparable(); };
	rtype.ptr.prototype.Method = function(i) {
		var $ptr, _i, _i$1, _r, _r$1, _ref, _ref$1, arg, fl, fn, ft, i, in$1, m, methods, mt, mtyp, out, p, pname, prop, ret, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; arg = $f.arg; fl = $f.fl; fn = $f.fn; ft = $f.ft; i = $f.i; in$1 = $f.in$1; m = $f.m; methods = $f.methods; mt = $f.mt; mtyp = $f.mtyp; out = $f.out; p = $f.p; pname = $f.pname; prop = $f.prop; ret = $f.ret; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		prop = [prop];
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			Method.copy(m, tt.Method(i));
			$s = -1; return m;
			return m;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		methods = _r;
		if (i < 0 || i >= methods.$length) {
			$panic(new $String("reflect: Method index out of range"));
		}
		p = $clone(((i < 0 || i >= methods.$length) ? $throwRuntimeError("index out of range") : methods.$array[methods.$offset + i]), method);
		pname = $clone(t.nameOff(p.name), name);
		m.Name = pname.name();
		fl = 19;
		mtyp = t.typeOff(p.mtyp);
		ft = mtyp.kindType;
		in$1 = $makeSlice(sliceType$11, 0, (1 + ft.in$().$length >> 0));
		in$1 = $append(in$1, t);
		_ref = ft.in$();
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			arg = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			in$1 = $append(in$1, arg);
			_i++;
		}
		out = $makeSlice(sliceType$11, 0, ft.out().$length);
		_ref$1 = ft.out();
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			ret = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			out = $append(out, ret);
			_i$1++;
		}
		_r$1 = FuncOf(in$1, out, ft.rtype.IsVariadic()); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		mt = _r$1;
		m.Type = mt;
		prop[0] = $internalize($methodSet(t.jsType)[i].prop, $String);
		fn = js.MakeFunc((function(prop) { return function(this$1, arguments$1) {
			var $ptr, arguments$1, rcvr, this$1;
			rcvr = (0 >= arguments$1.$length ? $throwRuntimeError("index out of range") : arguments$1.$array[arguments$1.$offset + 0]);
			return new $jsObjectPtr(rcvr[$externalize(prop[0], $String)].apply(rcvr, $externalize($subslice(arguments$1, 1), sliceType$9)));
		}; })(prop));
		m.Func = new Value.ptr($assertType(mt, ptrType$1), fn, fl);
		m.Index = i;
		Method.copy(m, m);
		$s = -1; return m;
		return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Method }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f.arg = arg; $f.fl = fl; $f.fn = fn; $f.ft = ft; $f.i = i; $f.in$1 = in$1; $f.m = m; $f.methods = methods; $f.mt = mt; $f.mtyp = mtyp; $f.out = out; $f.p = p; $f.pname = pname; $f.prop = prop; $f.ret = ret; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.object = function() {
		var $ptr, _1, newVal, v, val;
		v = this;
		if ((v.typ.Kind() === 17) || (v.typ.Kind() === 25)) {
			return v.ptr;
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			val = v.ptr.$get();
			if (!(val === $ifaceNil) && !(val.constructor === jsType(v.typ))) {
				switch (0) { default:
					_1 = v.typ.Kind();
					if ((_1 === (11)) || (_1 === (6))) {
						val = new (jsType(v.typ))(val.$high, val.$low);
					} else if ((_1 === (15)) || (_1 === (16))) {
						val = new (jsType(v.typ))(val.$real, val.$imag);
					} else if (_1 === (23)) {
						if (val === val.constructor.nil) {
							val = jsType(v.typ).nil;
							break;
						}
						newVal = new (jsType(v.typ))(val.$array);
						newVal.$offset = val.$offset;
						newVal.$length = val.$length;
						newVal.$capacity = val.$capacity;
						val = newVal;
					}
				}
			}
			return val;
		}
		return v.ptr;
	};
	Value.prototype.object = function() { return this.$val.object(); };
	Value.ptr.prototype.call = function(op, in$1) {
		var $ptr, _1, _arg, _arg$1, _arg$2, _arg$3, _i, _i$1, _i$2, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tuple, arg, argsArray, elem, fn, i, i$1, i$2, i$3, in$1, isSlice, m, n, nin, nout, op, origIn, rcvr, results, ret, slice, t, targ, v, x, x$1, x$2, xt, xt$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; arg = $f.arg; argsArray = $f.argsArray; elem = $f.elem; fn = $f.fn; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; in$1 = $f.in$1; isSlice = $f.isSlice; m = $f.m; n = $f.n; nin = $f.nin; nout = $f.nout; op = $f.op; origIn = $f.origIn; rcvr = $f.rcvr; results = $f.results; ret = $f.ret; slice = $f.slice; t = $f.t; targ = $f.targ; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; xt = $f.xt; xt$1 = $f.xt$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		t = ptrType$1.nil;
		fn = 0;
		rcvr = null;
		if (!((((v.flag & 512) >>> 0) === 0))) {
			_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
			t = _tuple[1];
			fn = _tuple[2];
			rcvr = v.object();
			if (isWrapped(v.typ)) {
				rcvr = new (jsType(v.typ))(rcvr);
			}
		} else {
			t = v.typ;
			fn = v.object();
			rcvr = undefined;
		}
		if (fn === 0) {
			$panic(new $String("reflect.Value.Call: call of nil function"));
		}
		isSlice = op === "CallSlice";
		n = t.NumIn();
		if (isSlice) {
			if (!t.IsVariadic()) {
				$panic(new $String("reflect: CallSlice of non-variadic function"));
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: CallSlice with too few input arguments"));
			}
			if (in$1.$length > n) {
				$panic(new $String("reflect: CallSlice with too many input arguments"));
			}
		} else {
			if (t.IsVariadic()) {
				n = n - (1) >> 0;
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: Call with too few input arguments"));
			}
			if (!t.IsVariadic() && in$1.$length > n) {
				$panic(new $String("reflect: Call with too many input arguments"));
			}
		}
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (x.Kind() === 0) {
				$panic(new $String("reflect: " + op + " using zero Value argument"));
			}
			_i++;
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_tmp = ((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i]).Type();
			_tmp$1 = t.In(i);
			xt = _tmp;
			targ = _tmp$1;
			_r = xt.AssignableTo(targ); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				_r$1 = xt.String(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = targ.String(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$panic(new $String("reflect: " + op + " using " + _r$1 + " as type " + _r$2));
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!isSlice && t.IsVariadic()) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!isSlice && t.IsVariadic()) { */ case 8:
			m = in$1.$length - n >> 0;
			_r$3 = MakeSlice(t.In(n), m, m); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			slice = _r$3;
			_r$4 = t.In(n).Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			elem = _r$4;
			i$1 = 0;
			/* while (true) { */ case 12:
				/* if (!(i$1 < m)) { break; } */ if(!(i$1 < m)) { $s = 13; continue; }
				x$2 = (x$1 = n + i$1 >> 0, ((x$1 < 0 || x$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x$1]));
				xt$1 = x$2.Type();
				_r$5 = xt$1.AssignableTo(elem); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ if (!_r$5) { $s = 14; continue; }
				/* */ $s = 15; continue;
				/* if (!_r$5) { */ case 14:
					_r$6 = xt$1.String(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_r$7 = elem.String(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					$panic(new $String("reflect: cannot use " + _r$6 + " as type " + _r$7 + " in " + op));
				/* } */ case 15:
				_r$8 = slice.Index(i$1); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				$r = _r$8.Set(x$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i$1 = i$1 + (1) >> 0;
			/* } */ $s = 12; continue; case 13:
			origIn = in$1;
			in$1 = $makeSlice(sliceType$10, (n + 1 >> 0));
			$copySlice($subslice(in$1, 0, n), origIn);
			((n < 0 || n >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + n] = slice);
		/* } */ case 9:
		nin = in$1.$length;
		if (!((nin === t.NumIn()))) {
			$panic(new $String("reflect.Value.Call: wrong argument count"));
		}
		nout = t.NumOut();
		argsArray = new ($global.Array)(t.NumIn());
		_ref$1 = in$1;
		_i$1 = 0;
		/* while (true) { */ case 21:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 22; continue; }
			i$2 = _i$1;
			arg = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			_arg = t.In(i$2);
			_r$9 = t.In(i$2).common(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			_arg$1 = _r$9;
			_arg$2 = 0;
			_r$10 = arg.assignTo("reflect.Value.Call", _arg$1, _arg$2); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			_r$11 = _r$10.object(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			_arg$3 = _r$11;
			_r$12 = unwrapJsObject(_arg, _arg$3); /* */ $s = 26; case 26: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			argsArray[i$2] = _r$12;
			_i$1++;
		/* } */ $s = 21; continue; case 22:
		_r$13 = callHelper(new sliceType$5([new $jsObjectPtr(fn), new $jsObjectPtr(rcvr), new $jsObjectPtr(argsArray)])); /* */ $s = 27; case 27: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
		results = _r$13;
			_1 = nout;
			/* */ if (_1 === (0)) { $s = 29; continue; }
			/* */ if (_1 === (1)) { $s = 30; continue; }
			/* */ $s = 31; continue;
			/* if (_1 === (0)) { */ case 29:
				$s = -1; return sliceType$10.nil;
				return sliceType$10.nil;
			/* } else if (_1 === (1)) { */ case 30:
				_r$14 = makeValue(t.Out(0), wrapJsObject(t.Out(0), results), 0); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				$s = -1; return new sliceType$10([$clone(_r$14, Value)]);
				return new sliceType$10([$clone(_r$14, Value)]);
			/* } else { */ case 31:
				ret = $makeSlice(sliceType$10, nout);
				_ref$2 = ret;
				_i$2 = 0;
				/* while (true) { */ case 34:
					/* if (!(_i$2 < _ref$2.$length)) { break; } */ if(!(_i$2 < _ref$2.$length)) { $s = 35; continue; }
					i$3 = _i$2;
					_r$15 = makeValue(t.Out(i$3), wrapJsObject(t.Out(i$3), results[i$3]), 0); /* */ $s = 36; case 36: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					((i$3 < 0 || i$3 >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i$3] = _r$15);
					_i$2++;
				/* } */ $s = 34; continue; case 35:
				$s = -1; return ret;
				return ret;
			/* } */ case 32:
		case 28:
		$s = -1; return sliceType$10.nil;
		return sliceType$10.nil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.call }; } $f.$ptr = $ptr; $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.arg = arg; $f.argsArray = argsArray; $f.elem = elem; $f.fn = fn; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.in$1 = in$1; $f.isSlice = isSlice; $f.m = m; $f.n = n; $f.nin = nin; $f.nout = nout; $f.op = op; $f.origIn = origIn; $f.rcvr = rcvr; $f.results = results; $f.ret = ret; $f.slice = slice; $f.t = t; $f.targ = targ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.xt = xt; $f.xt$1 = xt$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.call = function(op, in$1) { return this.$val.call(op, in$1); };
	Value.ptr.prototype.Cap = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (17)) {
			return v.typ.Len();
		} else if ((_1 === (18)) || (_1 === (23))) {
			return $parseInt(v.object().$capacity) >> 0;
		}
		$panic(new ValueError.ptr("reflect.Value.Cap", k));
	};
	Value.prototype.Cap = function() { return this.$val.Cap(); };
	wrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return new (jsType(jsObjectPtr))(val);
		}
		return val;
	};
	unwrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return val.object;
		}
		return val;
	};
	Value.ptr.prototype.Elem = function() {
		var $ptr, _1, _r, fl, k, tt, typ, v, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; fl = $f.fl; k = $f.k; tt = $f.tt; typ = $f.typ; v = $f.v; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (20)) { $s = 2; continue; }
			/* */ if (_1 === (22)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_1 === (20)) { */ case 2:
				val = v.object();
				if (val === $ifaceNil) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				typ = reflectType(val.constructor);
				_r = makeValue(typ, val.$val, (v.flag & 96) >>> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (22)) { */ case 3:
				if (v.IsNil()) {
					$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				val$1 = v.object();
				tt = v.typ.kindType;
				fl = (((((v.flag & 96) >>> 0) | 128) >>> 0) | 256) >>> 0;
				fl = (fl | ((tt.elem.Kind() >>> 0))) >>> 0;
				$s = -1; return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
				return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
			/* } else { */ case 4:
				$panic(new ValueError.ptr("reflect.Value.Elem", k));
			/* } */ case 5:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Elem }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.fl = fl; $f.k = k; $f.tt = tt; $f.typ = typ; $f.v = v; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Elem = function() { return this.$val.Elem(); };
	Value.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, field, fl, i, jsTag, o, prop, s, tag, tt, typ, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; field = $f.field; fl = $f.fl; i = $f.i; jsTag = $f.jsTag; o = $f.o; prop = $f.prop; s = $f.s; tag = $f.tag; tt = $f.tt; typ = $f.typ; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		jsTag = [jsTag];
		prop = [prop];
		s = [s];
		typ = [typ];
		v = this;
		if (!((new flag(v.flag).kind() === 25))) {
			$panic(new ValueError.ptr("reflect.Value.Field", new flag(v.flag).kind()));
		}
		tt = v.typ.kindType;
		if ((i >>> 0) >= (tt.fields.$length >>> 0)) {
			$panic(new $String("reflect: Field index out of range"));
		}
		prop[0] = $internalize(jsType(v.typ).fields[i].prop, $String);
		field = (x = tt.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		typ[0] = field.typ;
		fl = (((v.flag & 416) >>> 0) | (typ[0].Kind() >>> 0)) >>> 0;
		if (!field.name.isExported()) {
			if (field.name.name() === "") {
				fl = (fl | (64)) >>> 0;
			} else {
				fl = (fl | (32)) >>> 0;
			}
		}
		tag = (x$1 = tt.fields, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])).name.tag();
		/* */ if (!(tag === "") && !((i === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(tag === "") && !((i === 0))) { */ case 1:
			jsTag[0] = getJsTag(tag);
			/* */ if (!(jsTag[0] === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(jsTag[0] === "")) { */ case 3:
				/* while (true) { */ case 5:
					o = [o];
					_r = v.Field(0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					/* */ if (v.typ === jsObjectPtr) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (v.typ === jsObjectPtr) { */ case 8:
						o[0] = v.object().object;
						$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
						return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
					/* } */ case 9:
					/* */ if (v.typ.Kind() === 22) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (v.typ.Kind() === 22) { */ case 10:
						_r$1 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						v = _r$1;
					/* } */ case 11:
				/* } */ $s = 5; continue; case 6:
			/* } */ case 4:
		/* } */ case 2:
		s[0] = v.ptr;
		/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 13:
			$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
			return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
		/* } */ case 14:
		_r$2 = makeValue(typ[0], wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]), fl); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.field = field; $f.fl = fl; $f.i = i; $f.jsTag = jsTag; $f.o = o; $f.prop = prop; $f.s = s; $f.tag = tag; $f.tt = tt; $f.typ = typ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Field = function(i) { return this.$val.Field(i); };
	getJsTag = function(tag) {
		var $ptr, _tuple, i, name$1, qvalue, tag, value;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 32)) && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = $substring(tag, 0, i);
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = $substring(tag, 0, (i + 1 >> 0));
			tag = $substring(tag, (i + 1 >> 0));
			if (name$1 === "js") {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				return value;
			}
		}
		return "";
	};
	Value.ptr.prototype.Index = function(i) {
		var $ptr, _1, _r, _r$1, a, a$1, c, fl, fl$1, fl$2, i, k, s, str, tt, tt$1, typ, typ$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; a = $f.a; a$1 = $f.a$1; c = $f.c; fl = $f.fl; fl$1 = $f.fl$1; fl$2 = $f.fl$2; i = $f.i; k = $f.k; s = $f.s; str = $f.str; tt = $f.tt; tt$1 = $f.tt$1; typ = $f.typ; typ$1 = $f.typ$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		a$1 = [a$1];
		c = [c];
		i = [i];
		typ = [typ];
		typ$1 = [typ$1];
		v = this;
			k = new flag(v.flag).kind();
			_1 = k;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				tt = v.typ.kindType;
				if (i[0] < 0 || i[0] > (tt.len >> 0)) {
					$panic(new $String("reflect: array index out of range"));
				}
				typ[0] = tt.elem;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((typ[0].Kind() >>> 0))) >>> 0;
				a[0] = v.ptr;
				/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 7:
					$s = -1; return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
					return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
				/* } */ case 8:
				_r = makeValue(typ[0], wrapJsObject(typ[0], a[0][i[0]]), fl); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else if (_1 === (23)) { */ case 3:
				s = v.object();
				if (i[0] < 0 || i[0] >= ($parseInt(s.$length) >> 0)) {
					$panic(new $String("reflect: slice index out of range"));
				}
				tt$1 = v.typ.kindType;
				typ$1[0] = tt$1.elem;
				fl$1 = (384 | ((v.flag & 96) >>> 0)) >>> 0;
				fl$1 = (fl$1 | ((typ$1[0].Kind() >>> 0))) >>> 0;
				i[0] = i[0] + (($parseInt(s.$offset) >> 0)) >> 0;
				a$1[0] = s.$array;
				/* */ if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { */ case 10:
					$s = -1; return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
					return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
				/* } */ case 11:
				_r$1 = makeValue(typ$1[0], wrapJsObject(typ$1[0], a$1[0][i[0]]), fl$1); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				$s = -1; return _r$1;
				return _r$1;
			/* } else if (_1 === (24)) { */ case 4:
				str = v.ptr.$get();
				if (i[0] < 0 || i[0] >= str.length) {
					$panic(new $String("reflect: string index out of range"));
				}
				fl$2 = (((v.flag & 96) >>> 0) | 8) >>> 0;
				c[0] = str.charCodeAt(i[0]);
				$s = -1; return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
				return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Index", k));
			/* } */ case 6:
		case 1:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Index }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.a$1 = a$1; $f.c = c; $f.fl = fl; $f.fl$1 = fl$1; $f.fl$2 = fl$2; $f.i = i; $f.k = k; $f.s = s; $f.str = str; $f.tt = tt; $f.tt$1 = tt$1; $f.typ = typ; $f.typ$1 = typ$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Index = function(i) { return this.$val.Index(i); };
	Value.ptr.prototype.InterfaceData = function() {
		var $ptr, v;
		v = this;
		$panic(errors.New("InterfaceData is not supported by GopherJS"));
	};
	Value.prototype.InterfaceData = function() { return this.$val.InterfaceData(); };
	Value.ptr.prototype.IsNil = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (22)) || (_1 === (23))) {
			return v.object() === jsType(v.typ).nil;
		} else if (_1 === (18)) {
			return v.object() === $chanNil;
		} else if (_1 === (19)) {
			return v.object() === $throwNilPointerError;
		} else if (_1 === (21)) {
			return v.object() === false;
		} else if (_1 === (20)) {
			return v.object() === $ifaceNil;
		} else {
			$panic(new ValueError.ptr("reflect.Value.IsNil", k));
		}
	};
	Value.prototype.IsNil = function() { return this.$val.IsNil(); };
	Value.ptr.prototype.Len = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (17)) || (_1 === (24))) {
			return $parseInt(v.object().length);
		} else if (_1 === (23)) {
			return $parseInt(v.object().$length) >> 0;
		} else if (_1 === (18)) {
			return $parseInt(v.object().$buffer.length) >> 0;
		} else if (_1 === (21)) {
			return $parseInt($keys(v.object()).length);
		} else {
			$panic(new ValueError.ptr("reflect.Value.Len", k));
		}
	};
	Value.prototype.Len = function() { return this.$val.Len(); };
	Value.ptr.prototype.Pointer = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (18)) || (_1 === (21)) || (_1 === (22)) || (_1 === (26))) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object();
		} else if (_1 === (19)) {
			if (v.IsNil()) {
				return 0;
			}
			return 1;
		} else if (_1 === (23)) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object().$array;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Pointer", k));
		}
	};
	Value.prototype.Pointer = function() { return this.$val.Pointer(); };
	Value.ptr.prototype.Set = function(x) {
		var $ptr, _1, _r, _r$1, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Set", v.typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		/* */ if (!((((v.flag & 128) >>> 0) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((((v.flag & 128) >>> 0) === 0))) { */ case 2:
				_1 = v.typ.Kind();
				/* */ if (_1 === (17)) { $s = 5; continue; }
				/* */ if (_1 === (20)) { $s = 6; continue; }
				/* */ if (_1 === (25)) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (_1 === (17)) { */ case 5:
					jsType(v.typ).copy(v.ptr, x.ptr);
					$s = 9; continue;
				/* } else if (_1 === (20)) { */ case 6:
					_r$1 = valueInterface(x, false); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					v.ptr.$set(_r$1);
					$s = 9; continue;
				/* } else if (_1 === (25)) { */ case 7:
					copyStruct(v.ptr, x.ptr, v.typ);
					$s = 9; continue;
				/* } else { */ case 8:
					v.ptr.$set(x.object());
				/* } */ case 9:
			case 4:
			$s = -1; return;
			return;
		/* } */ case 3:
		v.ptr = x.ptr;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Set }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Set = function(x) { return this.$val.Set(x); };
	Value.ptr.prototype.SetBytes = function(x) {
		var $ptr, _r, _r$1, _v, slice, typedSlice, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; slice = $f.slice; typedSlice = $f.typedSlice; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.SetBytes of non-byte slice"));
		/* } */ case 2:
		slice = x;
		if (!(v.typ.Name() === "")) { _v = true; $s = 6; continue s; }
		_r$1 = v.typ.Elem().Name(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_v = !(_r$1 === ""); case 6:
		/* */ if (_v) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_v) { */ case 4:
			typedSlice = new (jsType(v.typ))(slice.$array);
			typedSlice.$offset = slice.$offset;
			typedSlice.$length = slice.$length;
			typedSlice.$capacity = slice.$capacity;
			slice = typedSlice;
		/* } */ case 5:
		v.ptr.$set(slice);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.slice = slice; $f.typedSlice = typedSlice; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetBytes = function(x) { return this.$val.SetBytes(x); };
	Value.ptr.prototype.SetCap = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < ($parseInt(s.$length) >> 0) || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice capacity out of range in SetCap"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = s.$length;
		newSlice.$capacity = n;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetCap = function(n) { return this.$val.SetCap(n); };
	Value.ptr.prototype.SetLen = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < 0 || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice length out of range in SetLen"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = n;
		newSlice.$capacity = s.$capacity;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetLen = function(n) { return this.$val.SetLen(n); };
	Value.ptr.prototype.Slice = function(i, j) {
		var $ptr, _1, _r, _r$1, cap, i, j, kind, s, str, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; i = $f.i; j = $f.j; kind = $f.kind; s = $f.s; str = $f.str; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
			kind = new flag(v.flag).kind();
			_1 = kind;
			/* */ if (_1 === (17)) { $s = 2; continue; }
			/* */ if (_1 === (23)) { $s = 3; continue; }
			/* */ if (_1 === (24)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_1 === (17)) { */ case 2:
				if (((v.flag & 256) >>> 0) === 0) {
					$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
				}
				tt = v.typ.kindType;
				cap = (tt.len >> 0);
				typ = SliceOf(tt.elem);
				s = new (jsType(typ))(v.object());
				$s = 6; continue;
			/* } else if (_1 === (23)) { */ case 3:
				typ = v.typ;
				s = v.object();
				cap = $parseInt(s.$capacity) >> 0;
				$s = 6; continue;
			/* } else if (_1 === (24)) { */ case 4:
				str = v.ptr.$get();
				if (i < 0 || j < i || j > str.length) {
					$panic(new $String("reflect.Value.Slice: string slice index out of bounds"));
				}
				_r = ValueOf(new $String($substring(str, i, j))); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				$s = -1; return _r;
				return _r;
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Slice", kind));
			/* } */ case 6:
		case 1:
		if (i < 0 || j < i || j > cap) {
			$panic(new $String("reflect.Value.Slice: slice index out of bounds"));
		}
		_r$1 = makeValue(typ, $subslice(s, i, j), (v.flag & 96) >>> 0); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.i = i; $f.j = j; $f.kind = kind; $f.s = s; $f.str = str; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice = function(i, j) { return this.$val.Slice(i, j); };
	Value.ptr.prototype.Slice3 = function(i, j, k) {
		var $ptr, _1, _r, cap, i, j, k, kind, s, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; cap = $f.cap; i = $f.i; j = $f.j; k = $f.k; kind = $f.kind; s = $f.s; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
		kind = new flag(v.flag).kind();
		_1 = kind;
		if (_1 === (17)) {
			if (((v.flag & 256) >>> 0) === 0) {
				$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
			}
			tt = v.typ.kindType;
			cap = (tt.len >> 0);
			typ = SliceOf(tt.elem);
			s = new (jsType(typ))(v.object());
		} else if (_1 === (23)) {
			typ = v.typ;
			s = v.object();
			cap = $parseInt(s.$capacity) >> 0;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Slice3", kind));
		}
		if (i < 0 || j < i || k < j || k > cap) {
			$panic(new $String("reflect.Value.Slice3: slice index out of bounds"));
		}
		_r = makeValue(typ, $subslice(s, i, j, k), (v.flag & 96) >>> 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice3 }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.cap = cap; $f.i = i; $f.j = j; $f.k = k; $f.kind = kind; $f.s = s; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice3 = function(i, j, k) { return this.$val.Slice3(i, j, k); };
	Value.ptr.prototype.Close = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		$close(v.object());
	};
	Value.prototype.Close = function() { return this.$val.Close(); };
	chanrecv = function(t, ch, nb, val) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, ch, comms, nb, received, recvRes, selectRes, selected, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; ch = $f.ch; comms = $f.comms; nb = $f.nb; received = $f.received; recvRes = $f.recvRes; selectRes = $f.selectRes; selected = $f.selected; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		received = false;
		comms = new sliceType$12([new sliceType$9([ch])]);
		if (nb) {
			comms = $append(comms, new sliceType$9([]));
		}
		_r = selectHelper(new sliceType$5([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			_tmp = false;
			_tmp$1 = false;
			selected = _tmp;
			received = _tmp$1;
			$s = -1; return [selected, received];
			return [selected, received];
		}
		recvRes = selectRes[1];
		val.$set(recvRes[0]);
		_tmp$2 = true;
		_tmp$3 = !!(recvRes[1]);
		selected = _tmp$2;
		received = _tmp$3;
		$s = -1; return [selected, received];
		return [selected, received];
		/* */ } return; } if ($f === undefined) { $f = { $blk: chanrecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.received = received; $f.recvRes = recvRes; $f.selectRes = selectRes; $f.selected = selected; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	chansend = function(t, ch, val, nb) {
		var $ptr, _r, ch, comms, nb, selectRes, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; ch = $f.ch; comms = $f.comms; nb = $f.nb; selectRes = $f.selectRes; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		comms = new sliceType$12([new sliceType$9([ch, val.$get()])]);
		if (nb) {
			comms = $append(comms, new sliceType$9([]));
		}
		_r = selectHelper(new sliceType$5([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			$s = -1; return false;
			return false;
		}
		$s = -1; return true;
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: chansend }; } $f.$ptr = $ptr; $f._r = _r; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.selectRes = selectRes; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.prototype.String = function() {
		var $ptr, k;
		k = this.$val;
		if ((k >> 0) < kindNames.$length) {
			return ((k < 0 || k >= kindNames.$length) ? $throwRuntimeError("index out of range") : kindNames.$array[kindNames.$offset + k]);
		}
		return "kind" + strconv.Itoa((k >> 0));
	};
	$ptrType(Kind).prototype.String = function() { return new Kind(this.$get()).String(); };
	rtype.ptr.prototype.String = function() {
		var $ptr, s, t;
		t = this;
		s = t.nameOff(t.str).name();
		if (!((((t.tflag & 2) >>> 0) === 0))) {
			return $substring(s, 1);
		}
		return s;
	};
	rtype.prototype.String = function() { return this.$val.String(); };
	rtype.ptr.prototype.Size = function() {
		var $ptr, t;
		t = this;
		return t.size;
	};
	rtype.prototype.Size = function() { return this.$val.Size(); };
	rtype.ptr.prototype.Bits = function() {
		var $ptr, k, t;
		t = this;
		if (t === ptrType$1.nil) {
			$panic(new $String("reflect: Bits of nil Type"));
		}
		k = t.Kind();
		if (k < 2 || k > 16) {
			$panic(new $String("reflect: Bits of non-arithmetic Type " + t.String()));
		}
		return $imul((t.size >> 0), 8);
	};
	rtype.prototype.Bits = function() { return this.$val.Bits(); };
	rtype.ptr.prototype.Align = function() {
		var $ptr, t;
		t = this;
		return (t.align >> 0);
	};
	rtype.prototype.Align = function() { return this.$val.Align(); };
	rtype.ptr.prototype.FieldAlign = function() {
		var $ptr, t;
		t = this;
		return (t.fieldAlign >> 0);
	};
	rtype.prototype.FieldAlign = function() { return this.$val.FieldAlign(); };
	rtype.ptr.prototype.Kind = function() {
		var $ptr, t;
		t = this;
		return (((t.kind & 31) >>> 0) >>> 0);
	};
	rtype.prototype.Kind = function() { return this.$val.Kind(); };
	rtype.ptr.prototype.common = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	rtype.prototype.common = function() { return this.$val.common(); };
	rtype.ptr.prototype.exportedMethods = function() {
		var $ptr, _entry, _i, _i$1, _key, _ref, _ref$1, _tuple, allExported, allm, found, m, m$1, methods, name$1, name$2, t, ut, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _ref = $f._ref; _ref$1 = $f._ref$1; _tuple = $f._tuple; allExported = $f.allExported; allm = $f.allm; found = $f.found; m = $f.m; m$1 = $f.m$1; methods = $f.methods; name$1 = $f.name$1; name$2 = $f.name$2; t = $f.t; ut = $f.ut; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		$r = methodCache.RWMutex.RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tuple = (_entry = methodCache.m[ptrType$1.keyFor(t)], _entry !== undefined ? [_entry.v, true] : [sliceType$3.nil, false]);
		methods = _tuple[0];
		found = _tuple[1];
		$r = methodCache.RWMutex.RUnlock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (found) {
			$s = -1; return methods;
			return methods;
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			$s = -1; return sliceType$3.nil;
			return sliceType$3.nil;
		}
		allm = ut.methods();
		allExported = true;
		_ref = allm;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			m = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), method);
			name$1 = $clone(t.nameOff(m.name), name);
			if (!name$1.isExported()) {
				allExported = false;
				break;
			}
			_i++;
		}
		if (allExported) {
			methods = allm;
		} else {
			methods = $makeSlice(sliceType$3, 0, allm.$length);
			_ref$1 = allm;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				m$1 = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]), method);
				name$2 = $clone(t.nameOff(m$1.name), name);
				if (name$2.isExported()) {
					methods = $append(methods, m$1);
				}
				_i$1++;
			}
			methods = $subslice(methods, 0, methods.$length, methods.$length);
		}
		$r = methodCache.RWMutex.Lock(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (methodCache.m === false) {
			methodCache.m = {};
		}
		_key = t; (methodCache.m || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: methods };
		$r = methodCache.RWMutex.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return methods;
		return methods;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.exportedMethods }; } $f.$ptr = $ptr; $f._entry = _entry; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tuple = _tuple; $f.allExported = allExported; $f.allm = allm; $f.found = found; $f.m = m; $f.m$1 = m$1; $f.methods = methods; $f.name$1 = name$1; $f.name$2 = name$2; $f.t = t; $f.ut = ut; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.exportedMethods = function() { return this.$val.exportedMethods(); };
	rtype.ptr.prototype.NumMethod = function() {
		var $ptr, _r, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			$s = -1; return tt.NumMethod();
			return tt.NumMethod();
		}
		if (((t.tflag & 1) >>> 0) === 0) {
			$s = -1; return 0;
			return 0;
		}
		_r = t.exportedMethods(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r.$length;
		return _r.$length;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.NumMethod }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	rtype.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, i, m, name$1, ok, p, pname, t, tt, ut, utmethods, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; i = $f.i; m = $f.m; name$1 = $f.name$1; ok = $f.ok; p = $f.p; pname = $f.pname; t = $f.t; tt = $f.tt; ut = $f.ut; utmethods = $f.utmethods; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			_tuple = tt.MethodByName(name$1);
			Method.copy(m, _tuple[0]);
			ok = _tuple[1];
			$s = -1; return [m, ok];
			return [m, ok];
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			_tmp = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
			_tmp$1 = false;
			Method.copy(m, _tmp);
			ok = _tmp$1;
			$s = -1; return [m, ok];
			return [m, ok];
		}
		utmethods = ut.methods();
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (ut.mcount >> 0))) { break; } */ if(!(i < (ut.mcount >> 0))) { $s = 2; continue; }
			p = $clone(((i < 0 || i >= utmethods.$length) ? $throwRuntimeError("index out of range") : utmethods.$array[utmethods.$offset + i]), method);
			pname = $clone(t.nameOff(p.name), name);
			/* */ if (pname.isExported() && pname.name() === name$1) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (pname.isExported() && pname.name() === name$1) { */ case 3:
				_r = t.Method(i); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tmp$2 = $clone(_r, Method);
				_tmp$3 = true;
				Method.copy(m, _tmp$2);
				ok = _tmp$3;
				$s = -1; return [m, ok];
				return [m, ok];
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		_tmp$4 = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		_tmp$5 = false;
		Method.copy(m, _tmp$4);
		ok = _tmp$5;
		$s = -1; return [m, ok];
		return [m, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.MethodByName }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.i = i; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.p = p; $f.pname = pname; $f.t = t; $f.tt = tt; $f.ut = ut; $f.utmethods = utmethods; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	rtype.ptr.prototype.PkgPath = function() {
		var $ptr, t, ut;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		ut = t.uncommon();
		if (ut === ptrType$6.nil) {
			return "";
		}
		return t.nameOff(ut.pkgPath).name();
	};
	rtype.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	rtype.ptr.prototype.Name = function() {
		var $ptr, i, s, t;
		t = this;
		if (((t.tflag & 4) >>> 0) === 0) {
			return "";
		}
		s = t.String();
		i = s.length - 1 >> 0;
		while (true) {
			if (!(i >= 0)) { break; }
			if (s.charCodeAt(i) === 46) {
				break;
			}
			i = i - (1) >> 0;
		}
		return $substring(s, (i + 1 >> 0));
	};
	rtype.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.ChanDir = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 18))) {
			$panic(new $String("reflect: ChanDir of non-chan type"));
		}
		tt = t.kindType;
		return (tt.dir >> 0);
	};
	rtype.prototype.ChanDir = function() { return this.$val.ChanDir(); };
	rtype.ptr.prototype.IsVariadic = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: IsVariadic of non-func type"));
		}
		tt = t.kindType;
		return !((((tt.outCount & 32768) >>> 0) === 0));
	};
	rtype.prototype.IsVariadic = function() { return this.$val.IsVariadic(); };
	rtype.ptr.prototype.Elem = function() {
		var $ptr, _1, t, tt, tt$1, tt$2, tt$3, tt$4;
		t = this;
		_1 = t.Kind();
		if (_1 === (17)) {
			tt = t.kindType;
			return toType(tt.elem);
		} else if (_1 === (18)) {
			tt$1 = t.kindType;
			return toType(tt$1.elem);
		} else if (_1 === (21)) {
			tt$2 = t.kindType;
			return toType(tt$2.elem);
		} else if (_1 === (22)) {
			tt$3 = t.kindType;
			return toType(tt$3.elem);
		} else if (_1 === (23)) {
			tt$4 = t.kindType;
			return toType(tt$4.elem);
		}
		$panic(new $String("reflect: Elem of invalid type"));
	};
	rtype.prototype.Elem = function() { return this.$val.Elem(); };
	rtype.ptr.prototype.Field = function(i) {
		var $ptr, _r, i, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: Field of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.Field(i); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Field = function(i) { return this.$val.Field(i); };
	rtype.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _r, index, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; index = $f.index; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByIndex of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByIndex(index); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.index = index; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	rtype.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _r, name$1, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; name$1 = $f.name$1; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByName of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f.name$1 = name$1; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	rtype.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, match, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; match = $f.match; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByNameFunc of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.match = match; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	rtype.ptr.prototype.In = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: In of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.in$(), ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.In = function(i) { return this.$val.In(i); };
	rtype.ptr.prototype.Key = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 21))) {
			$panic(new $String("reflect: Key of non-map type"));
		}
		tt = t.kindType;
		return toType(tt.key);
	};
	rtype.prototype.Key = function() { return this.$val.Key(); };
	rtype.ptr.prototype.Len = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 17))) {
			$panic(new $String("reflect: Len of non-array type"));
		}
		tt = t.kindType;
		return (tt.len >> 0);
	};
	rtype.prototype.Len = function() { return this.$val.Len(); };
	rtype.ptr.prototype.NumField = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: NumField of non-struct type"));
		}
		tt = t.kindType;
		return tt.fields.$length;
	};
	rtype.prototype.NumField = function() { return this.$val.NumField(); };
	rtype.ptr.prototype.NumIn = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumIn of non-func type"));
		}
		tt = t.kindType;
		return (tt.inCount >> 0);
	};
	rtype.prototype.NumIn = function() { return this.$val.NumIn(); };
	rtype.ptr.prototype.NumOut = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumOut of non-func type"));
		}
		tt = t.kindType;
		return tt.out().$length;
	};
	rtype.prototype.NumOut = function() { return this.$val.NumOut(); };
	rtype.ptr.prototype.Out = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: Out of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.out(), ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.Out = function(i) { return this.$val.Out(i); };
	ChanDir.prototype.String = function() {
		var $ptr, _1, d;
		d = this.$val;
		_1 = d;
		if (_1 === (2)) {
			return "chan<-";
		} else if (_1 === (1)) {
			return "<-chan";
		} else if (_1 === (3)) {
			return "chan";
		}
		return "ChanDir" + strconv.Itoa((d >> 0));
	};
	$ptrType(ChanDir).prototype.String = function() { return new ChanDir(this.$get()).String(); };
	interfaceType.ptr.prototype.Method = function(i) {
		var $ptr, i, m, p, pname, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (i < 0 || i >= t.methods.$length) {
			return m;
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		pname = $clone(t.rtype.nameOff(p.name), name);
		m.Name = pname.name();
		if (!pname.isExported()) {
			m.PkgPath = pname.pkgPath();
			if (m.PkgPath === "") {
				m.PkgPath = t.pkgPath.name();
			}
		}
		m.Type = toType(t.rtype.typeOff(p.typ));
		m.Index = i;
		return m;
	};
	interfaceType.prototype.Method = function(i) { return this.$val.Method(i); };
	interfaceType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		return t.methods.$length;
	};
	interfaceType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	interfaceType.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name$1, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$8.nil) {
			return [m, ok];
		}
		p = ptrType$9.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (t.rtype.nameOff(p.name).name() === name$1) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	interfaceType.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	StructTag.prototype.Get = function(key) {
		var $ptr, _tuple, key, tag, v;
		tag = this.$val;
		_tuple = new StructTag(tag).Lookup(key);
		v = _tuple[0];
		return v;
	};
	$ptrType(StructTag).prototype.Get = function(key) { return new StructTag(this.$get()).Get(key); };
	StructTag.prototype.Lookup = function(key) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, err, i, key, name$1, ok, qvalue, tag, value, value$1;
		value = "";
		ok = false;
		tag = this.$val;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = $substring(tag, i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && tag.charCodeAt(i) > 32 && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)) && !((tag.charCodeAt(i) === 127)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i === 0) || (i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name$1 = $substring(tag, 0, i);
			tag = $substring(tag, (i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = $substring(tag, 0, (i + 1 >> 0));
			tag = $substring(tag, (i + 1 >> 0));
			if (key === name$1) {
				_tuple = strconv.Unquote(qvalue);
				value$1 = _tuple[0];
				err = _tuple[1];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					break;
				}
				_tmp = value$1;
				_tmp$1 = true;
				value = _tmp;
				ok = _tmp$1;
				return [value, ok];
			}
		}
		_tmp$2 = "";
		_tmp$3 = false;
		value = _tmp$2;
		ok = _tmp$3;
		return [value, ok];
	};
	$ptrType(StructTag).prototype.Lookup = function(key) { return new StructTag(this.$get()).Lookup(key); };
	structType.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, f, i, name$1, p, t, t$1, tag, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; i = $f.i; name$1 = $f.name$1; p = $f.p; t = $f.t; t$1 = $f.t$1; tag = $f.tag; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		t = this;
		if (i < 0 || i >= t.fields.$length) {
			$panic(new $String("reflect: Field index out of bounds"));
		}
		p = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		f.Type = toType(p.typ);
		name$1 = p.name.name();
		/* */ if (!(name$1 === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name$1 === "")) { */ case 1:
			f.Name = name$1;
			$s = 3; continue;
		/* } else { */ case 2:
			t$1 = f.Type;
			_r = t$1.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === 22) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_r === 22) { */ case 4:
				_r$1 = t$1.Elem(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				t$1 = _r$1;
			/* } */ case 5:
			_r$2 = t$1.Name(); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			f.Name = _r$2;
			f.Anonymous = true;
		/* } */ case 3:
		if (!p.name.isExported()) {
			f.PkgPath = t.pkgPath.name();
		}
		tag = p.name.tag();
		if (!(tag === "")) {
			f.Tag = tag;
		}
		f.Offset = p.offset;
		f.Index = new sliceType$14([i]);
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.i = i; $f.name$1 = name$1; $f.p = p; $f.t = t; $f.t$1 = t$1; $f.tag = tag; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.Field = function(i) { return this.$val.Field(i); };
	structType.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _v, f, ft, i, index, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _v = $f._v; f = $f.f; ft = $f.ft; i = $f.i; index = $f.index; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		t = this;
		f.Type = toType(t.rtype);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i > 0) { */ case 3:
				ft = f.Type;
				_r = ft.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				if (!(_r === 22)) { _v = false; $s = 7; continue s; }
				_r$1 = ft.Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = _r$1.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v = _r$2 === 25; case 7:
				/* */ if (_v) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_v) { */ case 5:
					_r$3 = ft.Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ft = _r$3;
				/* } */ case 6:
				f.Type = ft;
			/* } */ case 4:
			_r$4 = f.Type.Field(x); /* */ $s = 12; case 12: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			StructField.copy(f, _r$4);
			_i++;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._v = _v; $f.f = f; $f.ft = ft; $f.i = i; $f.index = index; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	structType.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _i, _i$1, _key, _key$1, _key$2, _key$3, _r, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, count, current, f, fname, i, index, match, name$1, next, nextCount, ntyp, ok, result, scan, styp, t, t$1, visited, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; count = $f.count; current = $f.current; f = $f.f; fname = $f.fname; i = $f.i; index = $f.index; match = $f.match; name$1 = $f.name$1; next = $f.next; nextCount = $f.nextCount; ntyp = $f.ntyp; ok = $f.ok; result = $f.result; scan = $f.scan; styp = $f.styp; t = $f.t; t$1 = $f.t$1; visited = $f.visited; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		ok = false;
		t = this;
		current = new sliceType$15([]);
		next = new sliceType$15([new fieldScan.ptr(t, sliceType$14.nil)]);
		nextCount = false;
		visited = $makeMap(ptrType$10.keyFor, []);
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			count = nextCount;
			nextCount = false;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				scan = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), fieldScan);
				t$1 = scan.typ;
				/* */ if ((_entry = visited[ptrType$10.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[ptrType$10.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = t$1; (visited || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key)] = { k: _key, v: true };
				_ref$1 = t$1.fields;
				_i$1 = 0;
				/* while (true) { */ case 7:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 8; continue; }
					i = _i$1;
					f = (x = t$1.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
					fname = "";
					ntyp = ptrType$1.nil;
					name$1 = f.name.name();
					/* */ if (!(name$1 === "")) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!(name$1 === "")) { */ case 9:
						fname = name$1;
						$s = 11; continue;
					/* } else { */ case 10:
						ntyp = f.typ;
						/* */ if (ntyp.Kind() === 22) { $s = 12; continue; }
						/* */ $s = 13; continue;
						/* if (ntyp.Kind() === 22) { */ case 12:
							_r = ntyp.Elem().common(); /* */ $s = 14; case 14: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
							ntyp = _r;
						/* } */ case 13:
						fname = ntyp.Name();
					/* } */ case 11:
					_r$1 = match(fname); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (_r$1) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (_r$1) { */ case 15:
						if ((_entry$1 = count[ptrType$10.keyFor(t$1)], _entry$1 !== undefined ? _entry$1.v : 0) > 1 || ok) {
							_tmp$2 = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
							_tmp$3 = false;
							StructField.copy(result, _tmp$2);
							ok = _tmp$3;
							$s = -1; return [result, ok];
							return [result, ok];
						}
						_r$2 = t$1.Field(i); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						StructField.copy(result, _r$2);
						result.Index = sliceType$14.nil;
						result.Index = $appendSlice(result.Index, scan.index);
						result.Index = $append(result.Index, i);
						ok = true;
						_i$1++;
						/* continue; */ $s = 7; continue;
					/* } */ case 16:
					if (ok || ntyp === ptrType$1.nil || !((ntyp.Kind() === 25))) {
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					styp = ntyp.kindType;
					if ((_entry$2 = nextCount[ptrType$10.keyFor(styp)], _entry$2 !== undefined ? _entry$2.v : 0) > 0) {
						_key$1 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$1)] = { k: _key$1, v: 2 };
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					if (nextCount === false) {
						nextCount = $makeMap(ptrType$10.keyFor, []);
					}
					_key$2 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$2)] = { k: _key$2, v: 1 };
					if ((_entry$3 = count[ptrType$10.keyFor(t$1)], _entry$3 !== undefined ? _entry$3.v : 0) > 1) {
						_key$3 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$10.keyFor(_key$3)] = { k: _key$3, v: 2 };
					}
					index = sliceType$14.nil;
					index = $appendSlice(index, scan.index);
					index = $append(index, i);
					next = $append(next, new fieldScan.ptr(styp, index));
					_i$1++;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			if (ok) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return [result, ok];
		return [result, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.count = count; $f.current = current; $f.f = f; $f.fname = fname; $f.i = i; $f.index = index; $f.match = match; $f.name$1 = name$1; $f.next = next; $f.nextCount = nextCount; $f.ntyp = ntyp; $f.ok = ok; $f.result = result; $f.scan = scan; $f.styp = styp; $f.t = t; $f.t$1 = t$1; $f.visited = visited; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	structType.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _i, _r, _r$1, _ref, _tmp, _tmp$1, _tuple, f, hasAnon, i, name$1, present, t, tf, tfname, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; f = $f.f; hasAnon = $f.hasAnon; i = $f.i; name$1 = $f.name$1; present = $f.present; t = $f.t; tf = $f.tf; tfname = $f.tfname; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name$1 = [name$1];
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$14.nil, false);
		present = false;
		t = this;
		hasAnon = false;
		/* */ if (!(name$1[0] === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name$1[0] === "")) { */ case 1:
			_ref = t.fields;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				i = _i;
				tf = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				tfname = tf.name.name();
				/* */ if (tfname === "") { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (tfname === "") { */ case 5:
					hasAnon = true;
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				/* */ if (tfname === name$1[0]) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (tfname === name$1[0]) { */ case 7:
					_r = t.Field(i); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tmp = $clone(_r, StructField);
					_tmp$1 = true;
					StructField.copy(f, _tmp);
					present = _tmp$1;
					$s = -1; return [f, present];
					return [f, present];
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
		/* } */ case 2:
		if (!hasAnon) {
			$s = -1; return [f, present];
			return [f, present];
		}
		_r$1 = t.FieldByNameFunc((function(name$1) { return function(s) {
			var $ptr, s;
			return s === name$1[0];
		}; })(name$1)); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		StructField.copy(f, _tuple[0]);
		present = _tuple[1];
		$s = -1; return [f, present];
		return [f, present];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.f = f; $f.hasAnon = hasAnon; $f.i = i; $f.name$1 = name$1; $f.present = present; $f.t = t; $f.tf = tf; $f.tfname = tfname; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	PtrTo = function(t) {
		var $ptr, t;
		return $assertType(t, ptrType$1).ptrTo();
	};
	$pkg.PtrTo = PtrTo;
	rtype.ptr.prototype.Implements = function(u) {
		var $ptr, _r, t, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.Implements"));
		}
		_r = u.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 20))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 20))) { */ case 1:
			$panic(new $String("reflect: non-interface type passed to Type.Implements"));
		/* } */ case 2:
		$s = -1; return implements$1($assertType(u, ptrType$1), t);
		return implements$1($assertType(u, ptrType$1), t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Implements }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Implements = function(u) { return this.$val.Implements(u); };
	rtype.ptr.prototype.AssignableTo = function(u) {
		var $ptr, t, u, uu;
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.AssignableTo"));
		}
		uu = $assertType(u, ptrType$1);
		return directlyAssignable(uu, t) || implements$1(uu, t);
	};
	rtype.prototype.AssignableTo = function(u) { return this.$val.AssignableTo(u); };
	rtype.ptr.prototype.ConvertibleTo = function(u) {
		var $ptr, _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.ConvertibleTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = convertOp(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return !(_r === $throwNilPointerError);
		return !(_r === $throwNilPointerError);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.ConvertibleTo }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.ConvertibleTo = function(u) { return this.$val.ConvertibleTo(u); };
	implements$1 = function(T, V) {
		var $ptr, T, V, i, i$1, j, j$1, t, tm, tm$1, v, v$1, vm, vm$1, vmethods, x, x$1, x$2;
		if (!((T.Kind() === 20))) {
			return false;
		}
		t = T.kindType;
		if (t.methods.$length === 0) {
			return true;
		}
		if (V.Kind() === 20) {
			v = V.kindType;
			i = 0;
			j = 0;
			while (true) {
				if (!(j < v.methods.$length)) { break; }
				tm = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				vm = (x$1 = v.methods, ((j < 0 || j >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + j]));
				if (V.nameOff(vm.name).name() === t.rtype.nameOff(tm.name).name() && V.typeOff(vm.typ) === t.rtype.typeOff(tm.typ)) {
					i = i + (1) >> 0;
					if (i >= t.methods.$length) {
						return true;
					}
				}
				j = j + (1) >> 0;
			}
			return false;
		}
		v$1 = V.uncommon();
		if (v$1 === ptrType$6.nil) {
			return false;
		}
		i$1 = 0;
		vmethods = v$1.methods();
		j$1 = 0;
		while (true) {
			if (!(j$1 < (v$1.mcount >> 0))) { break; }
			tm$1 = (x$2 = t.methods, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			vm$1 = $clone(((j$1 < 0 || j$1 >= vmethods.$length) ? $throwRuntimeError("index out of range") : vmethods.$array[vmethods.$offset + j$1]), method);
			if (V.nameOff(vm$1.name).name() === t.rtype.nameOff(tm$1.name).name() && V.typeOff(vm$1.mtyp) === t.rtype.typeOff(tm$1.typ)) {
				i$1 = i$1 + (1) >> 0;
				if (i$1 >= t.methods.$length) {
					return true;
				}
			}
			j$1 = j$1 + (1) >> 0;
		}
		return false;
	};
	directlyAssignable = function(T, V) {
		var $ptr, T, V;
		if (T === V) {
			return true;
		}
		if (!(T.Name() === "") && !(V.Name() === "") || !((T.Kind() === V.Kind()))) {
			return false;
		}
		return haveIdenticalUnderlyingType(T, V);
	};
	haveIdenticalUnderlyingType = function(T, V) {
		var $ptr, T, V, _1, _i, _ref, i, i$1, i$2, kind, t, t$1, t$2, tf, v, v$1, v$2, vf, x, x$1;
		if (T === V) {
			return true;
		}
		kind = T.Kind();
		if (!((kind === V.Kind()))) {
			return false;
		}
		if (1 <= kind && kind <= 16 || (kind === 24) || (kind === 26)) {
			return true;
		}
		_1 = kind;
		if (_1 === (17)) {
			return $interfaceIsEqual(T.Elem(), V.Elem()) && (T.Len() === V.Len());
		} else if (_1 === (18)) {
			if ((V.ChanDir() === 3) && $interfaceIsEqual(T.Elem(), V.Elem())) {
				return true;
			}
			return (V.ChanDir() === T.ChanDir()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_1 === (19)) {
			t = T.kindType;
			v = V.kindType;
			if (!((t.outCount === v.outCount)) || !((t.inCount === v.inCount))) {
				return false;
			}
			i = 0;
			while (true) {
				if (!(i < t.rtype.NumIn())) { break; }
				if (!($interfaceIsEqual(t.rtype.In(i), v.rtype.In(i)))) {
					return false;
				}
				i = i + (1) >> 0;
			}
			i$1 = 0;
			while (true) {
				if (!(i$1 < t.rtype.NumOut())) { break; }
				if (!($interfaceIsEqual(t.rtype.Out(i$1), v.rtype.Out(i$1)))) {
					return false;
				}
				i$1 = i$1 + (1) >> 0;
			}
			return true;
		} else if (_1 === (20)) {
			t$1 = T.kindType;
			v$1 = V.kindType;
			if ((t$1.methods.$length === 0) && (v$1.methods.$length === 0)) {
				return true;
			}
			return false;
		} else if (_1 === (21)) {
			return $interfaceIsEqual(T.Key(), V.Key()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if ((_1 === (22)) || (_1 === (23))) {
			return $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_1 === (25)) {
			t$2 = T.kindType;
			v$2 = V.kindType;
			if (!((t$2.fields.$length === v$2.fields.$length))) {
				return false;
			}
			_ref = t$2.fields;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i$2 = _i;
				tf = (x = t$2.fields, ((i$2 < 0 || i$2 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i$2]));
				vf = (x$1 = v$2.fields, ((i$2 < 0 || i$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i$2]));
				if (!(tf.name.name() === vf.name.name())) {
					return false;
				}
				if (!(tf.typ === vf.typ)) {
					return false;
				}
				if (!(tf.name.tag() === vf.name.tag())) {
					return false;
				}
				if (!((tf.offset === vf.offset))) {
					return false;
				}
				_i++;
			}
			return true;
		}
		return false;
	};
	toType = function(t) {
		var $ptr, t;
		if (t === ptrType$1.nil) {
			return $ifaceNil;
		}
		return t;
	};
	ifaceIndir = function(t) {
		var $ptr, t;
		return ((t.kind & 32) >>> 0) === 0;
	};
	flag.prototype.kind = function() {
		var $ptr, f;
		f = this.$val;
		return (((f & 31) >>> 0) >>> 0);
	};
	$ptrType(flag).prototype.kind = function() { return new flag(this.$get()).kind(); };
	Value.ptr.prototype.pointer = function() {
		var $ptr, v;
		v = this;
		if (!((v.typ.size === 4)) || !v.typ.pointers()) {
			$panic(new $String("can't call pointer on a non-pointer Value"));
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			return v.ptr.$get();
		}
		return v.ptr;
	};
	Value.prototype.pointer = function() { return this.$val.pointer(); };
	ValueError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Kind === 0) {
			return "reflect: call of " + e.Method + " on zero Value";
		}
		return "reflect: call of " + e.Method + " on " + new Kind(e.Kind).String() + " Value";
	};
	ValueError.prototype.Error = function() { return this.$val.Error(); };
	flag.prototype.mustBe = function(expected) {
		var $ptr, expected, f;
		f = this.$val;
		if (!((new flag(f).kind() === expected))) {
			$panic(new ValueError.ptr(methodName(), new flag(f).kind()));
		}
	};
	$ptrType(flag).prototype.mustBe = function(expected) { return new flag(this.$get()).mustBe(expected); };
	flag.prototype.mustBeExported = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
	};
	$ptrType(flag).prototype.mustBeExported = function() { return new flag(this.$get()).mustBeExported(); };
	flag.prototype.mustBeAssignable = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
		if (((f & 256) >>> 0) === 0) {
			$panic(new $String("reflect: " + methodName() + " using unaddressable value"));
		}
	};
	$ptrType(flag).prototype.mustBeAssignable = function() { return new flag(this.$get()).mustBeAssignable(); };
	Value.ptr.prototype.Addr = function() {
		var $ptr, v;
		v = this;
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.Addr of unaddressable value"));
		}
		return new Value.ptr(v.typ.ptrTo(), v.ptr, ((((v.flag & 96) >>> 0)) | 22) >>> 0);
	};
	Value.prototype.Addr = function() { return this.$val.Addr(); };
	Value.ptr.prototype.Bool = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(1);
		return v.ptr.$get();
	};
	Value.prototype.Bool = function() { return this.$val.Bool(); };
	Value.ptr.prototype.Bytes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-byte slice"));
		/* } */ case 2:
		$s = -1; return v.ptr.$get();
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Bytes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Bytes = function() { return this.$val.Bytes(); };
	Value.ptr.prototype.runes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-rune slice"));
		/* } */ case 2:
		$s = -1; return v.ptr.$get();
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.runes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.runes = function() { return this.$val.runes(); };
	Value.ptr.prototype.CanAddr = function() {
		var $ptr, v;
		v = this;
		return !((((v.flag & 256) >>> 0) === 0));
	};
	Value.prototype.CanAddr = function() { return this.$val.CanAddr(); };
	Value.ptr.prototype.CanSet = function() {
		var $ptr, v;
		v = this;
		return ((v.flag & 352) >>> 0) === 256;
	};
	Value.prototype.CanSet = function() { return this.$val.CanSet(); };
	Value.ptr.prototype.Call = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("Call", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Call }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Call = function(in$1) { return this.$val.Call(in$1); };
	Value.ptr.prototype.CallSlice = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("CallSlice", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.CallSlice }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.CallSlice = function(in$1) { return this.$val.CallSlice(in$1); };
	Value.ptr.prototype.Complex = function() {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return (x = v.ptr.$get(), new $Complex128(x.$real, x.$imag));
		} else if (_1 === (16)) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Complex", new flag(v.flag).kind()));
	};
	Value.prototype.Complex = function() { return this.$val.Complex(); };
	Value.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _ref, _v, i, index, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _v = $f._v; i = $f.i; index = $f.index; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (index.$length === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (index.$length === 1) { */ case 1:
			_r = v.Field((0 >= index.$length ? $throwRuntimeError("index out of range") : index.$array[index.$offset + 0])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r;
			return _r;
		/* } */ case 2:
		new flag(v.flag).mustBe(25);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 4:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 5; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (i > 0) { */ case 6:
				if (!(v.Kind() === 22)) { _v = false; $s = 10; continue s; }
				_r$1 = v.typ.Elem().Kind(); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v = _r$1 === 25; case 10:
				/* */ if (_v) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (_v) { */ case 8:
					if (v.IsNil()) {
						$panic(new $String("reflect: indirection through nil pointer to embedded struct"));
					}
					_r$2 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					v = _r$2;
				/* } */ case 9:
			/* } */ case 7:
			_r$3 = v.Field(x); /* */ $s = 13; case 13: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
			_i++;
		/* } */ $s = 4; continue; case 5:
		$s = -1; return v;
		return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._v = _v; $f.i = i; $f.index = index; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	Value.ptr.prototype.FieldByName = function(name$1) {
		var $ptr, _r, _r$1, _tuple, f, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(25);
		_r = v.typ.FieldByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByName = function(name$1) { return this.$val.FieldByName(name$1); };
	Value.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, _r$1, _tuple, f, match, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; match = $f.match; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		_r = v.typ.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			$s = -1; return _r$1;
			return _r$1;
		/* } */ case 3:
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.match = match; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	Value.ptr.prototype.Float = function() {
		var $ptr, _1, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return v.ptr.$get();
		} else if (_1 === (14)) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Float", new flag(v.flag).kind()));
	};
	Value.prototype.Float = function() { return this.$val.Float(); };
	Value.ptr.prototype.Int = function() {
		var $ptr, _1, k, p, v;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (2)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (3)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (4)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (5)) {
			return new $Int64(0, p.$get());
		} else if (_1 === (6)) {
			return p.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Int", new flag(v.flag).kind()));
	};
	Value.prototype.Int = function() { return this.$val.Int(); };
	Value.ptr.prototype.CanInterface = function() {
		var $ptr, v;
		v = this;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.CanInterface", 0));
		}
		return ((v.flag & 96) >>> 0) === 0;
	};
	Value.prototype.CanInterface = function() { return this.$val.CanInterface(); };
	Value.ptr.prototype.Interface = function() {
		var $ptr, _r, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = $ifaceNil;
		v = this;
		_r = valueInterface(v, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		$s = -1; return i;
		return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Interface }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Interface = function() { return this.$val.Interface(); };
	Value.ptr.prototype.IsValid = function() {
		var $ptr, v;
		v = this;
		return !((v.flag === 0));
	};
	Value.prototype.IsValid = function() { return this.$val.IsValid(); };
	Value.ptr.prototype.Kind = function() {
		var $ptr, v;
		v = this;
		return new flag(v.flag).kind();
	};
	Value.prototype.Kind = function() { return this.$val.Kind(); };
	Value.ptr.prototype.MapIndex = function(key) {
		var $ptr, _r, c, e, fl, k, key, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; e = $f.e; fl = $f.fl; k = $f.k; key = $f.key; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.MapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		e = mapaccess(v.typ, v.pointer(), k);
		if (e === 0) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		typ = tt.elem;
		fl = ((((v.flag | key.flag) >>> 0)) & 96) >>> 0;
		fl = (fl | ((typ.Kind() >>> 0))) >>> 0;
		if (ifaceIndir(typ)) {
			c = unsafe_New(typ);
			typedmemmove(typ, c, e);
			$s = -1; return new Value.ptr(typ, c, (fl | 128) >>> 0);
			return new Value.ptr(typ, c, (fl | 128) >>> 0);
		} else {
			$s = -1; return new Value.ptr(typ, e.$get(), fl);
			return new Value.ptr(typ, e.$get(), fl);
		}
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.e = e; $f.fl = fl; $f.k = k; $f.key = key; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapIndex = function(key) { return this.$val.MapIndex(key); };
	Value.ptr.prototype.MapKeys = function() {
		var $ptr, _r, a, c, fl, i, it, key, keyType, m, mlen, tt, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; c = $f.c; fl = $f.fl; i = $f.i; it = $f.it; key = $f.key; keyType = $f.keyType; m = $f.m; mlen = $f.mlen; tt = $f.tt; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		keyType = tt.key;
		fl = (((v.flag & 96) >>> 0) | (keyType.Kind() >>> 0)) >>> 0;
		m = v.pointer();
		mlen = 0;
		if (!(m === 0)) {
			mlen = maplen(m);
		}
		it = mapiterinit(v.typ, m);
		a = $makeSlice(sliceType$10, mlen);
		i = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < a.$length)) { break; } */ if(!(i < a.$length)) { $s = 2; continue; }
			_r = mapiterkey(it); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			key = _r;
			if (key === 0) {
				/* break; */ $s = 2; continue;
			}
			if (ifaceIndir(keyType)) {
				c = unsafe_New(keyType);
				typedmemmove(keyType, c, key);
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, c, (fl | 128) >>> 0));
			} else {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, key.$get(), fl));
			}
			mapiternext(it);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return $subslice(a, 0, i);
		return $subslice(a, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapKeys }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.c = c; $f.fl = fl; $f.i = i; $f.it = it; $f.key = key; $f.keyType = keyType; $f.m = m; $f.mlen = mlen; $f.tt = tt; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapKeys = function() { return this.$val.MapKeys(); };
	Value.ptr.prototype.Method = function(i) {
		var $ptr, _r, _v, fl, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _v = $f._v; fl = $f.fl; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.Method", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) { _v = true; $s = 3; continue s; }
		_r = v.typ.NumMethod(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_v = (i >>> 0) >= (_r >>> 0); case 3:
		/* */ if (_v) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_v) { */ case 1:
			$panic(new $String("reflect: Method index out of range"));
		/* } */ case 2:
		if ((v.typ.Kind() === 20) && v.IsNil()) {
			$panic(new $String("reflect: Method on nil interface value"));
		}
		fl = (v.flag & 160) >>> 0;
		fl = (fl | (19)) >>> 0;
		fl = (fl | (((((i >>> 0) << 10 >>> 0) | 512) >>> 0))) >>> 0;
		$s = -1; return new Value.ptr(v.typ, v.ptr, fl);
		return new Value.ptr(v.typ, v.ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Method }; } $f.$ptr = $ptr; $f._r = _r; $f._v = _v; $f.fl = fl; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.NumMethod = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.NumMethod", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return 0;
			return 0;
		}
		_r = v.typ.NumMethod(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.NumMethod }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	Value.ptr.prototype.MethodByName = function(name$1) {
		var $ptr, _r, _r$1, _tuple, m, name$1, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; m = $f.m; name$1 = $f.name$1; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.MethodByName", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = v.typ.MethodByName(name$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		m = $clone(_tuple[0], Method);
		ok = _tuple[1];
		if (!ok) {
			$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r$1 = v.Method(m.Index); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MethodByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.m = m; $f.name$1 = name$1; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MethodByName = function(name$1) { return this.$val.MethodByName(name$1); };
	Value.ptr.prototype.NumField = function() {
		var $ptr, tt, v;
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		return tt.fields.$length;
	};
	Value.prototype.NumField = function() { return this.$val.NumField(); };
	Value.ptr.prototype.OverflowComplex = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			return overflowFloat32(x.$real) || overflowFloat32(x.$imag);
		} else if (_1 === (16)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowComplex", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowComplex = function(x) { return this.$val.OverflowComplex(x); };
	Value.ptr.prototype.OverflowFloat = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			return overflowFloat32(x);
		} else if (_1 === (14)) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowFloat", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowFloat = function(x) { return this.$val.OverflowFloat(x); };
	overflowFloat32 = function(x) {
		var $ptr, x;
		if (x < 0) {
			x = -x;
		}
		return 3.4028234663852886e+38 < x && x <= 1.7976931348623157e+308;
	};
	Value.ptr.prototype.OverflowInt = function(x) {
		var $ptr, _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightInt64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowInt", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowInt = function(x) { return this.$val.OverflowInt(x); };
	Value.ptr.prototype.OverflowUint = function(x) {
		var $ptr, _1, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if ((_1 === (7)) || (_1 === (12)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11))) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightUint64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowUint", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowUint = function(x) { return this.$val.OverflowUint(x); };
	Value.ptr.prototype.Recv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Recv = function() { return this.$val.Recv(); };
	Value.ptr.prototype.recv = function(nb) {
		var $ptr, _r, _tuple, nb, ok, p, selected, t, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; nb = $f.nb; ok = $f.ok; p = $f.p; selected = $f.selected; t = $f.t; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 1) === 0) {
			$panic(new $String("reflect: recv on send-only channel"));
		}
		t = tt.elem;
		val = new Value.ptr(t, 0, (t.Kind() >>> 0));
		p = 0;
		if (ifaceIndir(t)) {
			p = unsafe_New(t);
			val.ptr = p;
			val.flag = (val.flag | (128)) >>> 0;
		} else {
			p = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		_r = chanrecv(v.typ, v.pointer(), nb, p); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		selected = _tuple[0];
		ok = _tuple[1];
		if (!selected) {
			val = new Value.ptr(ptrType$1.nil, 0, 0);
		}
		$s = -1; return [val, ok];
		return [val, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.nb = nb; $f.ok = ok; $f.p = p; $f.selected = selected; $f.t = t; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.recv = function(nb) { return this.$val.recv(nb); };
	Value.ptr.prototype.Send = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Send }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Send = function(x) { return this.$val.Send(x); };
	Value.ptr.prototype.send = function(x, nb) {
		var $ptr, _r, _r$1, nb, p, selected, tt, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; nb = $f.nb; p = $f.p; selected = $f.selected; tt = $f.tt; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		x = x;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 2) === 0) {
			$panic(new $String("reflect: send on recv-only channel"));
		}
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Value.Send", tt.elem, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		p = 0;
		if (!((((x.flag & 128) >>> 0) === 0))) {
			p = x.ptr;
		} else {
			p = (x.$ptr_ptr || (x.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, x)));
		}
		_r$1 = chansend(v.typ, v.pointer(), p, nb); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		selected = _r$1;
		$s = -1; return selected;
		return selected;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.send }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.nb = nb; $f.p = p; $f.selected = selected; $f.tt = tt; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.send = function(x, nb) { return this.$val.send(x, nb); };
	Value.ptr.prototype.SetBool = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(1);
		v.ptr.$set(x);
	};
	Value.prototype.SetBool = function(x) { return this.$val.SetBool(x); };
	Value.ptr.prototype.setRunes = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.setRunes of non-rune slice"));
		/* } */ case 2:
		v.ptr.$set(x);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.setRunes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.setRunes = function(x) { return this.$val.setRunes(x); };
	Value.ptr.prototype.SetComplex = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (15)) {
			v.ptr.$set(new $Complex64(x.$real, x.$imag));
		} else if (_1 === (16)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetComplex", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetComplex = function(x) { return this.$val.SetComplex(x); };
	Value.ptr.prototype.SetFloat = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (13)) {
			v.ptr.$set($fround(x));
		} else if (_1 === (14)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetFloat", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetFloat = function(x) { return this.$val.SetFloat(x); };
	Value.ptr.prototype.SetInt = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (2)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_1 === (3)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 24 >> 24));
		} else if (_1 === (4)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 16 >> 16));
		} else if (_1 === (5)) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_1 === (6)) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetInt", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetInt = function(x) { return this.$val.SetInt(x); };
	Value.ptr.prototype.SetMapIndex = function(key, val) {
		var $ptr, _r, _r$1, e, k, key, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; e = $f.e; k = $f.k; key = $f.key; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = val;
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		new flag(v.flag).mustBeExported();
		new flag(key.flag).mustBeExported();
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.SetMapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		if (val.typ === ptrType$1.nil) {
			mapdelete(v.typ, v.pointer(), k);
			$s = -1; return;
			return;
		}
		new flag(val.flag).mustBeExported();
		_r$1 = val.assignTo("reflect.Value.SetMapIndex", tt.elem, 0); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		val = _r$1;
		e = 0;
		if (!((((val.flag & 128) >>> 0) === 0))) {
			e = val.ptr;
		} else {
			e = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$16(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		$r = mapassign(v.typ, v.pointer(), k, e); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetMapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.e = e; $f.k = k; $f.key = key; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetMapIndex = function(key, val) { return this.$val.SetMapIndex(key, val); };
	Value.ptr.prototype.SetUint = function(x) {
		var $ptr, _1, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (7)) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_1 === (8)) {
			v.ptr.$set((x.$low << 24 >>> 24));
		} else if (_1 === (9)) {
			v.ptr.$set((x.$low << 16 >>> 16));
		} else if (_1 === (10)) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_1 === (11)) {
			v.ptr.$set(x);
		} else if (_1 === (12)) {
			v.ptr.$set((x.$low >>> 0));
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetUint", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetUint = function(x) { return this.$val.SetUint(x); };
	Value.ptr.prototype.SetPointer = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(26);
		v.ptr.$set(x);
	};
	Value.prototype.SetPointer = function(x) { return this.$val.SetPointer(x); };
	Value.ptr.prototype.SetString = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(24);
		v.ptr.$set(x);
	};
	Value.prototype.SetString = function(x) { return this.$val.SetString(x); };
	Value.ptr.prototype.String = function() {
		var $ptr, _1, _r, k, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; k = $f.k; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		k = new flag(v.flag).kind();
		_1 = k;
		if (_1 === (0)) {
			$s = -1; return "<invalid Value>";
			return "<invalid Value>";
		} else if (_1 === (24)) {
			$s = -1; return v.ptr.$get();
			return v.ptr.$get();
		}
		_r = v.Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return "<" + _r + " Value>";
		return "<" + _r + " Value>";
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.String }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.k = k; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.String = function() { return this.$val.String(); };
	Value.ptr.prototype.TryRecv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		$s = -1; return [x, ok];
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TryRecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TryRecv = function() { return this.$val.TryRecv(); };
	Value.ptr.prototype.TrySend = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TrySend }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TrySend = function(x) { return this.$val.TrySend(x); };
	Value.ptr.prototype.Type = function() {
		var $ptr, f, i, m, m$1, tt, ut, v, x, x$1;
		v = this;
		f = v.flag;
		if (f === 0) {
			$panic(new ValueError.ptr("reflect.Value.Type", 0));
		}
		if (((f & 512) >>> 0) === 0) {
			return v.typ;
		}
		i = (v.flag >> 0) >> 10 >> 0;
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if ((i >>> 0) >= (tt.methods.$length >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			return v.typ.typeOff(m.typ);
		}
		ut = v.typ.uncommon();
		if (ut === ptrType$6.nil || (i >>> 0) >= (ut.mcount >>> 0)) {
			$panic(new $String("reflect: internal error: invalid method index"));
		}
		m$1 = $clone((x$1 = ut.methods(), ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])), method);
		return v.typ.typeOff(m$1.mtyp);
	};
	Value.prototype.Type = function() { return this.$val.Type(); };
	Value.ptr.prototype.Uint = function() {
		var $ptr, _1, k, p, v, x;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_1 = k;
		if (_1 === (7)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (8)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (9)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (10)) {
			return new $Uint64(0, p.$get());
		} else if (_1 === (11)) {
			return p.$get();
		} else if (_1 === (12)) {
			return (x = p.$get(), new $Uint64(0, x.constructor === Number ? x : 1));
		}
		$panic(new ValueError.ptr("reflect.Value.Uint", new flag(v.flag).kind()));
	};
	Value.prototype.Uint = function() { return this.$val.Uint(); };
	Value.ptr.prototype.UnsafeAddr = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.UnsafeAddr", 0));
		}
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.UnsafeAddr of unaddressable value"));
		}
		return v.ptr;
	};
	Value.prototype.UnsafeAddr = function() { return this.$val.UnsafeAddr(); };
	New = function(typ) {
		var $ptr, _r, _r$1, fl, ptr, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; fl = $f.fl; ptr = $f.ptr; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(typ, $ifaceNil)) {
			$panic(new $String("reflect: New(nil)"));
		}
		ptr = unsafe_New($assertType(typ, ptrType$1));
		fl = 22;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.ptrTo(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$1, ptr, fl);
		return new Value.ptr(_r$1, ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: New }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.fl = fl; $f.ptr = ptr; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.New = New;
	Value.ptr.prototype.assignTo = function(context, dst, target) {
		var $ptr, _r, _r$1, _r$2, context, dst, fl, target, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; context = $f.context; dst = $f.dst; fl = $f.fl; target = $f.target; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue(context, v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
			/* */ if (directlyAssignable(dst, v.typ)) { $s = 5; continue; }
			/* */ if (implements$1(dst, v.typ)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (directlyAssignable(dst, v.typ)) { */ case 5:
				v.typ = dst;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((dst.Kind() >>> 0))) >>> 0;
				$s = -1; return new Value.ptr(dst, v.ptr, fl);
				return new Value.ptr(dst, v.ptr, fl);
			/* } else if (implements$1(dst, v.typ)) { */ case 6:
				if (target === 0) {
					target = unsafe_New(dst);
				}
				_r$1 = valueInterface(v, false); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				x = _r$1;
				_r$2 = dst.NumMethod(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				/* */ if (_r$2 === 0) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_r$2 === 0) { */ case 9:
					target.$set(x);
					$s = 11; continue;
				/* } else { */ case 10:
					ifaceE2I(dst, x, target);
				/* } */ case 11:
				$s = -1; return new Value.ptr(dst, target, 148);
				return new Value.ptr(dst, target, 148);
			/* } */ case 7:
		case 4:
		$panic(new $String(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String()));
		$s = -1; return new Value.ptr(ptrType$1.nil, 0, 0);
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.assignTo }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.context = context; $f.dst = dst; $f.fl = fl; $f.target = target; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.assignTo = function(context, dst, target) { return this.$val.assignTo(context, dst, target); };
	Value.ptr.prototype.Convert = function(t) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, op, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; op = $f.op; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Convert", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		_r$1 = t.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = convertOp(_r$1, v.typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		/* */ if (op === $throwNilPointerError) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (op === $throwNilPointerError) { */ case 6:
			_r$3 = t.String(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$panic(new $String("reflect.Value.Convert: value of type " + v.typ.String() + " cannot be converted to type " + _r$3));
		/* } */ case 7:
		_r$4 = op(v, t); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return _r$4;
		return _r$4;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Convert }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.op = op; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Convert = function(t) { return this.$val.Convert(t); };
	convertOp = function(dst, src) {
		var $ptr, _1, _2, _3, _4, _5, _6, _7, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _v, _v$1, _v$2, dst, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _2 = $f._2; _3 = $f._3; _4 = $f._4; _5 = $f._5; _6 = $f._6; _7 = $f._7; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; dst = $f.dst; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = src.Kind();
			/* */ if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { $s = 2; continue; }
			/* */ if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { $s = 3; continue; }
			/* */ if ((_1 === (13)) || (_1 === (14))) { $s = 4; continue; }
			/* */ if ((_1 === (15)) || (_1 === (16))) { $s = 5; continue; }
			/* */ if (_1 === (24)) { $s = 6; continue; }
			/* */ if (_1 === (23)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((_1 === (2)) || (_1 === (3)) || (_1 === (4)) || (_1 === (5)) || (_1 === (6))) { */ case 2:
				_2 = dst.Kind();
				if ((_2 === (2)) || (_2 === (3)) || (_2 === (4)) || (_2 === (5)) || (_2 === (6)) || (_2 === (7)) || (_2 === (8)) || (_2 === (9)) || (_2 === (10)) || (_2 === (11)) || (_2 === (12))) {
					$s = -1; return cvtInt;
					return cvtInt;
				} else if ((_2 === (13)) || (_2 === (14))) {
					$s = -1; return cvtIntFloat;
					return cvtIntFloat;
				} else if (_2 === (24)) {
					$s = -1; return cvtIntString;
					return cvtIntString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (7)) || (_1 === (8)) || (_1 === (9)) || (_1 === (10)) || (_1 === (11)) || (_1 === (12))) { */ case 3:
				_3 = dst.Kind();
				if ((_3 === (2)) || (_3 === (3)) || (_3 === (4)) || (_3 === (5)) || (_3 === (6)) || (_3 === (7)) || (_3 === (8)) || (_3 === (9)) || (_3 === (10)) || (_3 === (11)) || (_3 === (12))) {
					$s = -1; return cvtUint;
					return cvtUint;
				} else if ((_3 === (13)) || (_3 === (14))) {
					$s = -1; return cvtUintFloat;
					return cvtUintFloat;
				} else if (_3 === (24)) {
					$s = -1; return cvtUintString;
					return cvtUintString;
				}
				$s = 8; continue;
			/* } else if ((_1 === (13)) || (_1 === (14))) { */ case 4:
				_4 = dst.Kind();
				if ((_4 === (2)) || (_4 === (3)) || (_4 === (4)) || (_4 === (5)) || (_4 === (6))) {
					$s = -1; return cvtFloatInt;
					return cvtFloatInt;
				} else if ((_4 === (7)) || (_4 === (8)) || (_4 === (9)) || (_4 === (10)) || (_4 === (11)) || (_4 === (12))) {
					$s = -1; return cvtFloatUint;
					return cvtFloatUint;
				} else if ((_4 === (13)) || (_4 === (14))) {
					$s = -1; return cvtFloat;
					return cvtFloat;
				}
				$s = 8; continue;
			/* } else if ((_1 === (15)) || (_1 === (16))) { */ case 5:
				_5 = dst.Kind();
				if ((_5 === (15)) || (_5 === (16))) {
					$s = -1; return cvtComplex;
					return cvtComplex;
				}
				$s = 8; continue;
			/* } else if (_1 === (24)) { */ case 6:
				if (!(dst.Kind() === 23)) { _v = false; $s = 11; continue s; }
				_r = dst.Elem().PkgPath(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r === ""; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
						_r$1 = dst.Elem().Kind(); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						_6 = _r$1;
						if (_6 === (8)) {
							$s = -1; return cvtStringBytes;
							return cvtStringBytes;
						} else if (_6 === (5)) {
							$s = -1; return cvtStringRunes;
							return cvtStringRunes;
						}
					case 13:
				/* } */ case 10:
				$s = 8; continue;
			/* } else if (_1 === (23)) { */ case 7:
				if (!(dst.Kind() === 24)) { _v$1 = false; $s = 17; continue s; }
				_r$2 = src.Elem().PkgPath(); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$1 = _r$2 === ""; case 17:
				/* */ if (_v$1) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_v$1) { */ case 15:
						_r$3 = src.Elem().Kind(); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_7 = _r$3;
						if (_7 === (8)) {
							$s = -1; return cvtBytesString;
							return cvtBytesString;
						} else if (_7 === (5)) {
							$s = -1; return cvtRunesString;
							return cvtRunesString;
						}
					case 19:
				/* } */ case 16:
			/* } */ case 8:
		case 1:
		if (haveIdenticalUnderlyingType(dst, src)) {
			$s = -1; return cvtDirect;
			return cvtDirect;
		}
		if (!((dst.Kind() === 22) && dst.Name() === "" && (src.Kind() === 22) && src.Name() === "")) { _v$2 = false; $s = 23; continue s; }
		_r$4 = dst.Elem().common(); /* */ $s = 24; case 24: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_arg = _r$4;
		_r$5 = src.Elem().common(); /* */ $s = 25; case 25: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg$1 = _r$5;
		_r$6 = haveIdenticalUnderlyingType(_arg, _arg$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_v$2 = _r$6; case 23:
		/* */ if (_v$2) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (_v$2) { */ case 21:
			$s = -1; return cvtDirect;
			return cvtDirect;
		/* } */ case 22:
		if (implements$1(dst, src)) {
			if (src.Kind() === 20) {
				$s = -1; return cvtI2I;
				return cvtI2I;
			}
			$s = -1; return cvtT2I;
			return cvtT2I;
		}
		$s = -1; return $throwNilPointerError;
		return $throwNilPointerError;
		/* */ } return; } if ($f === undefined) { $f = { $blk: convertOp }; } $f.$ptr = $ptr; $f._1 = _1; $f._2 = _2; $f._3 = _3; $f._4 = _4; $f._5 = _5; $f._6 = _6; $f._7 = _7; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.dst = dst; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeFloat = function(f, v, t) {
		var $ptr, _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (4)) {
			ptr.$set($fround(v));
		} else if (_1 === (8)) {
			ptr.$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeFloat }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeComplex = function(f, v, t) {
		var $ptr, _1, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_1 = typ.size;
		if (_1 === (8)) {
			ptr.$set(new $Complex64(v.$real, v.$imag));
		} else if (_1 === (16)) {
			ptr.$set(v);
		}
		$s = -1; return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeComplex }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeString = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		ret.SetString(v);
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeString }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeBytes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.SetBytes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeRunes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.setRunes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		$s = -1; return ret;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeRunes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = v.Int(), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, v.Uint(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = new $Int64(0, v.Float()), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, new $Uint64(0, v.Float()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Int()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Uint()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, v.Float(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtComplex = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeComplex((v.flag & 96) >>> 0, v.Complex(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtComplex }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Int().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Uint().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtBytesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.Bytes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $bytesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtBytesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringBytes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$16($stringToBytes(_r));
		_arg$2 = t;
		_r$1 = makeBytes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringBytes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtRunesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.runes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $runesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtRunesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringRunes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$18($stringToRunes(_r));
		_arg$2 = t;
		_r$1 = makeRunes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return _r$1;
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringRunes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtT2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, target, typ, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; target = $f.target; typ = $f.typ; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = unsafe_New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		target = _r$1;
		_r$2 = valueInterface(v, false); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		x = _r$2;
		_r$3 = typ.NumMethod(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 0) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_r$3 === 0) { */ case 4:
			target.$set(x);
			$s = 6; continue;
		/* } else { */ case 5:
			ifaceE2I($assertType(typ, ptrType$1), x, target);
		/* } */ case 6:
		_r$4 = typ.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		$s = -1; return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtT2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.target = target; $f.typ = typ; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtI2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, ret, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; ret = $f.ret; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		/* */ if (v.IsNil()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (v.IsNil()) { */ case 1:
			_r = Zero(typ); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			ret = _r;
			ret.flag = (ret.flag | (((v.flag & 96) >>> 0))) >>> 0;
			$s = -1; return ret;
			return ret;
		/* } */ case 2:
		_r$1 = v.Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = cvtT2I(_r$1, typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		$s = -1; return _r$2;
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtI2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.ret = ret; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ptrType$6.methods = [{prop: "methods", name: "methods", pkg: "reflect", typ: $funcType([], [sliceType$3], false)}];
	ptrType$17.methods = [{prop: "in$", name: "in", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}, {prop: "out", name: "out", pkg: "reflect", typ: $funcType([], [sliceType$2], false)}];
	name.methods = [{prop: "name", name: "name", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "tag", name: "tag", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: $funcType([], [$String], false)}, {prop: "isExported", name: "isExported", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "data", name: "data", pkg: "reflect", typ: $funcType([$Int], [ptrType$5], false)}, {prop: "nameLen", name: "nameLen", pkg: "reflect", typ: $funcType([], [$Int], false)}, {prop: "tagLen", name: "tagLen", pkg: "reflect", typ: $funcType([], [$Int], false)}];
	Kind.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$6], false)}, {prop: "nameOff", name: "nameOff", pkg: "reflect", typ: $funcType([nameOff], [name], false)}, {prop: "typeOff", name: "typeOff", pkg: "reflect", typ: $funcType([typeOff], [ptrType$1], false)}, {prop: "ptrTo", name: "ptrTo", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "pointers", name: "pointers", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "textOff", name: "textOff", pkg: "reflect", typ: $funcType([textOff], [$UnsafePointer], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "exportedMethods", name: "exportedMethods", pkg: "reflect", typ: $funcType([], [sliceType$3], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}];
	ChanDir.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$8.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ptrType$10.methods = [{prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}];
	StructTag.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Lookup", name: "Lookup", pkg: "", typ: $funcType([$String], [$String, $Bool], false)}];
	Value.methods = [{prop: "object", name: "object", pkg: "reflect", typ: $funcType([], [ptrType$3], false)}, {prop: "call", name: "call", pkg: "reflect", typ: $funcType([$String, sliceType$10], [sliceType$10], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "InterfaceData", name: "InterfaceData", pkg: "", typ: $funcType([], [arrayType$12], false)}, {prop: "IsNil", name: "IsNil", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Pointer", name: "Pointer", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([Value], [], false)}, {prop: "SetBytes", name: "SetBytes", pkg: "", typ: $funcType([sliceType$16], [], false)}, {prop: "SetCap", name: "SetCap", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "SetLen", name: "SetLen", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([$Int, $Int], [Value], false)}, {prop: "Slice3", name: "Slice3", pkg: "", typ: $funcType([$Int, $Int, $Int], [Value], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "pointer", name: "pointer", pkg: "reflect", typ: $funcType([], [$UnsafePointer], false)}, {prop: "Addr", name: "Addr", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "runes", name: "runes", pkg: "reflect", typ: $funcType([], [sliceType$18], false)}, {prop: "CanAddr", name: "CanAddr", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CanSet", name: "CanSet", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([sliceType$10], [sliceType$10], false)}, {prop: "CallSlice", name: "CallSlice", pkg: "", typ: $funcType([sliceType$10], [sliceType$10], false)}, {prop: "Complex", name: "Complex", pkg: "", typ: $funcType([], [$Complex128], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [Value], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [Value], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "CanInterface", name: "CanInterface", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "IsValid", name: "IsValid", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "MapIndex", name: "MapIndex", pkg: "", typ: $funcType([Value], [Value], false)}, {prop: "MapKeys", name: "MapKeys", pkg: "", typ: $funcType([], [sliceType$10], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OverflowComplex", name: "OverflowComplex", pkg: "", typ: $funcType([$Complex128], [$Bool], false)}, {prop: "OverflowFloat", name: "OverflowFloat", pkg: "", typ: $funcType([$Float64], [$Bool], false)}, {prop: "OverflowInt", name: "OverflowInt", pkg: "", typ: $funcType([$Int64], [$Bool], false)}, {prop: "OverflowUint", name: "OverflowUint", pkg: "", typ: $funcType([$Uint64], [$Bool], false)}, {prop: "Recv", name: "Recv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "recv", name: "recv", pkg: "reflect", typ: $funcType([$Bool], [Value, $Bool], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([Value], [], false)}, {prop: "send", name: "send", pkg: "reflect", typ: $funcType([Value, $Bool], [$Bool], false)}, {prop: "SetBool", name: "SetBool", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "setRunes", name: "setRunes", pkg: "reflect", typ: $funcType([sliceType$18], [], false)}, {prop: "SetComplex", name: "SetComplex", pkg: "", typ: $funcType([$Complex128], [], false)}, {prop: "SetFloat", name: "SetFloat", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "SetInt", name: "SetInt", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "SetMapIndex", name: "SetMapIndex", pkg: "", typ: $funcType([Value, Value], [], false)}, {prop: "SetUint", name: "SetUint", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "SetPointer", name: "SetPointer", pkg: "", typ: $funcType([$UnsafePointer], [], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TryRecv", name: "TryRecv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "TrySend", name: "TrySend", pkg: "", typ: $funcType([Value], [$Bool], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Uint", name: "Uint", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "UnsafeAddr", name: "UnsafeAddr", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "assignTo", name: "assignTo", pkg: "reflect", typ: $funcType([$String, ptrType$1, $UnsafePointer], [Value], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Type], [Value], false)}];
	flag.methods = [{prop: "kind", name: "kind", pkg: "reflect", typ: $funcType([], [Kind], false)}, {prop: "mustBe", name: "mustBe", pkg: "reflect", typ: $funcType([Kind], [], false)}, {prop: "mustBeExported", name: "mustBeExported", pkg: "reflect", typ: $funcType([], [], false)}, {prop: "mustBeAssignable", name: "mustBeAssignable", pkg: "reflect", typ: $funcType([], [], false)}];
	ptrType$18.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	uncommonType.init("reflect", [{prop: "pkgPath", name: "pkgPath", exported: false, typ: nameOff, tag: ""}, {prop: "mcount", name: "mcount", exported: false, typ: $Uint16, tag: ""}, {prop: "_$2", name: "_", exported: false, typ: $Uint16, tag: ""}, {prop: "moff", name: "moff", exported: false, typ: $Uint32, tag: ""}, {prop: "_$4", name: "_", exported: false, typ: $Uint32, tag: ""}, {prop: "_methods", name: "_methods", exported: false, typ: sliceType$3, tag: ""}]);
	funcType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"func\""}, {prop: "inCount", name: "inCount", exported: false, typ: $Uint16, tag: ""}, {prop: "outCount", name: "outCount", exported: false, typ: $Uint16, tag: ""}, {prop: "_in", name: "_in", exported: false, typ: sliceType$2, tag: ""}, {prop: "_out", name: "_out", exported: false, typ: sliceType$2, tag: ""}]);
	name.init("reflect", [{prop: "bytes", name: "bytes", exported: false, typ: ptrType$5, tag: ""}]);
	nameData.init("reflect", [{prop: "name", name: "name", exported: false, typ: $String, tag: ""}, {prop: "tag", name: "tag", exported: false, typ: $String, tag: ""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: $String, tag: ""}, {prop: "exported", name: "exported", exported: false, typ: $Bool, tag: ""}]);
	mapIter.init("reflect", [{prop: "t", name: "t", exported: false, typ: Type, tag: ""}, {prop: "m", name: "m", exported: false, typ: ptrType$3, tag: ""}, {prop: "keys", name: "keys", exported: false, typ: ptrType$3, tag: ""}, {prop: "i", name: "i", exported: false, typ: $Int, tag: ""}]);
	Type.init([{prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$14], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$6], false)}]);
	rtype.init("reflect", [{prop: "size", name: "size", exported: false, typ: $Uintptr, tag: ""}, {prop: "ptrdata", name: "ptrdata", exported: false, typ: $Uintptr, tag: ""}, {prop: "hash", name: "hash", exported: false, typ: $Uint32, tag: ""}, {prop: "tflag", name: "tflag", exported: false, typ: tflag, tag: ""}, {prop: "align", name: "align", exported: false, typ: $Uint8, tag: ""}, {prop: "fieldAlign", name: "fieldAlign", exported: false, typ: $Uint8, tag: ""}, {prop: "kind", name: "kind", exported: false, typ: $Uint8, tag: ""}, {prop: "alg", name: "alg", exported: false, typ: ptrType$4, tag: ""}, {prop: "gcdata", name: "gcdata", exported: false, typ: ptrType$5, tag: ""}, {prop: "str", name: "str", exported: false, typ: nameOff, tag: ""}, {prop: "ptrToThis", name: "ptrToThis", exported: false, typ: typeOff, tag: ""}]);
	typeAlg.init("reflect", [{prop: "hash", name: "hash", exported: false, typ: funcType$4, tag: ""}, {prop: "equal", name: "equal", exported: false, typ: funcType$5, tag: ""}]);
	method.init("reflect", [{prop: "name", name: "name", exported: false, typ: nameOff, tag: ""}, {prop: "mtyp", name: "mtyp", exported: false, typ: typeOff, tag: ""}, {prop: "ifn", name: "ifn", exported: false, typ: textOff, tag: ""}, {prop: "tfn", name: "tfn", exported: false, typ: textOff, tag: ""}]);
	arrayType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"array\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "slice", name: "slice", exported: false, typ: ptrType$1, tag: ""}, {prop: "len", name: "len", exported: false, typ: $Uintptr, tag: ""}]);
	chanType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"chan\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "dir", name: "dir", exported: false, typ: $Uintptr, tag: ""}]);
	imethod.init("reflect", [{prop: "name", name: "name", exported: false, typ: nameOff, tag: ""}, {prop: "typ", name: "typ", exported: false, typ: typeOff, tag: ""}]);
	interfaceType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"interface\""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: name, tag: ""}, {prop: "methods", name: "methods", exported: false, typ: sliceType$7, tag: ""}]);
	mapType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"map\""}, {prop: "key", name: "key", exported: false, typ: ptrType$1, tag: ""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}, {prop: "bucket", name: "bucket", exported: false, typ: ptrType$1, tag: ""}, {prop: "hmap", name: "hmap", exported: false, typ: ptrType$1, tag: ""}, {prop: "keysize", name: "keysize", exported: false, typ: $Uint8, tag: ""}, {prop: "indirectkey", name: "indirectkey", exported: false, typ: $Uint8, tag: ""}, {prop: "valuesize", name: "valuesize", exported: false, typ: $Uint8, tag: ""}, {prop: "indirectvalue", name: "indirectvalue", exported: false, typ: $Uint8, tag: ""}, {prop: "bucketsize", name: "bucketsize", exported: false, typ: $Uint16, tag: ""}, {prop: "reflexivekey", name: "reflexivekey", exported: false, typ: $Bool, tag: ""}, {prop: "needkeyupdate", name: "needkeyupdate", exported: false, typ: $Bool, tag: ""}]);
	ptrType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"ptr\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}]);
	sliceType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"slice\""}, {prop: "elem", name: "elem", exported: false, typ: ptrType$1, tag: ""}]);
	structField.init("reflect", [{prop: "name", name: "name", exported: false, typ: name, tag: ""}, {prop: "typ", name: "typ", exported: false, typ: ptrType$1, tag: ""}, {prop: "offset", name: "offset", exported: false, typ: $Uintptr, tag: ""}]);
	structType.init("reflect", [{prop: "rtype", name: "", exported: false, typ: rtype, tag: "reflect:\"struct\""}, {prop: "pkgPath", name: "pkgPath", exported: false, typ: name, tag: ""}, {prop: "fields", name: "fields", exported: false, typ: sliceType$8, tag: ""}]);
	Method.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: Type, tag: ""}, {prop: "Func", name: "Func", exported: true, typ: Value, tag: ""}, {prop: "Index", name: "Index", exported: true, typ: $Int, tag: ""}]);
	StructField.init("", [{prop: "Name", name: "Name", exported: true, typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", exported: true, typ: $String, tag: ""}, {prop: "Type", name: "Type", exported: true, typ: Type, tag: ""}, {prop: "Tag", name: "Tag", exported: true, typ: StructTag, tag: ""}, {prop: "Offset", name: "Offset", exported: true, typ: $Uintptr, tag: ""}, {prop: "Index", name: "Index", exported: true, typ: sliceType$14, tag: ""}, {prop: "Anonymous", name: "Anonymous", exported: true, typ: $Bool, tag: ""}]);
	fieldScan.init("reflect", [{prop: "typ", name: "typ", exported: false, typ: ptrType$10, tag: ""}, {prop: "index", name: "index", exported: false, typ: sliceType$14, tag: ""}]);
	Value.init("reflect", [{prop: "typ", name: "typ", exported: false, typ: ptrType$1, tag: ""}, {prop: "ptr", name: "ptr", exported: false, typ: $UnsafePointer, tag: ""}, {prop: "flag", name: "", exported: false, typ: flag, tag: ""}]);
	ValueError.init("", [{prop: "Method", name: "Method", exported: true, typ: $String, tag: ""}, {prop: "Kind", name: "Kind", exported: true, typ: Kind, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		nameOffList = sliceType$1.nil;
		typeOffList = sliceType$2.nil;
		methodCache = new structType$1.ptr(new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0), false);
		initialized = false;
		uncommonTypeMap = {};
		nameMap = {};
		callHelper = $assertType($internalize($call, $emptyInterface), funcType$1);
		selectHelper = $assertType($internalize($select, $emptyInterface), funcType$1);
		kindNames = new sliceType$6(["invalid", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "array", "chan", "func", "interface", "map", "ptr", "slice", "string", "struct", "unsafe.Pointer"]);
		jsObjectPtr = reflectType($jsObjectPtr);
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$r = init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["fmt"] = (function() {
	var $pkg = {}, $init, errors, io, math, os, reflect, strconv, sync, utf8, fmtFlags, fmt, buffer, pp, scanError, ss, ssave, sliceType, ptrType, ptrType$1, arrayType, arrayType$1, sliceType$1, sliceType$2, ptrType$2, ptrType$5, ptrType$25, funcType, ppFree, byteType, space, ssFree, complexError, boolError, isSpace, notSpace, indexRune;
	errors = $packages["errors"];
	io = $packages["io"];
	math = $packages["math"];
	os = $packages["os"];
	reflect = $packages["reflect"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	utf8 = $packages["unicode/utf8"];
	fmtFlags = $pkg.fmtFlags = $newType(0, $kindStruct, "fmt.fmtFlags", true, "fmt", false, function(widPresent_, precPresent_, minus_, plus_, sharp_, space_, zero_, plusV_, sharpV_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.widPresent = false;
			this.precPresent = false;
			this.minus = false;
			this.plus = false;
			this.sharp = false;
			this.space = false;
			this.zero = false;
			this.plusV = false;
			this.sharpV = false;
			return;
		}
		this.widPresent = widPresent_;
		this.precPresent = precPresent_;
		this.minus = minus_;
		this.plus = plus_;
		this.sharp = sharp_;
		this.space = space_;
		this.zero = zero_;
		this.plusV = plusV_;
		this.sharpV = sharpV_;
	});
	fmt = $pkg.fmt = $newType(0, $kindStruct, "fmt.fmt", true, "fmt", false, function(buf_, fmtFlags_, wid_, prec_, intbuf_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = ptrType$1.nil;
			this.fmtFlags = new fmtFlags.ptr(false, false, false, false, false, false, false, false, false);
			this.wid = 0;
			this.prec = 0;
			this.intbuf = arrayType.zero();
			return;
		}
		this.buf = buf_;
		this.fmtFlags = fmtFlags_;
		this.wid = wid_;
		this.prec = prec_;
		this.intbuf = intbuf_;
	});
	buffer = $pkg.buffer = $newType(12, $kindSlice, "fmt.buffer", true, "fmt", false, null);
	pp = $pkg.pp = $newType(0, $kindStruct, "fmt.pp", true, "fmt", false, function(buf_, arg_, value_, fmt_, reordered_, goodArgNum_, panicking_, erroring_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = buffer.nil;
			this.arg = $ifaceNil;
			this.value = new reflect.Value.ptr(ptrType.nil, 0, 0);
			this.fmt = new fmt.ptr(ptrType$1.nil, new fmtFlags.ptr(false, false, false, false, false, false, false, false, false), 0, 0, arrayType.zero());
			this.reordered = false;
			this.goodArgNum = false;
			this.panicking = false;
			this.erroring = false;
			return;
		}
		this.buf = buf_;
		this.arg = arg_;
		this.value = value_;
		this.fmt = fmt_;
		this.reordered = reordered_;
		this.goodArgNum = goodArgNum_;
		this.panicking = panicking_;
		this.erroring = erroring_;
	});
	scanError = $pkg.scanError = $newType(0, $kindStruct, "fmt.scanError", true, "fmt", false, function(err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.err = $ifaceNil;
			return;
		}
		this.err = err_;
	});
	ss = $pkg.ss = $newType(0, $kindStruct, "fmt.ss", true, "fmt", false, function(rs_, buf_, count_, atEOF_, ssave_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rs = $ifaceNil;
			this.buf = buffer.nil;
			this.count = 0;
			this.atEOF = false;
			this.ssave = new ssave.ptr(false, false, false, 0, 0, 0);
			return;
		}
		this.rs = rs_;
		this.buf = buf_;
		this.count = count_;
		this.atEOF = atEOF_;
		this.ssave = ssave_;
	});
	ssave = $pkg.ssave = $newType(0, $kindStruct, "fmt.ssave", true, "fmt", false, function(validSave_, nlIsEnd_, nlIsSpace_, argLimit_, limit_, maxWid_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.validSave = false;
			this.nlIsEnd = false;
			this.nlIsSpace = false;
			this.argLimit = 0;
			this.limit = 0;
			this.maxWid = 0;
			return;
		}
		this.validSave = validSave_;
		this.nlIsEnd = nlIsEnd_;
		this.nlIsSpace = nlIsSpace_;
		this.argLimit = argLimit_;
		this.limit = limit_;
		this.maxWid = maxWid_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(reflect.rtype);
	ptrType$1 = $ptrType(buffer);
	arrayType = $arrayType($Uint8, 68);
	arrayType$1 = $arrayType($Uint16, 2);
	sliceType$1 = $sliceType(arrayType$1);
	sliceType$2 = $sliceType($Uint8);
	ptrType$2 = $ptrType(pp);
	ptrType$5 = $ptrType(ss);
	ptrType$25 = $ptrType(fmt);
	funcType = $funcType([$Int32], [$Bool], false);
	$ptrType(buffer).prototype.Write = function(p) {
		var $ptr, b, p;
		b = this;
		b.$set($appendSlice(b.$get(), p));
	};
	$ptrType(buffer).prototype.WriteString = function(s) {
		var $ptr, b, s;
		b = this;
		b.$set($appendSlice(b.$get(), s));
	};
	$ptrType(buffer).prototype.WriteByte = function(c) {
		var $ptr, b, c;
		b = this;
		b.$set($append(b.$get(), c));
	};
	$ptrType(buffer).prototype.WriteRune = function(r) {
		var $ptr, b, bp, n, r, w, x;
		bp = this;
		if (r < 128) {
			bp.$set($append(bp.$get(), (r << 24 >>> 24)));
			return;
		}
		b = bp.$get();
		n = b.$length;
		while (true) {
			if (!((n + 4 >> 0) > b.$capacity)) { break; }
			b = $append(b, 0);
		}
		w = utf8.EncodeRune((x = $subslice(b, n, (n + 4 >> 0)), $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length)), r);
		bp.$set($subslice(b, 0, (n + w >> 0)));
	};
	pp.ptr.prototype.Width = function() {
		var $ptr, _tmp, _tmp$1, ok, p, wid;
		wid = 0;
		ok = false;
		p = this;
		_tmp = p.fmt.wid;
		_tmp$1 = p.fmt.fmtFlags.widPresent;
		wid = _tmp;
		ok = _tmp$1;
		return [wid, ok];
	};
	pp.prototype.Width = function() { return this.$val.Width(); };
	pp.ptr.prototype.Precision = function() {
		var $ptr, _tmp, _tmp$1, ok, p, prec;
		prec = 0;
		ok = false;
		p = this;
		_tmp = p.fmt.prec;
		_tmp$1 = p.fmt.fmtFlags.precPresent;
		prec = _tmp;
		ok = _tmp$1;
		return [prec, ok];
	};
	pp.prototype.Precision = function() { return this.$val.Precision(); };
	pp.ptr.prototype.Flag = function(b) {
		var $ptr, _1, b, p;
		p = this;
		_1 = b;
		if (_1 === (45)) {
			return p.fmt.fmtFlags.minus;
		} else if (_1 === (43)) {
			return p.fmt.fmtFlags.plus || p.fmt.fmtFlags.plusV;
		} else if (_1 === (35)) {
			return p.fmt.fmtFlags.sharp || p.fmt.fmtFlags.sharpV;
		} else if (_1 === (32)) {
			return p.fmt.fmtFlags.space;
		} else if (_1 === (48)) {
			return p.fmt.fmtFlags.zero;
		}
		return false;
	};
	pp.prototype.Flag = function(b) { return this.$val.Flag(b); };
	pp.ptr.prototype.Write = function(b) {
		var $ptr, _tmp, _tmp$1, b, err, p, ret;
		ret = 0;
		err = $ifaceNil;
		p = this;
		(p.$ptr_buf || (p.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, p))).Write(b);
		_tmp = b.$length;
		_tmp$1 = $ifaceNil;
		ret = _tmp;
		err = _tmp$1;
		return [ret, err];
	};
	pp.prototype.Write = function(b) { return this.$val.Write(b); };
	ss.ptr.prototype.Read = function(buf) {
		var $ptr, _tmp, _tmp$1, buf, err, n, s;
		n = 0;
		err = $ifaceNil;
		s = this;
		_tmp = 0;
		_tmp$1 = errors.New("ScanState's Read should not be called. Use ReadRune");
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	ss.prototype.Read = function(buf) { return this.$val.Read(buf); };
	ss.ptr.prototype.ReadRune = function() {
		var $ptr, _r, _tuple, err, r, s, size, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; size = $f.size; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		size = 0;
		err = $ifaceNil;
		s = this;
		if (s.atEOF || s.count >= s.ssave.argLimit) {
			err = io.EOF;
			$s = -1; return [r, size, err];
			return [r, size, err];
		}
		_r = s.rs.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		size = _tuple[1];
		err = _tuple[2];
		if ($interfaceIsEqual(err, $ifaceNil)) {
			s.count = s.count + (1) >> 0;
			if (s.ssave.nlIsEnd && (r === 10)) {
				s.atEOF = true;
			}
		} else if ($interfaceIsEqual(err, io.EOF)) {
			s.atEOF = true;
		}
		$s = -1; return [r, size, err];
		return [r, size, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.ReadRune }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.size = size; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	ss.ptr.prototype.Width = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, ok, s, wid;
		wid = 0;
		ok = false;
		s = this;
		if (s.ssave.maxWid === 1073741824) {
			_tmp = 0;
			_tmp$1 = false;
			wid = _tmp;
			ok = _tmp$1;
			return [wid, ok];
		}
		_tmp$2 = s.ssave.maxWid;
		_tmp$3 = true;
		wid = _tmp$2;
		ok = _tmp$3;
		return [wid, ok];
	};
	ss.prototype.Width = function() { return this.$val.Width(); };
	ss.ptr.prototype.getRune = function() {
		var $ptr, _r, _tuple, err, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = 0;
		s = this;
		_r = s.ReadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		r = _tuple[0];
		err = _tuple[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			if ($interfaceIsEqual(err, io.EOF)) {
				r = -1;
				$s = -1; return r;
				return r;
			}
			s.error(err);
		}
		$s = -1; return r;
		return r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.getRune }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.getRune = function() { return this.$val.getRune(); };
	ss.ptr.prototype.UnreadRune = function() {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.rs.UnreadRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		s.atEOF = false;
		s.count = s.count - (1) >> 0;
		$s = -1; return $ifaceNil;
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.UnreadRune }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	ss.ptr.prototype.error = function(err) {
		var $ptr, err, s, x;
		s = this;
		$panic((x = new scanError.ptr(err), new x.constructor.elem(x)));
	};
	ss.prototype.error = function(err) { return this.$val.error(err); };
	ss.ptr.prototype.errorString = function(err) {
		var $ptr, err, s, x;
		s = this;
		$panic((x = new scanError.ptr(errors.New(err)), new x.constructor.elem(x)));
	};
	ss.prototype.errorString = function(err) { return this.$val.errorString(err); };
	ss.ptr.prototype.Token = function(skipSpace, f) {
		var $ptr, _r, err, f, s, skipSpace, tok, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; f = $f.f; s = $f.s; skipSpace = $f.skipSpace; tok = $f.tok; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = [err];
		tok = sliceType$2.nil;
		err[0] = $ifaceNil;
		s = this;
		$deferred.push([(function(err) { return function() {
			var $ptr, _tuple, e, ok, se;
			e = $recover();
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tuple = $assertType(e, scanError, true);
				se = $clone(_tuple[0], scanError);
				ok = _tuple[1];
				if (ok) {
					err[0] = se.err;
				} else {
					$panic(e);
				}
			}
		}; })(err), []]);
		if (f === $throwNilPointerError) {
			f = notSpace;
		}
		s.buf = $subslice(s.buf, 0, 0);
		_r = s.token(skipSpace, f); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		tok = _r;
		$s = -1; return [tok, err[0]];
		return [tok, err[0]];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [tok, err[0]]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: ss.ptr.prototype.Token }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.f = f; $f.s = s; $f.skipSpace = skipSpace; $f.tok = tok; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	ss.prototype.Token = function(skipSpace, f) { return this.$val.Token(skipSpace, f); };
	isSpace = function(r) {
		var $ptr, _i, _ref, r, rng, rx;
		if (r >= 65536) {
			return false;
		}
		rx = (r << 16 >>> 16);
		_ref = space;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			rng = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), arrayType$1);
			if (rx < rng[0]) {
				return false;
			}
			if (rx <= rng[1]) {
				return true;
			}
			_i++;
		}
		return false;
	};
	notSpace = function(r) {
		var $ptr, r;
		return !isSpace(r);
	};
	ss.ptr.prototype.SkipSpace = function() {
		var $ptr, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		$r = s.skipSpace(false); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.SkipSpace }; } $f.$ptr = $ptr; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.SkipSpace = function() { return this.$val.SkipSpace(); };
	ss.ptr.prototype.skipSpace = function(stopAtNewline) {
		var $ptr, _r, _r$1, _r$2, _v, r, s, stopAtNewline, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _v = $f._v; r = $f.r; s = $f.s; stopAtNewline = $f.stopAtNewline; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* while (true) { */ case 1:
			_r = s.getRune(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (r === -1) {
				$s = -1; return;
				return;
			}
			if (!(r === 13)) { _v = false; $s = 6; continue s; }
			_r$1 = s.peek("\n"); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_v = _r$1; case 6:
			/* */ if (_v) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_v) { */ case 4:
				/* continue; */ $s = 1; continue;
			/* } */ case 5:
			/* */ if (r === 10) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (r === 10) { */ case 8:
				if (stopAtNewline) {
					/* break; */ $s = 2; continue;
				}
				if (s.ssave.nlIsSpace) {
					/* continue; */ $s = 1; continue;
				}
				s.errorString("unexpected newline");
				$s = -1; return;
				return;
			/* } */ case 9:
			/* */ if (!isSpace(r)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (!isSpace(r)) { */ case 10:
				_r$2 = s.UnreadRune(); /* */ $s = 12; case 12: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$2;
				/* break; */ $s = 2; continue;
			/* } */ case 11:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.skipSpace }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._v = _v; $f.r = r; $f.s = s; $f.stopAtNewline = stopAtNewline; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.skipSpace = function(stopAtNewline) { return this.$val.skipSpace(stopAtNewline); };
	ss.ptr.prototype.token = function(skipSpace, f) {
		var $ptr, _r, _r$1, _r$2, f, r, s, skipSpace, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; r = $f.r; s = $f.s; skipSpace = $f.skipSpace; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (skipSpace) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (skipSpace) { */ case 1:
			$r = s.skipSpace(false); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* while (true) { */ case 4:
			_r = s.getRune(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (r === -1) {
				/* break; */ $s = 5; continue;
			}
			_r$1 = f(r); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!_r$1) { */ case 7:
				_r$2 = s.UnreadRune(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$2;
				/* break; */ $s = 5; continue;
			/* } */ case 8:
			(s.$ptr_buf || (s.$ptr_buf = new ptrType$1(function() { return this.$target.buf; }, function($v) { this.$target.buf = $v; }, s))).WriteRune(r);
		/* } */ $s = 4; continue; case 5:
		$s = -1; return (x = s.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length));
		return (x = s.buf, $subslice(new sliceType$2(x.$array), x.$offset, x.$offset + x.$length));
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.token }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.r = r; $f.s = s; $f.skipSpace = skipSpace; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.token = function(skipSpace, f) { return this.$val.token(skipSpace, f); };
	indexRune = function(s, r) {
		var $ptr, _i, _ref, _rune, c, i, r, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			if (c === r) {
				return i;
			}
			_i += _rune[1];
		}
		return -1;
	};
	ss.ptr.prototype.peek = function(ok) {
		var $ptr, _r, _r$1, ok, r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; ok = $f.ok; r = $f.r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		_r = s.getRune(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		r = _r;
		/* */ if (!((r === -1))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === -1))) { */ case 2:
			_r$1 = s.UnreadRune(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$1;
		/* } */ case 3:
		$s = -1; return indexRune(ok, r) >= 0;
		return indexRune(ok, r) >= 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ss.ptr.prototype.peek }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.ok = ok; $f.r = r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	ss.prototype.peek = function(ok) { return this.$val.peek(ok); };
	ptrType$25.methods = [{prop: "clearflags", name: "clearflags", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "init", name: "init", pkg: "fmt", typ: $funcType([ptrType$1], [], false)}, {prop: "writePadding", name: "writePadding", pkg: "fmt", typ: $funcType([$Int], [], false)}, {prop: "pad", name: "pad", pkg: "fmt", typ: $funcType([sliceType$2], [], false)}, {prop: "padString", name: "padString", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_boolean", name: "fmt_boolean", pkg: "fmt", typ: $funcType([$Bool], [], false)}, {prop: "fmt_unicode", name: "fmt_unicode", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_integer", name: "fmt_integer", pkg: "fmt", typ: $funcType([$Uint64, $Int, $Bool, $String], [], false)}, {prop: "truncate", name: "truncate", pkg: "fmt", typ: $funcType([$String], [$String], false)}, {prop: "fmt_s", name: "fmt_s", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_sbx", name: "fmt_sbx", pkg: "fmt", typ: $funcType([$String, sliceType$2, $String], [], false)}, {prop: "fmt_sx", name: "fmt_sx", pkg: "fmt", typ: $funcType([$String, $String], [], false)}, {prop: "fmt_bx", name: "fmt_bx", pkg: "fmt", typ: $funcType([sliceType$2, $String], [], false)}, {prop: "fmt_q", name: "fmt_q", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "fmt_c", name: "fmt_c", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_qc", name: "fmt_qc", pkg: "fmt", typ: $funcType([$Uint64], [], false)}, {prop: "fmt_float", name: "fmt_float", pkg: "fmt", typ: $funcType([$Float64, $Int, $Int32, $Int], [], false)}];
	ptrType$1.methods = [{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$2], [], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [], false)}];
	ptrType$2.methods = [{prop: "free", name: "free", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Precision", name: "Precision", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "Flag", name: "Flag", pkg: "", typ: $funcType([$Int], [$Bool], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType$2], [$Int, $error], false)}, {prop: "unknownType", name: "unknownType", pkg: "fmt", typ: $funcType([reflect.Value], [], false)}, {prop: "badVerb", name: "badVerb", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "fmtBool", name: "fmtBool", pkg: "fmt", typ: $funcType([$Bool, $Int32], [], false)}, {prop: "fmt0x64", name: "fmt0x64", pkg: "fmt", typ: $funcType([$Uint64, $Bool], [], false)}, {prop: "fmtInteger", name: "fmtInteger", pkg: "fmt", typ: $funcType([$Uint64, $Bool, $Int32], [], false)}, {prop: "fmtFloat", name: "fmtFloat", pkg: "fmt", typ: $funcType([$Float64, $Int, $Int32], [], false)}, {prop: "fmtComplex", name: "fmtComplex", pkg: "fmt", typ: $funcType([$Complex128, $Int, $Int32], [], false)}, {prop: "fmtString", name: "fmtString", pkg: "fmt", typ: $funcType([$String, $Int32], [], false)}, {prop: "fmtBytes", name: "fmtBytes", pkg: "fmt", typ: $funcType([sliceType$2, $Int32, $String], [], false)}, {prop: "fmtPointer", name: "fmtPointer", pkg: "fmt", typ: $funcType([reflect.Value, $Int32], [], false)}, {prop: "catchPanic", name: "catchPanic", pkg: "fmt", typ: $funcType([$emptyInterface, $Int32], [], false)}, {prop: "handleMethods", name: "handleMethods", pkg: "fmt", typ: $funcType([$Int32], [$Bool], false)}, {prop: "printArg", name: "printArg", pkg: "fmt", typ: $funcType([$emptyInterface, $Int32], [], false)}, {prop: "printValue", name: "printValue", pkg: "fmt", typ: $funcType([reflect.Value, $Int32, $Int], [], false)}, {prop: "argNumber", name: "argNumber", pkg: "fmt", typ: $funcType([$Int, $String, $Int, $Int], [$Int, $Int, $Bool], false)}, {prop: "badArgNum", name: "badArgNum", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "missingArg", name: "missingArg", pkg: "fmt", typ: $funcType([$Int32], [], false)}, {prop: "doPrintf", name: "doPrintf", pkg: "fmt", typ: $funcType([$String, sliceType], [], false)}, {prop: "doPrint", name: "doPrint", pkg: "fmt", typ: $funcType([sliceType], [], false)}, {prop: "doPrintln", name: "doPrintln", pkg: "fmt", typ: $funcType([sliceType], [], false)}];
	ptrType$5.methods = [{prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$2], [$Int, $error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "Width", name: "Width", pkg: "", typ: $funcType([], [$Int, $Bool], false)}, {prop: "getRune", name: "getRune", pkg: "fmt", typ: $funcType([], [$Int32], false)}, {prop: "mustReadRune", name: "mustReadRune", pkg: "fmt", typ: $funcType([], [$Int32], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "error", name: "error", pkg: "fmt", typ: $funcType([$error], [], false)}, {prop: "errorString", name: "errorString", pkg: "fmt", typ: $funcType([$String], [], false)}, {prop: "Token", name: "Token", pkg: "", typ: $funcType([$Bool, funcType], [sliceType$2, $error], false)}, {prop: "SkipSpace", name: "SkipSpace", pkg: "", typ: $funcType([], [], false)}, {prop: "free", name: "free", pkg: "fmt", typ: $funcType([ssave], [], false)}, {prop: "skipSpace", name: "skipSpace", pkg: "fmt", typ: $funcType([$Bool], [], false)}, {prop: "token", name: "token", pkg: "fmt", typ: $funcType([$Bool, funcType], [sliceType$2], false)}, {prop: "consume", name: "consume", pkg: "fmt", typ: $funcType([$String, $Bool], [$Bool], false)}, {prop: "peek", name: "peek", pkg: "fmt", typ: $funcType([$String], [$Bool], false)}, {prop: "notEOF", name: "notEOF", pkg: "fmt", typ: $funcType([], [], false)}, {prop: "accept", name: "accept", pkg: "fmt", typ: $funcType([$String], [$Bool], false)}, {prop: "okVerb", name: "okVerb", pkg: "fmt", typ: $funcType([$Int32, $String, $String], [$Bool], false)}, {prop: "scanBool", name: "scanBool", pkg: "fmt", typ: $funcType([$Int32], [$Bool], false)}, {prop: "getBase", name: "getBase", pkg: "fmt", typ: $funcType([$Int32], [$Int, $String], false)}, {prop: "scanNumber", name: "scanNumber", pkg: "fmt", typ: $funcType([$String, $Bool], [$String], false)}, {prop: "scanRune", name: "scanRune", pkg: "fmt", typ: $funcType([$Int], [$Int64], false)}, {prop: "scanBasePrefix", name: "scanBasePrefix", pkg: "fmt", typ: $funcType([], [$Int, $String, $Bool], false)}, {prop: "scanInt", name: "scanInt", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Int64], false)}, {prop: "scanUint", name: "scanUint", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Uint64], false)}, {prop: "floatToken", name: "floatToken", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "complexTokens", name: "complexTokens", pkg: "fmt", typ: $funcType([], [$String, $String], false)}, {prop: "convertFloat", name: "convertFloat", pkg: "fmt", typ: $funcType([$String, $Int], [$Float64], false)}, {prop: "scanComplex", name: "scanComplex", pkg: "fmt", typ: $funcType([$Int32, $Int], [$Complex128], false)}, {prop: "convertString", name: "convertString", pkg: "fmt", typ: $funcType([$Int32], [$String], false)}, {prop: "quotedString", name: "quotedString", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "hexByte", name: "hexByte", pkg: "fmt", typ: $funcType([], [$Uint8, $Bool], false)}, {prop: "hexString", name: "hexString", pkg: "fmt", typ: $funcType([], [$String], false)}, {prop: "scanOne", name: "scanOne", pkg: "fmt", typ: $funcType([$Int32, $emptyInterface], [], false)}, {prop: "doScan", name: "doScan", pkg: "fmt", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "advance", name: "advance", pkg: "fmt", typ: $funcType([$String], [$Int], false)}, {prop: "doScanf", name: "doScanf", pkg: "fmt", typ: $funcType([$String, sliceType], [$Int, $error], false)}];
	fmtFlags.init("fmt", [{prop: "widPresent", name: "widPresent", exported: false, typ: $Bool, tag: ""}, {prop: "precPresent", name: "precPresent", exported: false, typ: $Bool, tag: ""}, {prop: "minus", name: "minus", exported: false, typ: $Bool, tag: ""}, {prop: "plus", name: "plus", exported: false, typ: $Bool, tag: ""}, {prop: "sharp", name: "sharp", exported: false, typ: $Bool, tag: ""}, {prop: "space", name: "space", exported: false, typ: $Bool, tag: ""}, {prop: "zero", name: "zero", exported: false, typ: $Bool, tag: ""}, {prop: "plusV", name: "plusV", exported: false, typ: $Bool, tag: ""}, {prop: "sharpV", name: "sharpV", exported: false, typ: $Bool, tag: ""}]);
	fmt.init("fmt", [{prop: "buf", name: "buf", exported: false, typ: ptrType$1, tag: ""}, {prop: "fmtFlags", name: "", exported: false, typ: fmtFlags, tag: ""}, {prop: "wid", name: "wid", exported: false, typ: $Int, tag: ""}, {prop: "prec", name: "prec", exported: false, typ: $Int, tag: ""}, {prop: "intbuf", name: "intbuf", exported: false, typ: arrayType, tag: ""}]);
	buffer.init($Uint8);
	pp.init("fmt", [{prop: "buf", name: "buf", exported: false, typ: buffer, tag: ""}, {prop: "arg", name: "arg", exported: false, typ: $emptyInterface, tag: ""}, {prop: "value", name: "value", exported: false, typ: reflect.Value, tag: ""}, {prop: "fmt", name: "fmt", exported: false, typ: fmt, tag: ""}, {prop: "reordered", name: "reordered", exported: false, typ: $Bool, tag: ""}, {prop: "goodArgNum", name: "goodArgNum", exported: false, typ: $Bool, tag: ""}, {prop: "panicking", name: "panicking", exported: false, typ: $Bool, tag: ""}, {prop: "erroring", name: "erroring", exported: false, typ: $Bool, tag: ""}]);
	scanError.init("fmt", [{prop: "err", name: "err", exported: false, typ: $error, tag: ""}]);
	ss.init("fmt", [{prop: "rs", name: "rs", exported: false, typ: io.RuneScanner, tag: ""}, {prop: "buf", name: "buf", exported: false, typ: buffer, tag: ""}, {prop: "count", name: "count", exported: false, typ: $Int, tag: ""}, {prop: "atEOF", name: "atEOF", exported: false, typ: $Bool, tag: ""}, {prop: "ssave", name: "", exported: false, typ: ssave, tag: ""}]);
	ssave.init("fmt", [{prop: "validSave", name: "validSave", exported: false, typ: $Bool, tag: ""}, {prop: "nlIsEnd", name: "nlIsEnd", exported: false, typ: $Bool, tag: ""}, {prop: "nlIsSpace", name: "nlIsSpace", exported: false, typ: $Bool, tag: ""}, {prop: "argLimit", name: "argLimit", exported: false, typ: $Int, tag: ""}, {prop: "limit", name: "limit", exported: false, typ: $Int, tag: ""}, {prop: "maxWid", name: "maxWid", exported: false, typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = os.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ppFree = new sync.Pool.ptr(0, 0, sliceType.nil, (function() {
			var $ptr;
			return new pp.ptr(buffer.nil, $ifaceNil, new reflect.Value.ptr(ptrType.nil, 0, 0), new fmt.ptr(ptrType$1.nil, new fmtFlags.ptr(false, false, false, false, false, false, false, false, false), 0, 0, arrayType.zero()), false, false, false, false);
		}));
		byteType = reflect.TypeOf(new $Uint8(0));
		space = new sliceType$1([$toNativeArray($kindUint16, [9, 13]), $toNativeArray($kindUint16, [32, 32]), $toNativeArray($kindUint16, [133, 133]), $toNativeArray($kindUint16, [160, 160]), $toNativeArray($kindUint16, [5760, 5760]), $toNativeArray($kindUint16, [8192, 8202]), $toNativeArray($kindUint16, [8232, 8233]), $toNativeArray($kindUint16, [8239, 8239]), $toNativeArray($kindUint16, [8287, 8287]), $toNativeArray($kindUint16, [12288, 12288])]);
		ssFree = new sync.Pool.ptr(0, 0, sliceType.nil, (function() {
			var $ptr;
			return new ss.ptr($ifaceNil, buffer.nil, 0, false, new ssave.ptr(false, false, false, 0, 0, 0));
		}));
		complexError = errors.New("syntax error scanning complex number");
		boolError = errors.New("syntax error scanning boolean");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, io, unicode, utf8;
	errors = $packages["errors"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sort"] = (function() {
	var $pkg = {}, $init, insertionSort, siftDown, heapSort, medianOfThree, doPivot, quickSort, Sort;
	insertionSort = function(data, a, b) {
		var $ptr, _r, _v, a, b, data, i, j, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _v = $f._v; a = $f.a; b = $f.b; data = $f.data; i = $f.i; j = $f.j; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = a + 1 >> 0;
		/* while (true) { */ case 1:
			/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 2; continue; }
			j = i;
			/* while (true) { */ case 3:
				if (!(j > a)) { _v = false; $s = 5; continue s; }
				_r = data.Less(j, j - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r; case 5:
				/* if (!(_v)) { break; } */ if(!(_v)) { $s = 4; continue; }
				$r = data.Swap(j, j - 1 >> 0); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				j = j - (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: insertionSort }; } $f.$ptr = $ptr; $f._r = _r; $f._v = _v; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.j = j; $f.$s = $s; $f.$r = $r; return $f;
	};
	siftDown = function(data, lo, hi, first) {
		var $ptr, _r, _r$1, _v, child, data, first, hi, lo, root, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; child = $f.child; data = $f.data; first = $f.first; hi = $f.hi; lo = $f.lo; root = $f.root; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		root = lo;
		/* while (true) { */ case 1:
			child = ($imul(2, root)) + 1 >> 0;
			if (child >= hi) {
				/* break; */ $s = 2; continue;
			}
			if (!((child + 1 >> 0) < hi)) { _v = false; $s = 5; continue s; }
			_r = data.Less(first + child >> 0, (first + child >> 0) + 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 5:
			/* */ if (_v) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_v) { */ case 3:
				child = child + (1) >> 0;
			/* } */ case 4:
			_r$1 = data.Less(first + root >> 0, first + child >> 0); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!_r$1) { */ case 7:
				$s = -1; return;
				return;
			/* } */ case 8:
			$r = data.Swap(first + root >> 0, first + child >> 0); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			root = child;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: siftDown }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.child = child; $f.data = data; $f.first = first; $f.hi = hi; $f.lo = lo; $f.root = root; $f.$s = $s; $f.$r = $r; return $f;
	};
	heapSort = function(data, a, b) {
		var $ptr, _q, a, b, data, first, hi, i, i$1, lo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; a = $f.a; b = $f.b; data = $f.data; first = $f.first; hi = $f.hi; i = $f.i; i$1 = $f.i$1; lo = $f.lo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = a;
		lo = 0;
		hi = b - a >> 0;
		i = (_q = ((hi - 1 >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* while (true) { */ case 1:
			/* if (!(i >= 0)) { break; } */ if(!(i >= 0)) { $s = 2; continue; }
			$r = siftDown(data, i, hi, first); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		i$1 = hi - 1 >> 0;
		/* while (true) { */ case 4:
			/* if (!(i$1 >= 0)) { break; } */ if(!(i$1 >= 0)) { $s = 5; continue; }
			$r = data.Swap(first, first + i$1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = siftDown(data, lo, i$1, first); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i$1 = i$1 - (1) >> 0;
		/* } */ $s = 4; continue; case 5:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: heapSort }; } $f.$ptr = $ptr; $f._q = _q; $f.a = a; $f.b = b; $f.data = data; $f.first = first; $f.hi = hi; $f.i = i; $f.i$1 = i$1; $f.lo = lo; $f.$s = $s; $f.$r = $r; return $f;
	};
	medianOfThree = function(data, m1, m0, m2) {
		var $ptr, _r, _r$1, _r$2, data, m0, m1, m2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; data = $f.data; m0 = $f.m0; m1 = $f.m1; m2 = $f.m2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Less(m1, m0); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r) { */ case 1:
			$r = data.Swap(m1, m0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		_r$1 = data.Less(m2, m1); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (_r$1) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (_r$1) { */ case 5:
			$r = data.Swap(m2, m1); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_r$2 = data.Less(m1, m0); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (_r$2) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_r$2) { */ case 9:
				$r = data.Swap(m1, m0); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 10:
		/* } */ case 6:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: medianOfThree }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.data = data; $f.m0 = m0; $f.m1 = m1; $f.m2 = m2; $f.$s = $s; $f.$r = $r; return $f;
	};
	doPivot = function(data, lo, hi) {
		var $ptr, _q, _q$1, _q$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tmp, _tmp$1, _tmp$2, _tmp$3, _v, _v$1, _v$2, _v$3, _v$4, a, b, c, data, dups, hi, lo, m, midhi, midlo, pivot, protect, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; _v$3 = $f._v$3; _v$4 = $f._v$4; a = $f.a; b = $f.b; c = $f.c; data = $f.data; dups = $f.dups; hi = $f.hi; lo = $f.lo; m = $f.m; midhi = $f.midhi; midlo = $f.midlo; pivot = $f.pivot; protect = $f.protect; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		midlo = 0;
		midhi = 0;
		m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
		/* */ if ((hi - lo >> 0) > 40) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((hi - lo >> 0) > 40) { */ case 1:
			s = (_q$1 = ((hi - lo >> 0)) / 8, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			$r = medianOfThree(data, lo, lo + s >> 0, lo + ($imul(2, s)) >> 0); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, m, m - s >> 0, m + s >> 0); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = medianOfThree(data, hi - 1 >> 0, (hi - 1 >> 0) - s >> 0, (hi - 1 >> 0) - ($imul(2, s)) >> 0); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$r = medianOfThree(data, lo, m, hi - 1 >> 0); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		pivot = lo;
		_tmp = lo + 1 >> 0;
		_tmp$1 = hi - 1 >> 0;
		a = _tmp;
		c = _tmp$1;
		/* while (true) { */ case 7:
			if (!(a < c)) { _v = false; $s = 9; continue s; }
			_r = data.Less(a, pivot); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_v = _r; case 9:
			/* if (!(_v)) { break; } */ if(!(_v)) { $s = 8; continue; }
			a = a + (1) >> 0;
		/* } */ $s = 7; continue; case 8:
		b = a;
		/* while (true) { */ case 11:
			/* while (true) { */ case 13:
				if (!(b < c)) { _v$1 = false; $s = 15; continue s; }
				_r$1 = data.Less(pivot, b); /* */ $s = 16; case 16: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v$1 = !_r$1; case 15:
				/* if (!(_v$1)) { break; } */ if(!(_v$1)) { $s = 14; continue; }
				b = b + (1) >> 0;
			/* } */ $s = 13; continue; case 14:
			/* while (true) { */ case 17:
				if (!(b < c)) { _v$2 = false; $s = 19; continue s; }
				_r$2 = data.Less(pivot, c - 1 >> 0); /* */ $s = 20; case 20: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$2 = _r$2; case 19:
				/* if (!(_v$2)) { break; } */ if(!(_v$2)) { $s = 18; continue; }
				c = c - (1) >> 0;
			/* } */ $s = 17; continue; case 18:
			if (b >= c) {
				/* break; */ $s = 12; continue;
			}
			$r = data.Swap(b, c - 1 >> 0); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			b = b + (1) >> 0;
			c = c - (1) >> 0;
		/* } */ $s = 11; continue; case 12:
		protect = (hi - c >> 0) < 5;
		/* */ if (!protect && (hi - c >> 0) < (_q$2 = ((hi - lo >> 0)) / 4, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"))) { $s = 22; continue; }
		/* */ $s = 23; continue;
		/* if (!protect && (hi - c >> 0) < (_q$2 = ((hi - lo >> 0)) / 4, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"))) { */ case 22:
			dups = 0;
			_r$3 = data.Less(pivot, hi - 1 >> 0); /* */ $s = 26; case 26: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if (!_r$3) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (!_r$3) { */ case 24:
				$r = data.Swap(c, hi - 1 >> 0); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				c = c + (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 25:
			_r$4 = data.Less(b - 1 >> 0, pivot); /* */ $s = 30; case 30: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ if (!_r$4) { $s = 28; continue; }
			/* */ $s = 29; continue;
			/* if (!_r$4) { */ case 28:
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 29:
			_r$5 = data.Less(m, pivot); /* */ $s = 33; case 33: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			/* */ if (!_r$5) { $s = 31; continue; }
			/* */ $s = 32; continue;
			/* if (!_r$5) { */ case 31:
				$r = data.Swap(m, b - 1 >> 0); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = b - (1) >> 0;
				dups = dups + (1) >> 0;
			/* } */ case 32:
			protect = dups > 1;
		/* } */ case 23:
		/* */ if (protect) { $s = 35; continue; }
		/* */ $s = 36; continue;
		/* if (protect) { */ case 35:
			/* while (true) { */ case 37:
				/* while (true) { */ case 39:
					if (!(a < b)) { _v$3 = false; $s = 41; continue s; }
					_r$6 = data.Less(b - 1 >> 0, pivot); /* */ $s = 42; case 42: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_v$3 = !_r$6; case 41:
					/* if (!(_v$3)) { break; } */ if(!(_v$3)) { $s = 40; continue; }
					b = b - (1) >> 0;
				/* } */ $s = 39; continue; case 40:
				/* while (true) { */ case 43:
					if (!(a < b)) { _v$4 = false; $s = 45; continue s; }
					_r$7 = data.Less(a, pivot); /* */ $s = 46; case 46: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					_v$4 = _r$7; case 45:
					/* if (!(_v$4)) { break; } */ if(!(_v$4)) { $s = 44; continue; }
					a = a + (1) >> 0;
				/* } */ $s = 43; continue; case 44:
				if (a >= b) {
					/* break; */ $s = 38; continue;
				}
				$r = data.Swap(a, b - 1 >> 0); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = a + (1) >> 0;
				b = b - (1) >> 0;
			/* } */ $s = 37; continue; case 38:
		/* } */ case 36:
		$r = data.Swap(pivot, b - 1 >> 0); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_tmp$2 = b - 1 >> 0;
		_tmp$3 = c;
		midlo = _tmp$2;
		midhi = _tmp$3;
		$s = -1; return [midlo, midhi];
		return [midlo, midhi];
		/* */ } return; } if ($f === undefined) { $f = { $blk: doPivot }; } $f.$ptr = $ptr; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f._v$3 = _v$3; $f._v$4 = _v$4; $f.a = a; $f.b = b; $f.c = c; $f.data = data; $f.dups = dups; $f.hi = hi; $f.lo = lo; $f.m = m; $f.midhi = midhi; $f.midlo = midlo; $f.pivot = pivot; $f.protect = protect; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	quickSort = function(data, a, b, maxDepth) {
		var $ptr, _r, _r$1, _tuple, a, b, data, i, maxDepth, mhi, mlo, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; a = $f.a; b = $f.b; data = $f.data; i = $f.i; maxDepth = $f.maxDepth; mhi = $f.mhi; mlo = $f.mlo; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1:
			/* if (!((b - a >> 0) > 12)) { break; } */ if(!((b - a >> 0) > 12)) { $s = 2; continue; }
			/* */ if (maxDepth === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (maxDepth === 0) { */ case 3:
				$r = heapSort(data, a, b); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = -1; return;
				return;
			/* } */ case 4:
			maxDepth = maxDepth - (1) >> 0;
			_r = doPivot(data, a, b); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			mlo = _tuple[0];
			mhi = _tuple[1];
			/* */ if ((mlo - a >> 0) < (b - mhi >> 0)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((mlo - a >> 0) < (b - mhi >> 0)) { */ case 7:
				$r = quickSort(data, a, mlo, maxDepth); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				a = mhi;
				$s = 9; continue;
			/* } else { */ case 8:
				$r = quickSort(data, mhi, b, maxDepth); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				b = mlo;
			/* } */ case 9:
		/* } */ $s = 1; continue; case 2:
		/* */ if ((b - a >> 0) > 1) { $s = 12; continue; }
		/* */ $s = 13; continue;
		/* if ((b - a >> 0) > 1) { */ case 12:
			i = a + 6 >> 0;
			/* while (true) { */ case 14:
				/* if (!(i < b)) { break; } */ if(!(i < b)) { $s = 15; continue; }
				_r$1 = data.Less(i, i - 6 >> 0); /* */ $s = 18; case 18: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ if (_r$1) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (_r$1) { */ case 16:
					$r = data.Swap(i, i - 6 >> 0); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 17:
				i = i + (1) >> 0;
			/* } */ $s = 14; continue; case 15:
			$r = insertionSort(data, a, b); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 13:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: quickSort }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.a = a; $f.b = b; $f.data = data; $f.i = i; $f.maxDepth = maxDepth; $f.mhi = mhi; $f.mlo = mlo; $f.$s = $s; $f.$r = $r; return $f;
	};
	Sort = function(data) {
		var $ptr, _r, data, i, maxDepth, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; data = $f.data; i = $f.i; maxDepth = $f.maxDepth; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = data.Len(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		maxDepth = 0;
		i = n;
		while (true) {
			if (!(i > 0)) { break; }
			maxDepth = maxDepth + (1) >> 0;
			i = (i >> $min((1), 31)) >> 0;
		}
		maxDepth = $imul(maxDepth, (2));
		$r = quickSort(data, 0, n, maxDepth); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Sort }; } $f.$ptr = $ptr; $f._r = _r; $f.data = data; $f.i = i; $f.maxDepth = maxDepth; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sort = Sort;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, io, unicode, utf8;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["path/filepath"] = (function() {
	var $pkg = {}, $init, errors, os, runtime, sort, strings, utf8;
	errors = $packages["errors"];
	os = $packages["os"];
	runtime = $packages["runtime"];
	sort = $packages["sort"];
	strings = $packages["strings"];
	utf8 = $packages["unicode/utf8"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = os.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrBadPattern = errors.New("syntax error in pattern");
		$pkg.SkipDir = errors.New("skip this directory");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io/ioutil"] = (function() {
	var $pkg = {}, $init, bytes, io, os, filepath, sort, strconv, sync, time, sliceType, sliceType$1, ptrType, blackHolePool;
	bytes = $packages["bytes"];
	io = $packages["io"];
	os = $packages["os"];
	filepath = $packages["path/filepath"];
	sort = $packages["sort"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	time = $packages["time"];
	sliceType = $sliceType($emptyInterface);
	sliceType$1 = $sliceType($Uint8);
	ptrType = $ptrType(sliceType$1);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = os.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = filepath.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		blackHolePool = new sync.Pool.ptr(0, 0, sliceType.nil, (function() {
			var $ptr, b, b$24ptr;
			b = $makeSlice(sliceType$1, 8192);
			return (b$24ptr || (b$24ptr = new ptrType(function() { return b; }, function($v) { b = $subslice(new sliceType$1($v.$array), $v.$offset, $v.$offset + $v.$length); })));
		}));
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/tidwall/rbush"] = (function() {
	var $pkg = {}, $init, md5, fmt, ioutil, math, os, sort, strconv, strings, Node, RBush, byMinX, byMinY, ptrType, sliceType$1, sliceType$2, ptrType$1, New, calcBBox, distBBox, extend, bboxArea, bboxMargin, enlargedArea, intersectionArea, createNode, multiSelect, splice, ncopy, quickselect, sortNodes;
	md5 = $packages["crypto/md5"];
	fmt = $packages["fmt"];
	ioutil = $packages["io/ioutil"];
	math = $packages["math"];
	os = $packages["os"];
	sort = $packages["sort"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	Node = $pkg.Node = $newType(0, $kindStruct, "rbush.Node", true, "github.com/tidwall/rbush", true, function(MinX_, MinY_, MaxX_, MaxY_, Children_, Height_, Leaf_, Item_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MinX = 0;
			this.MinY = 0;
			this.MaxX = 0;
			this.MaxY = 0;
			this.Children = sliceType$1.nil;
			this.Height = 0;
			this.Leaf = false;
			this.Item = $ifaceNil;
			return;
		}
		this.MinX = MinX_;
		this.MinY = MinY_;
		this.MaxX = MaxX_;
		this.MaxY = MaxY_;
		this.Children = Children_;
		this.Height = Height_;
		this.Leaf = Leaf_;
		this.Item = Item_;
	});
	RBush = $pkg.RBush = $newType(0, $kindStruct, "rbush.RBush", true, "github.com/tidwall/rbush", true, function(MaxEntries_, MinEntries_, Data_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MaxEntries = 0;
			this.MinEntries = 0;
			this.Data = ptrType.nil;
			return;
		}
		this.MaxEntries = MaxEntries_;
		this.MinEntries = MinEntries_;
		this.Data = Data_;
	});
	byMinX = $pkg.byMinX = $newType(12, $kindSlice, "rbush.byMinX", true, "github.com/tidwall/rbush", false, null);
	byMinY = $pkg.byMinY = $newType(12, $kindSlice, "rbush.byMinY", true, "github.com/tidwall/rbush", false, null);
	ptrType = $ptrType(Node);
	sliceType$1 = $sliceType(ptrType);
	sliceType$2 = $sliceType($Int);
	ptrType$1 = $ptrType(RBush);
	byMinX.prototype.At = function(i) {
		var $ptr, arr, i;
		arr = this;
		return ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]);
	};
	$ptrType(byMinX).prototype.At = function(i) { return this.$get().At(i); };
	byMinX.prototype.Compare = function(a, b) {
		var $ptr, _tmp, _tmp$1, a, arr, b, na, nb;
		arr = this;
		_tmp = $assertType(a, ptrType);
		_tmp$1 = $assertType(b, ptrType);
		na = _tmp;
		nb = _tmp$1;
		if (na.MinX < nb.MinX) {
			return -1;
		}
		if (na.MinX > nb.MinX) {
			return 1;
		}
		return 0;
	};
	$ptrType(byMinX).prototype.Compare = function(a, b) { return this.$get().Compare(a, b); };
	byMinX.prototype.Less = function(i, j) {
		var $ptr, arr, i, j;
		arr = this;
		return ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]).MinX < ((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j]).MinX;
	};
	$ptrType(byMinX).prototype.Less = function(i, j) { return this.$get().Less(i, j); };
	byMinX.prototype.Swap = function(i, j) {
		var $ptr, _tmp, _tmp$1, arr, i, j;
		arr = this;
		_tmp = ((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j]);
		_tmp$1 = ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]);
		((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i] = _tmp);
		((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j] = _tmp$1);
	};
	$ptrType(byMinX).prototype.Swap = function(i, j) { return this.$get().Swap(i, j); };
	byMinX.prototype.Len = function() {
		var $ptr, arr;
		arr = this;
		return arr.$length;
	};
	$ptrType(byMinX).prototype.Len = function() { return this.$get().Len(); };
	byMinY.prototype.At = function(i) {
		var $ptr, arr, i;
		arr = this;
		return ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]);
	};
	$ptrType(byMinY).prototype.At = function(i) { return this.$get().At(i); };
	byMinY.prototype.Compare = function(a, b) {
		var $ptr, _tmp, _tmp$1, a, arr, b, na, nb;
		arr = this;
		_tmp = $assertType(a, ptrType);
		_tmp$1 = $assertType(b, ptrType);
		na = _tmp;
		nb = _tmp$1;
		if (na.MinY < nb.MinY) {
			return -1;
		}
		if (na.MinY > nb.MinY) {
			return 1;
		}
		return 0;
	};
	$ptrType(byMinY).prototype.Compare = function(a, b) { return this.$get().Compare(a, b); };
	byMinY.prototype.Less = function(i, j) {
		var $ptr, arr, i, j;
		arr = this;
		return ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]).MinY < ((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j]).MinY;
	};
	$ptrType(byMinY).prototype.Less = function(i, j) { return this.$get().Less(i, j); };
	byMinY.prototype.Swap = function(i, j) {
		var $ptr, _tmp, _tmp$1, arr, i, j;
		arr = this;
		_tmp = ((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j]);
		_tmp$1 = ((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i]);
		((i < 0 || i >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + i] = _tmp);
		((j < 0 || j >= arr.$length) ? $throwRuntimeError("index out of range") : arr.$array[arr.$offset + j] = _tmp$1);
	};
	$ptrType(byMinY).prototype.Swap = function(i, j) { return this.$get().Swap(i, j); };
	byMinY.prototype.Len = function() {
		var $ptr, arr;
		arr = this;
		return arr.$length;
	};
	$ptrType(byMinY).prototype.Len = function() { return this.$get().Len(); };
	New = function(maxEntries) {
		var $ptr, maxEntries, this$1;
		this$1 = new RBush.ptr(0, 0, ptrType.nil);
		if (maxEntries <= 0) {
			maxEntries = 9;
		}
		this$1.MaxEntries = (math.Max(4, maxEntries) >> 0);
		this$1.MinEntries = (math.Max(2, math.Ceil(this$1.MaxEntries * 0.4)) >> 0);
		this$1.clear();
		return this$1;
	};
	$pkg.New = New;
	RBush.ptr.prototype.Load = function(data) {
		var $ptr, _r, data, this$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; data = $f.data; this$1 = $f.this$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		_r = this$1.load(data); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype.Load }; } $f.$ptr = $ptr; $f._r = _r; $f.data = data; $f.this$1 = this$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype.Load = function(data) { return this.$val.Load(data); };
	RBush.ptr.prototype.load = function(data) {
		var $ptr, _r, _r$1, _tmp, _tmp$1, _tmp$2, _tmp$3, data, i, len_, node, this$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; data = $f.data; i = $f.i; len_ = $f.len_; node = $f.node; this$1 = $f.this$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		if (data.$length === 0) {
			$s = -1; return this$1;
			return this$1;
		}
		data = ncopy(data);
		/* */ if (data.$length < this$1.MinEntries) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (data.$length < this$1.MinEntries) { */ case 1:
			_tmp = 0;
			_tmp$1 = data.$length;
			i = _tmp;
			len_ = _tmp$1;
			/* while (true) { */ case 3:
				/* if (!(i < len_)) { break; } */ if(!(i < len_)) { $s = 4; continue; }
				_r = this$1.insert(((i < 0 || i >= data.$length) ? $throwRuntimeError("index out of range") : data.$array[data.$offset + i])); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_r;
				i = i + (1) >> 0;
			/* } */ $s = 3; continue; case 4:
			$s = -1; return this$1;
			return this$1;
		/* } */ case 2:
		_r$1 = this$1._build(data, 0, data.$length - 1 >> 0, 0); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		node = _r$1;
		/* */ if (this$1.Data.Children.$length === 0) { $s = 7; continue; }
		/* */ if (this$1.Data.Height === node.Height) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (this$1.Data.Children.$length === 0) { */ case 7:
			this$1.Data = node;
			$s = 10; continue;
		/* } else if (this$1.Data.Height === node.Height) { */ case 8:
			this$1._splitRoot(this$1.Data, node);
			$s = 10; continue;
		/* } else { */ case 9:
			if (this$1.Data.Height < node.Height) {
				_tmp$2 = node;
				_tmp$3 = this$1.Data;
				this$1.Data = _tmp$2;
				node = _tmp$3;
			}
			$r = this$1._insert(node, (this$1.Data.Height - node.Height >> 0) - 1 >> 0, true); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 10:
		$s = -1; return this$1;
		return this$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype.load }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.data = data; $f.i = i; $f.len_ = len_; $f.node = node; $f.this$1 = this$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype.load = function(data) { return this.$val.load(data); };
	RBush.ptr.prototype.insert = function(item) {
		var $ptr, item, this$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; item = $f.item; this$1 = $f.this$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		/* */ if (!(item === ptrType.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(item === ptrType.nil)) { */ case 1:
			$r = this$1._insert(item, this$1.Data.Height - 1 >> 0, false); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		$s = -1; return this$1;
		return this$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype.insert }; } $f.$ptr = $ptr; $f.item = item; $f.this$1 = this$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype.insert = function(item) { return this.$val.insert(item); };
	RBush.ptr.prototype.clear = function() {
		var $ptr, this$1;
		this$1 = this;
		this$1.Data = createNode(sliceType$1.nil);
		return this$1;
	};
	RBush.prototype.clear = function() { return this.$val.clear(); };
	RBush.ptr.prototype._build = function(items, left, right, height) {
		var $ptr, M, N, N1, N2, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, child, height, i, items, j, left, node, right, right2, right3, this$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; M = $f.M; N = $f.N; N1 = $f.N1; N2 = $f.N2; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; child = $f.child; height = $f.height; i = $f.i; items = $f.items; j = $f.j; left = $f.left; node = $f.node; right = $f.right; right2 = $f.right2; right3 = $f.right3; this$1 = $f.this$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		N = (right - left >> 0) + 1 >> 0;
		M = this$1.MaxEntries;
		node = ptrType.nil;
		if (N <= M) {
			node = createNode($subslice(items, left, (right + 1 >> 0)));
			calcBBox(node);
			$s = -1; return node;
			return node;
		}
		if (height === 0) {
			height = (math.Ceil(math.Log(N) / math.Log(M)) >> 0);
			M = (math.Ceil(N / math.Pow(M, height - 1)) >> 0);
		}
		node = createNode(sliceType$1.nil);
		node.Leaf = false;
		node.Height = height;
		N2 = (math.Ceil(N / M) >> 0);
		N1 = $imul(N2, (math.Ceil(math.Sqrt(M)) >> 0));
		_tmp = 0;
		_tmp$1 = 0;
		_tmp$2 = 0;
		_tmp$3 = 0;
		i = _tmp;
		j = _tmp$1;
		right2 = _tmp$2;
		right3 = _tmp$3;
		$r = multiSelect($subslice(new byMinX(items.$array), items.$offset, items.$offset + items.$length), left, right, N1); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		i = left;
		/* while (true) { */ case 2:
			/* if (!(i <= right)) { break; } */ if(!(i <= right)) { $s = 3; continue; }
			right2 = (math.Min(((i + N1 >> 0) - 1 >> 0), right) >> 0);
			$r = multiSelect($subslice(new byMinY(items.$array), items.$offset, items.$offset + items.$length), i, right2, N2); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			j = i;
			/* while (true) { */ case 5:
				/* if (!(j <= right2)) { break; } */ if(!(j <= right2)) { $s = 6; continue; }
				right3 = (math.Min(((j + N2 >> 0) - 1 >> 0), right2) >> 0);
				_r = this$1._build(items, j, right3, height - 1 >> 0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				child = _r;
				node.Children = $append(node.Children, child);
				j = j + (N2) >> 0;
			/* } */ $s = 5; continue; case 6:
			i = i + (N1) >> 0;
		/* } */ $s = 2; continue; case 3:
		calcBBox(node);
		$s = -1; return node;
		return node;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype._build }; } $f.$ptr = $ptr; $f.M = M; $f.N = N; $f.N1 = N1; $f.N2 = N2; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.child = child; $f.height = height; $f.i = i; $f.items = items; $f.j = j; $f.left = left; $f.node = node; $f.right = right; $f.right2 = right2; $f.right3 = right3; $f.this$1 = this$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype._build = function(items, left, right, height) { return this.$val._build(items, left, right, height); };
	RBush.ptr.prototype._chooseSubtree = function(bbox, node, level, path) {
		var $ptr, _i, _ref, _tmp, _tmp$1, _tmp$2, _tmp$3, area, bbox, child, enlargement, level, minArea, minEnlargement, node, path, targetNode, this$1, x;
		this$1 = this;
		targetNode = ptrType.nil;
		_tmp = 0;
		_tmp$1 = 0;
		_tmp$2 = 0;
		_tmp$3 = 0;
		area = _tmp;
		enlargement = _tmp$1;
		minArea = _tmp$2;
		minEnlargement = _tmp$3;
		while (true) {
			path = $append(path, node);
			if (node.Leaf || ((path.$length - 1 >> 0) === level)) {
				break;
			}
			minEnlargement = math.Inf(1);
			minArea = minEnlargement;
			_ref = node.Children;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				area = bboxArea(child);
				enlargement = enlargedArea(bbox, child) - area;
				if (enlargement < minEnlargement) {
					minEnlargement = enlargement;
					if (area < minArea) {
						minArea = area;
					}
					targetNode = child;
				} else if (enlargement === minEnlargement) {
					if (area < minArea) {
						minArea = area;
						targetNode = child;
					}
				}
				_i++;
			}
			if (!(targetNode === ptrType.nil)) {
				node = targetNode;
			} else if (node.Children.$length > 0) {
				node = (x = node.Children, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
			} else {
				node = ptrType.nil;
			}
		}
		return [node, path];
	};
	RBush.prototype._chooseSubtree = function(bbox, node, level, path) { return this.$val._chooseSubtree(bbox, node, level, path); };
	RBush.ptr.prototype._insert = function(item, level, isNode) {
		var $ptr, _r, _tuple, bbox, insertPath, isNode, item, level, node, this$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; bbox = $f.bbox; insertPath = $f.insertPath; isNode = $f.isNode; item = $f.item; level = $f.level; node = $f.node; this$1 = $f.this$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		bbox = item;
		insertPath = sliceType$1.nil;
		node = ptrType.nil;
		_tuple = this$1._chooseSubtree(bbox, this$1.Data, level, insertPath);
		node = _tuple[0];
		insertPath = _tuple[1];
		node.Children = $append(node.Children, item);
		extend(node, bbox);
		/* while (true) { */ case 1:
			/* if (!(level >= 0)) { break; } */ if(!(level >= 0)) { $s = 2; continue; }
			/* */ if (((level < 0 || level >= insertPath.$length) ? $throwRuntimeError("index out of range") : insertPath.$array[insertPath.$offset + level]).Children.$length > this$1.MaxEntries) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (((level < 0 || level >= insertPath.$length) ? $throwRuntimeError("index out of range") : insertPath.$array[insertPath.$offset + level]).Children.$length > this$1.MaxEntries) { */ case 3:
				_r = this$1._split(insertPath, level); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				insertPath = _r;
				level = level - (1) >> 0;
				$s = 5; continue;
			/* } else { */ case 4:
				/* break; */ $s = 2; continue;
			/* } */ case 5:
		/* } */ $s = 1; continue; case 2:
		this$1._adjustParentBBoxes(bbox, insertPath, level);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype._insert }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.bbox = bbox; $f.insertPath = insertPath; $f.isNode = isNode; $f.item = item; $f.level = level; $f.node = node; $f.this$1 = this$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype._insert = function(item, level, isNode) { return this.$val._insert(item, level, isNode); };
	RBush.ptr.prototype._split = function(insertPath, level) {
		var $ptr, M, _tuple, insertPath, level, m, newNode, node, spliced, splitIndex, this$1, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; M = $f.M; _tuple = $f._tuple; insertPath = $f.insertPath; level = $f.level; m = $f.m; newNode = $f.newNode; node = $f.node; spliced = $f.spliced; splitIndex = $f.splitIndex; this$1 = $f.this$1; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		node = ((level < 0 || level >= insertPath.$length) ? $throwRuntimeError("index out of range") : insertPath.$array[insertPath.$offset + level]);
		M = node.Children.$length;
		m = this$1.MinEntries;
		$r = this$1._chooseSplitAxis(node, m, M); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		splitIndex = this$1._chooseSplitIndex(node, m, M);
		spliced = sliceType$1.nil;
		_tuple = splice(node.Children, splitIndex, node.Children.$length - splitIndex >> 0, new sliceType$1([]));
		node.Children = _tuple[0];
		spliced = _tuple[1];
		newNode = createNode(spliced);
		newNode.Height = node.Height;
		newNode.Leaf = node.Leaf;
		calcBBox(node);
		calcBBox(newNode);
		if (!((level === 0))) {
			(x$1 = level - 1 >> 0, ((x$1 < 0 || x$1 >= insertPath.$length) ? $throwRuntimeError("index out of range") : insertPath.$array[insertPath.$offset + x$1])).Children = $append((x = level - 1 >> 0, ((x < 0 || x >= insertPath.$length) ? $throwRuntimeError("index out of range") : insertPath.$array[insertPath.$offset + x])).Children, newNode);
		} else {
			this$1._splitRoot(node, newNode);
		}
		$s = -1; return insertPath;
		return insertPath;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype._split }; } $f.$ptr = $ptr; $f.M = M; $f._tuple = _tuple; $f.insertPath = insertPath; $f.level = level; $f.m = m; $f.newNode = newNode; $f.node = node; $f.spliced = spliced; $f.splitIndex = splitIndex; $f.this$1 = this$1; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype._split = function(insertPath, level) { return this.$val._split(insertPath, level); };
	RBush.ptr.prototype._splitRoot = function(node, newNode) {
		var $ptr, newNode, node, this$1;
		this$1 = this;
		this$1.Data = createNode(new sliceType$1([node, newNode]));
		this$1.Data.Height = node.Height + 1 >> 0;
		this$1.Data.Leaf = false;
		calcBBox(this$1.Data);
	};
	RBush.prototype._splitRoot = function(node, newNode) { return this.$val._splitRoot(node, newNode); };
	RBush.ptr.prototype._chooseSplitIndex = function(node, m, M) {
		var $ptr, M, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, area, bbox1, bbox2, i, index, m, minArea, minOverlap, node, overlap, this$1;
		this$1 = this;
		i = 0;
		_tmp = ptrType.nil;
		_tmp$1 = ptrType.nil;
		bbox1 = _tmp;
		bbox2 = _tmp$1;
		_tmp$2 = 0;
		_tmp$3 = 0;
		_tmp$4 = 0;
		_tmp$5 = 0;
		overlap = _tmp$2;
		area = _tmp$3;
		minOverlap = _tmp$4;
		minArea = _tmp$5;
		index = 0;
		minArea = math.Inf(1);
		minOverlap = minArea;
		i = m;
		while (true) {
			if (!(i <= (M - m >> 0))) { break; }
			bbox1 = distBBox(node, 0, i, ptrType.nil);
			bbox2 = distBBox(node, i, M, ptrType.nil);
			overlap = intersectionArea(bbox1, bbox2);
			area = bboxArea(bbox1) + bboxArea(bbox2);
			if (overlap < minOverlap) {
				minOverlap = overlap;
				index = i;
				if (area < minArea) {
					minArea = area;
				}
			} else if (overlap === minOverlap) {
				if (area < minArea) {
					minArea = area;
					index = i;
				}
			}
			i = i + (1) >> 0;
		}
		return index;
	};
	RBush.prototype._chooseSplitIndex = function(node, m, M) { return this.$val._chooseSplitIndex(node, m, M); };
	RBush.ptr.prototype._chooseSplitAxis = function(node, m, M) {
		var $ptr, M, _r, _r$1, m, node, this$1, xMargin, yMargin, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; M = $f.M; _r = $f._r; _r$1 = $f._r$1; m = $f.m; node = $f.node; this$1 = $f.this$1; xMargin = $f.xMargin; yMargin = $f.yMargin; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		_r = this$1._allDistMargin(node, m, M, 1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		xMargin = _r;
		_r$1 = this$1._allDistMargin(node, m, M, 2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		yMargin = _r$1;
		/* */ if (xMargin < yMargin) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (xMargin < yMargin) { */ case 3:
			$r = sortNodes(node.Children, 1); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 4:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype._chooseSplitAxis }; } $f.$ptr = $ptr; $f.M = M; $f._r = _r; $f._r$1 = _r$1; $f.m = m; $f.node = node; $f.this$1 = this$1; $f.xMargin = xMargin; $f.yMargin = yMargin; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype._chooseSplitAxis = function(node, m, M) { return this.$val._chooseSplitAxis(node, m, M); };
	RBush.ptr.prototype._allDistMargin = function(node, m, M, dim) {
		var $ptr, M, child, dim, i, leftBBox, m, margin, node, rightBBox, this$1, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; M = $f.M; child = $f.child; dim = $f.dim; i = $f.i; leftBBox = $f.leftBBox; m = $f.m; margin = $f.margin; node = $f.node; rightBBox = $f.rightBBox; this$1 = $f.this$1; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		this$1 = this;
		$r = sortNodes(node.Children, dim); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		leftBBox = distBBox(node, 0, m, ptrType.nil);
		rightBBox = distBBox(node, M - m >> 0, M, ptrType.nil);
		margin = bboxMargin(leftBBox) + bboxMargin(rightBBox);
		i = 0;
		child = ptrType.nil;
		i = m;
		while (true) {
			if (!(i < (M - m >> 0))) { break; }
			child = (x = node.Children, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			extend(leftBBox, child);
			margin = margin + (bboxMargin(leftBBox));
			i = i + (1) >> 0;
		}
		i = (M - m >> 0) - 1 >> 0;
		while (true) {
			if (!(i >= m)) { break; }
			child = (x$1 = node.Children, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]));
			extend(rightBBox, child);
			margin = margin + (bboxMargin(rightBBox));
			i = i - (1) >> 0;
		}
		$s = -1; return margin;
		return margin;
		/* */ } return; } if ($f === undefined) { $f = { $blk: RBush.ptr.prototype._allDistMargin }; } $f.$ptr = $ptr; $f.M = M; $f.child = child; $f.dim = dim; $f.i = i; $f.leftBBox = leftBBox; $f.m = m; $f.margin = margin; $f.node = node; $f.rightBBox = rightBBox; $f.this$1 = this$1; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	RBush.prototype._allDistMargin = function(node, m, M, dim) { return this.$val._allDistMargin(node, m, M, dim); };
	RBush.ptr.prototype._adjustParentBBoxes = function(bbox, path, level) {
		var $ptr, bbox, i, level, path, this$1;
		this$1 = this;
		i = level;
		while (true) {
			if (!(i >= 0)) { break; }
			extend(((i < 0 || i >= path.$length) ? $throwRuntimeError("index out of range") : path.$array[path.$offset + i]), bbox);
			i = i - (1) >> 0;
		}
	};
	RBush.prototype._adjustParentBBoxes = function(bbox, path, level) { return this.$val._adjustParentBBoxes(bbox, path, level); };
	calcBBox = function(node) {
		var $ptr, node;
		distBBox(node, 0, node.Children.$length, node);
	};
	distBBox = function(node, k, p, destNode) {
		var $ptr, child, destNode, i, k, node, p, x;
		if (destNode === ptrType.nil) {
			destNode = createNode(sliceType$1.nil);
		}
		destNode.MinX = math.Inf(1);
		destNode.MinY = math.Inf(1);
		destNode.MaxX = math.Inf(-1);
		destNode.MaxY = math.Inf(-1);
		child = ptrType.nil;
		i = k;
		while (true) {
			if (!(i < p)) { break; }
			child = (x = node.Children, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			extend(destNode, child);
			i = i + (1) >> 0;
		}
		return destNode;
	};
	extend = function(a, b) {
		var $ptr, a, b;
		a.MinX = math.Min(a.MinX, b.MinX);
		a.MinY = math.Min(a.MinY, b.MinY);
		a.MaxX = math.Max(a.MaxX, b.MaxX);
		a.MaxY = math.Max(a.MaxY, b.MaxY);
		return a;
	};
	bboxArea = function(a) {
		var $ptr, a;
		return (a.MaxX - a.MinX) * (a.MaxY - a.MinY);
	};
	bboxMargin = function(a) {
		var $ptr, a;
		return (a.MaxX - a.MinX) + (a.MaxY - a.MinY);
	};
	enlargedArea = function(a, b) {
		var $ptr, a, b;
		return (math.Max(b.MaxX, a.MaxX) - math.Min(b.MinX, a.MinX)) * (math.Max(b.MaxY, a.MaxY) - math.Min(b.MinY, a.MinY));
	};
	intersectionArea = function(a, b) {
		var $ptr, a, b, maxX, maxY, minX, minY;
		minX = math.Max(a.MinX, b.MinX);
		minY = math.Max(a.MinY, b.MinY);
		maxX = math.Min(a.MaxX, b.MaxX);
		maxY = math.Min(a.MaxY, b.MaxY);
		return math.Max(0, maxX - minX) * math.Max(0, maxY - minY);
	};
	createNode = function(children) {
		var $ptr, children;
		return new Node.ptr(math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1), children, 1, true, $ifaceNil);
	};
	multiSelect = function(arr, left, right, n) {
		var $ptr, arr, left, mid, n, right, stack, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; arr = $f.arr; left = $f.left; mid = $f.mid; n = $f.n; right = $f.right; stack = $f.stack; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		stack = new sliceType$2([left, right]);
		mid = 0;
		/* while (true) { */ case 1:
			/* if (!(stack.$length > 0)) { break; } */ if(!(stack.$length > 0)) { $s = 2; continue; }
			right = (x = stack.$length - 1 >> 0, ((x < 0 || x >= stack.$length) ? $throwRuntimeError("index out of range") : stack.$array[stack.$offset + x]));
			stack = $subslice(stack, 0, (stack.$length - 1 >> 0));
			left = (x$1 = stack.$length - 1 >> 0, ((x$1 < 0 || x$1 >= stack.$length) ? $throwRuntimeError("index out of range") : stack.$array[stack.$offset + x$1]));
			stack = $subslice(stack, 0, (stack.$length - 1 >> 0));
			/* */ if ((right - left >> 0) <= n) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if ((right - left >> 0) <= n) { */ case 3:
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			mid = left + ($imul((math.Ceil((right - left >> 0) / n / 2) >> 0), n)) >> 0;
			$r = quickselect(arr, mid, left, right); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			stack = $append(stack, left, mid, mid, right);
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: multiSelect }; } $f.$ptr = $ptr; $f.arr = arr; $f.left = left; $f.mid = mid; $f.n = n; $f.right = right; $f.stack = stack; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	splice = function(nodes, start, deleteCount, args) {
		var $ptr, args, deleteCount, deleted, nodes, result, start;
		result = sliceType$1.nil;
		deleted = sliceType$1.nil;
		if (start > nodes.$length) {
			start = nodes.$length;
		}
		if ((start + deleteCount >> 0) > nodes.$length) {
			deleteCount = nodes.$length - start >> 0;
		}
		deleted = $subslice(nodes, start, (start + deleteCount >> 0));
		result = $appendSlice(ncopy($subslice(nodes, 0, start)), args);
		result = $appendSlice(result, $subslice(nodes, (start + deleteCount >> 0)));
		return [result, deleted];
	};
	ncopy = function(nodes) {
		var $ptr, nodes;
		return $appendSlice(sliceType$1.nil, nodes);
	};
	quickselect = function(arr, k, left, right) {
		var $ptr, _q, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, arr, i, j, k, left, m, n, newLeft, newRight, right, s, sd, t, tt, z, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; arr = $f.arr; i = $f.i; j = $f.j; k = $f.k; left = $f.left; m = $f.m; n = $f.n; newLeft = $f.newLeft; newRight = $f.newRight; right = $f.right; s = $f.s; sd = $f.sd; t = $f.t; tt = $f.tt; z = $f.z; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* while (true) { */ case 1:
			/* if (!(right > left)) { break; } */ if(!(right > left)) { $s = 2; continue; }
			/* */ if ((right - left >> 0) > 600) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if ((right - left >> 0) > 600) { */ case 3:
				n = (right - left >> 0) + 1 >> 0;
				m = (k - left >> 0) + 1 >> 0;
				z = math.Log(n);
				s = 0.5 * math.Exp(2 * z / 3);
				tt = 1;
				if ((m - (_q = n / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0) < 0) {
					tt = -1;
				}
				sd = 0.5 * math.Sqrt(z * s * (n - s) / n) * tt;
				newLeft = (math.Max(left, math.Floor(k - m * s / n + sd)) >> 0);
				newRight = (math.Min(right, math.Floor(k + (n - m >> 0) * s / n + sd)) >> 0);
				$r = quickselect(arr, k, newLeft, newRight); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
			_r = arr.At(k); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			t = _r;
			i = left;
			j = right;
			$r = arr.Swap(left, k); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_r$1 = arr.At(right); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = arr.Compare(_r$1, t); /* */ $s = 11; case 11: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ if (_r$2 > 0) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (_r$2 > 0) { */ case 8:
				$r = arr.Swap(left, right); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 9:
			/* while (true) { */ case 13:
				/* if (!(i < j)) { break; } */ if(!(i < j)) { $s = 14; continue; }
				$r = arr.Swap(i, j); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i = i + (1) >> 0;
				j = j - (1) >> 0;
				/* while (true) { */ case 16:
					_r$3 = arr.At(i); /* */ $s = 18; case 18: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_r$4 = arr.Compare(_r$3, t); /* */ $s = 19; case 19: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* if (!(_r$4 < 0)) { break; } */ if(!(_r$4 < 0)) { $s = 17; continue; }
					i = i + (1) >> 0;
				/* } */ $s = 16; continue; case 17:
				/* while (true) { */ case 20:
					_r$5 = arr.At(j); /* */ $s = 22; case 22: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_r$6 = arr.Compare(_r$5, t); /* */ $s = 23; case 23: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					/* if (!(_r$6 > 0)) { break; } */ if(!(_r$6 > 0)) { $s = 21; continue; }
					j = j - (1) >> 0;
				/* } */ $s = 20; continue; case 21:
			/* } */ $s = 13; continue; case 14:
			_r$7 = arr.At(left); /* */ $s = 27; case 27: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
			_r$8 = arr.Compare(_r$7, t); /* */ $s = 28; case 28: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
			/* */ if (_r$8 === 0) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (_r$8 === 0) { */ case 24:
				$r = arr.Swap(left, j); /* */ $s = 29; case 29: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 26; continue;
			/* } else { */ case 25:
				j = j + (1) >> 0;
				$r = arr.Swap(j, right); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 26:
			if (j <= k) {
				left = j + 1 >> 0;
			}
			if (k <= j) {
				right = j - 1 >> 0;
			}
		/* } */ $s = 1; continue; case 2:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: quickselect }; } $f.$ptr = $ptr; $f._q = _q; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f.arr = arr; $f.i = i; $f.j = j; $f.k = k; $f.left = left; $f.m = m; $f.n = n; $f.newLeft = newLeft; $f.newRight = newRight; $f.right = right; $f.s = s; $f.sd = sd; $f.t = t; $f.tt = tt; $f.z = z; $f.$s = $s; $f.$r = $r; return $f;
	};
	sortNodes = function(nodes, dim) {
		var $ptr, _1, dim, nodes, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; dim = $f.dim; nodes = $f.nodes; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_1 = dim;
			/* */ if (_1 === (1)) { $s = 2; continue; }
			/* */ if (_1 === (2)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_1 === (1)) { */ case 2:
				$r = sort.Sort($subslice(new byMinX(nodes.$array), nodes.$offset, nodes.$offset + nodes.$length)); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 5; continue;
			/* } else if (_1 === (2)) { */ case 3:
				$r = sort.Sort($subslice(new byMinY(nodes.$array), nodes.$offset, nodes.$offset + nodes.$length)); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 5; continue;
			/* } else { */ case 4:
				$panic(new $String("invalid dimension"));
			/* } */ case 5:
		case 1:
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: sortNodes }; } $f.$ptr = $ptr; $f._1 = _1; $f.dim = dim; $f.nodes = nodes; $f.$s = $s; $f.$r = $r; return $f;
	};
	ptrType$1.methods = [{prop: "all", name: "all", pkg: "github.com/tidwall/rbush", typ: $funcType([], [sliceType$1], false)}, {prop: "search", name: "search", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType], [sliceType$1], false)}, {prop: "collides", name: "collides", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType], [$Bool], false)}, {prop: "Load", name: "Load", pkg: "", typ: $funcType([sliceType$1], [], false)}, {prop: "load", name: "load", pkg: "github.com/tidwall/rbush", typ: $funcType([sliceType$1], [ptrType$1], false)}, {prop: "insert", name: "insert", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType], [ptrType$1], false)}, {prop: "clear", name: "clear", pkg: "github.com/tidwall/rbush", typ: $funcType([], [ptrType$1], false)}, {prop: "remove", name: "remove", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType], [ptrType$1], false)}, {prop: "toJSON", name: "toJSON", pkg: "github.com/tidwall/rbush", typ: $funcType([], [ptrType], false)}, {prop: "fromJSON", name: "fromJSON", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType], [ptrType$1], false)}, {prop: "_all", name: "_all", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, sliceType$1], [sliceType$1], false)}, {prop: "_build", name: "_build", pkg: "github.com/tidwall/rbush", typ: $funcType([sliceType$1, $Int, $Int, $Int], [ptrType], false)}, {prop: "_chooseSubtree", name: "_chooseSubtree", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, ptrType, $Int, sliceType$1], [ptrType, sliceType$1], false)}, {prop: "_insert", name: "_insert", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, $Int, $Bool], [], false)}, {prop: "_split", name: "_split", pkg: "github.com/tidwall/rbush", typ: $funcType([sliceType$1, $Int], [sliceType$1], false)}, {prop: "_splitRoot", name: "_splitRoot", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, ptrType], [], false)}, {prop: "_chooseSplitIndex", name: "_chooseSplitIndex", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, $Int, $Int], [$Int], false)}, {prop: "_chooseSplitAxis", name: "_chooseSplitAxis", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, $Int, $Int], [], false)}, {prop: "_allDistMargin", name: "_allDistMargin", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, $Int, $Int, $Int], [$Float64], false)}, {prop: "_adjustParentBBoxes", name: "_adjustParentBBoxes", pkg: "github.com/tidwall/rbush", typ: $funcType([ptrType, sliceType$1, $Int], [], false)}, {prop: "_condense", name: "_condense", pkg: "github.com/tidwall/rbush", typ: $funcType([sliceType$1], [], false)}, {prop: "jsonString", name: "jsonString", pkg: "github.com/tidwall/rbush", typ: $funcType([], [$String], false)}];
	byMinX.methods = [{prop: "At", name: "At", pkg: "", typ: $funcType([$Int], [$emptyInterface], false)}, {prop: "Compare", name: "Compare", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [$Int], false)}, {prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}];
	byMinY.methods = [{prop: "At", name: "At", pkg: "", typ: $funcType([$Int], [$emptyInterface], false)}, {prop: "Compare", name: "Compare", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [$Int], false)}, {prop: "Less", name: "Less", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Swap", name: "Swap", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}];
	Node.init("", [{prop: "MinX", name: "MinX", exported: true, typ: $Float64, tag: ""}, {prop: "MinY", name: "MinY", exported: true, typ: $Float64, tag: ""}, {prop: "MaxX", name: "MaxX", exported: true, typ: $Float64, tag: ""}, {prop: "MaxY", name: "MaxY", exported: true, typ: $Float64, tag: ""}, {prop: "Children", name: "Children", exported: true, typ: sliceType$1, tag: ""}, {prop: "Height", name: "Height", exported: true, typ: $Int, tag: ""}, {prop: "Leaf", name: "Leaf", exported: true, typ: $Bool, tag: ""}, {prop: "Item", name: "Item", exported: true, typ: $emptyInterface, tag: ""}]);
	RBush.init("", [{prop: "MaxEntries", name: "MaxEntries", exported: true, typ: $Int, tag: ""}, {prop: "MinEntries", name: "MinEntries", exported: true, typ: $Int, tag: ""}, {prop: "Data", name: "Data", exported: true, typ: ptrType, tag: ""}]);
	byMinX.init(ptrType);
	byMinY.init(ptrType);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = md5.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = fmt.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ioutil.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = os.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math/rand"] = (function() {
	var $pkg = {}, $init, nosync, math, Source, Rand, lockedSource, rngSource, arrayType, ptrType, ptrType$1, sliceType, ptrType$2, ptrType$3, sliceType$1, ptrType$5, ke, we, fe, kn, wn, fn, globalRand, rng_cooked, absInt32, NewSource, New, read, Seed, Float64, seedrand;
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	math = $packages["math"];
	Source = $pkg.Source = $newType(8, $kindInterface, "rand.Source", true, "math/rand", true, null);
	Rand = $pkg.Rand = $newType(0, $kindStruct, "rand.Rand", true, "math/rand", true, function(src_, readVal_, readPos_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.src = $ifaceNil;
			this.readVal = new $Int64(0, 0);
			this.readPos = 0;
			return;
		}
		this.src = src_;
		this.readVal = readVal_;
		this.readPos = readPos_;
	});
	lockedSource = $pkg.lockedSource = $newType(0, $kindStruct, "rand.lockedSource", true, "math/rand", false, function(lk_, src_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lk = new nosync.Mutex.ptr(false);
			this.src = $ifaceNil;
			return;
		}
		this.lk = lk_;
		this.src = src_;
	});
	rngSource = $pkg.rngSource = $newType(0, $kindStruct, "rand.rngSource", true, "math/rand", false, function(tap_, feed_, vec_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.tap = 0;
			this.feed = 0;
			this.vec = arrayType.zero();
			return;
		}
		this.tap = tap_;
		this.feed = feed_;
		this.vec = vec_;
	});
	arrayType = $arrayType($Int64, 607);
	ptrType = $ptrType(lockedSource);
	ptrType$1 = $ptrType($Int8);
	sliceType = $sliceType($Int);
	ptrType$2 = $ptrType($Int64);
	ptrType$3 = $ptrType(Rand);
	sliceType$1 = $sliceType($Uint8);
	ptrType$5 = $ptrType(rngSource);
	Rand.ptr.prototype.ExpFloat64 = function() {
		var $ptr, _r, _r$1, _r$2, _r$3, i, j, r, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; i = $f.i; j = $f.j; r = $f.r; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* while (true) { */ case 1:
			_r = r.Uint32(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = _r;
			i = (j & 255) >>> 0;
			x = j * ((i < 0 || i >= we.length) ? $throwRuntimeError("index out of range") : we[i]);
			if (j < ((i < 0 || i >= ke.length) ? $throwRuntimeError("index out of range") : ke[i])) {
				$s = -1; return x;
				return x;
			}
			/* */ if (i === 0) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (i === 0) { */ case 4:
				_r$1 = r.Float64(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = math.Log(_r$1); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$s = -1; return 7.69711747013105 - _r$2;
				return 7.69711747013105 - _r$2;
			/* } */ case 5:
			_r$3 = r.Float64(); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ if ($fround(((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i]) + $fround($fround(_r$3) * ($fround((x$1 = i - 1 >>> 0, ((x$1 < 0 || x$1 >= fe.length) ? $throwRuntimeError("index out of range") : fe[x$1])) - ((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i]))))) < $fround(math.Exp(-x))) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if ($fround(((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i]) + $fround($fround(_r$3) * ($fround((x$1 = i - 1 >>> 0, ((x$1 < 0 || x$1 >= fe.length) ? $throwRuntimeError("index out of range") : fe[x$1])) - ((i < 0 || i >= fe.length) ? $throwRuntimeError("index out of range") : fe[i]))))) < $fround(math.Exp(-x))) { */ case 8:
				$s = -1; return x;
				return x;
			/* } */ case 9:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return 0;
		return 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.ExpFloat64 }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f.i = i; $f.j = j; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.ExpFloat64 = function() { return this.$val.ExpFloat64(); };
	absInt32 = function(i) {
		var $ptr, i;
		if (i < 0) {
			return (-i >>> 0);
		}
		return (i >>> 0);
	};
	Rand.ptr.prototype.NormFloat64 = function() {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, i, j, r, x, x$1, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; i = $f.i; j = $f.j; r = $f.r; x = $f.x; x$1 = $f.x$1; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* while (true) { */ case 1:
			_r = r.Uint32(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = (_r >> 0);
			i = j & 127;
			x = j * ((i < 0 || i >= wn.length) ? $throwRuntimeError("index out of range") : wn[i]);
			if (absInt32(j) < ((i < 0 || i >= kn.length) ? $throwRuntimeError("index out of range") : kn[i])) {
				$s = -1; return x;
				return x;
			}
			/* */ if (i === 0) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (i === 0) { */ case 4:
				/* while (true) { */ case 6:
					_r$1 = r.Float64(); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = math.Log(_r$1); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					x = -_r$2 * 0.29047645161474317;
					_r$3 = r.Float64(); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_r$4 = math.Log(_r$3); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					y = -_r$4;
					if (y + y >= x * x) {
						/* break; */ $s = 7; continue;
					}
				/* } */ $s = 6; continue; case 7:
				if (j > 0) {
					$s = -1; return 3.442619855899 + x;
					return 3.442619855899 + x;
				}
				$s = -1; return -3.442619855899 - x;
				return -3.442619855899 - x;
			/* } */ case 5:
			_r$5 = r.Float64(); /* */ $s = 14; case 14: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			/* */ if ($fround(((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i]) + $fround($fround(_r$5) * ($fround((x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= fn.length) ? $throwRuntimeError("index out of range") : fn[x$1])) - ((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i]))))) < $fround(math.Exp(-0.5 * x * x))) { $s = 12; continue; }
			/* */ $s = 13; continue;
			/* if ($fround(((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i]) + $fround($fround(_r$5) * ($fround((x$1 = i - 1 >> 0, ((x$1 < 0 || x$1 >= fn.length) ? $throwRuntimeError("index out of range") : fn[x$1])) - ((i < 0 || i >= fn.length) ? $throwRuntimeError("index out of range") : fn[i]))))) < $fround(math.Exp(-0.5 * x * x))) { */ case 12:
				$s = -1; return x;
				return x;
			/* } */ case 13:
		/* } */ $s = 1; continue; case 2:
		$s = -1; return 0;
		return 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.NormFloat64 }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f.i = i; $f.j = j; $f.r = r; $f.x = x; $f.x$1 = x$1; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.NormFloat64 = function() { return this.$val.NormFloat64(); };
	NewSource = function(seed) {
		var $ptr, rng, seed;
		rng = new rngSource.ptr(0, 0, arrayType.zero());
		rng.Seed(seed);
		return rng;
	};
	$pkg.NewSource = NewSource;
	New = function(src) {
		var $ptr, src;
		return new Rand.ptr(src, new $Int64(0, 0), 0);
	};
	$pkg.New = New;
	Rand.ptr.prototype.Seed = function(seed) {
		var $ptr, _tuple, lk, ok, r, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tuple = $f._tuple; lk = $f.lk; ok = $f.ok; r = $f.r; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_tuple = $assertType(r.src, ptrType, true);
		lk = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			$r = lk.seedPos(seed, (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
			return;
		/* } */ case 2:
		$r = r.src.Seed(seed); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r.readPos = 0;
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Seed }; } $f.$ptr = $ptr; $f._tuple = _tuple; $f.lk = lk; $f.ok = ok; $f.r = r; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	Rand.ptr.prototype.Int63 = function() {
		var $ptr, _r, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.src.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int63 }; } $f.$ptr = $ptr; $f._r = _r; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int63 = function() { return this.$val.Int63(); };
	Rand.ptr.prototype.Uint32 = function() {
		var $ptr, _r, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return ($shiftRightInt64(_r, 31).$low >>> 0);
		return ($shiftRightInt64(_r, 31).$low >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Uint32 }; } $f.$ptr = $ptr; $f._r = _r; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Uint32 = function() { return this.$val.Uint32(); };
	Rand.ptr.prototype.Int31 = function() {
		var $ptr, _r, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return ((x = $shiftRightInt64(_r, 32), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		return ((x = $shiftRightInt64(_r, 32), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int31 }; } $f.$ptr = $ptr; $f._r = _r; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int31 = function() { return this.$val.Int31(); };
	Rand.ptr.prototype.Int = function() {
		var $ptr, _r, r, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; r = $f.r; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		_r = r.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		u = (_r.$low >>> 0);
		$s = -1; return (((u << 1 >>> 0) >>> 1 >>> 0) >> 0);
		return (((u << 1 >>> 0) >>> 1 >>> 0) >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int }; } $f.$ptr = $ptr; $f._r = _r; $f.r = r; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int = function() { return this.$val.Int(); };
	Rand.ptr.prototype.Int63n = function(n) {
		var $ptr, _r, _r$1, _r$2, max, n, r, v, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; max = $f.max; n = $f.n; r = $f.r; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if ((n.$high < 0 || (n.$high === 0 && n.$low <= 0))) {
			$panic(new $String("invalid argument to Int63n"));
		}
		/* */ if ((x = (x$1 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(n.$high & x$1.$high, (n.$low & x$1.$low) >>> 0)), (x.$high === 0 && x.$low === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((x = (x$1 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(n.$high & x$1.$high, (n.$low & x$1.$low) >>> 0)), (x.$high === 0 && x.$low === 0))) { */ case 1:
			_r = r.Int63(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return (x$2 = _r, x$3 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
			return (x$2 = _r, x$3 = new $Int64(n.$high - 0, n.$low - 1), new $Int64(x$2.$high & x$3.$high, (x$2.$low & x$3.$low) >>> 0));
		/* } */ case 2:
		max = (x$4 = (x$5 = $div64(new $Uint64(2147483648, 0), new $Uint64(n.$high, n.$low), true), new $Uint64(2147483647 - x$5.$high, 4294967295 - x$5.$low)), new $Int64(x$4.$high, x$4.$low));
		_r$1 = r.Int63(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		v = _r$1;
		/* while (true) { */ case 5:
			/* if (!((v.$high > max.$high || (v.$high === max.$high && v.$low > max.$low)))) { break; } */ if(!((v.$high > max.$high || (v.$high === max.$high && v.$low > max.$low)))) { $s = 6; continue; }
			_r$2 = r.Int63(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			v = _r$2;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return $div64(v, n, true);
		return $div64(v, n, true);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int63n }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.max = max; $f.n = n; $f.r = r; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int63n = function(n) { return this.$val.Int63n(n); };
	Rand.ptr.prototype.Int31n = function(n) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, max, n, r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; max = $f.max; n = $f.n; r = $f.r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Int31n"));
		}
		/* */ if ((n & ((n - 1 >> 0))) === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((n & ((n - 1 >> 0))) === 0) { */ case 1:
			_r = r.Int31(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return _r & ((n - 1 >> 0));
			return _r & ((n - 1 >> 0));
		/* } */ case 2:
		max = ((2147483647 - (_r$1 = 2147483648 % (n >>> 0), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) >>> 0) >> 0);
		_r$2 = r.Int31(); /* */ $s = 4; case 4: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		v = _r$2;
		/* while (true) { */ case 5:
			/* if (!(v > max)) { break; } */ if(!(v > max)) { $s = 6; continue; }
			_r$3 = r.Int31(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
		/* } */ $s = 5; continue; case 6:
		$s = -1; return (_r$4 = v % n, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		return (_r$4 = v % n, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Int31n }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.max = max; $f.n = n; $f.r = r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Int31n = function(n) { return this.$val.Int31n(n); };
	Rand.ptr.prototype.Intn = function(n) {
		var $ptr, _r, _r$1, n, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; n = $f.n; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		if (n <= 0) {
			$panic(new $String("invalid argument to Intn"));
		}
		/* */ if (n <= 2147483647) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (n <= 2147483647) { */ case 1:
			_r = r.Int31n((n >> 0)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			$s = -1; return (_r >> 0);
			return (_r >> 0);
		/* } */ case 2:
		_r$1 = r.Int63n(new $Int64(0, n)); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		$s = -1; return ((x = _r$1, x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		return ((x = _r$1, x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Intn }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.n = n; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Intn = function(n) { return this.$val.Intn(n); };
	Rand.ptr.prototype.Float64 = function() {
		var $ptr, _r, f, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* again: */ case 1:
		_r = r.Int63(); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		f = $flatten64(_r) / 9.223372036854776e+18;
		/* */ if (f === 1) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (f === 1) { */ case 3:
			/* goto again */ $s = 1; continue;
		/* } */ case 4:
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Float64 }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Float64 = function() { return this.$val.Float64(); };
	Rand.ptr.prototype.Float32 = function() {
		var $ptr, _r, f, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		/* again: */ case 1:
		_r = r.Float64(); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		f = $fround(_r);
		/* */ if (f === 1) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (f === 1) { */ case 3:
			/* goto again */ $s = 1; continue;
		/* } */ case 4:
		$s = -1; return f;
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Float32 }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Float32 = function() { return this.$val.Float32(); };
	Rand.ptr.prototype.Perm = function(n) {
		var $ptr, _r, i, j, m, n, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; j = $f.j; m = $f.m; n = $f.n; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		m = $makeSlice(sliceType, n);
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_r = r.Intn(i + 1 >> 0); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			j = _r;
			((i < 0 || i >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + i] = ((j < 0 || j >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + j]));
			((j < 0 || j >= m.$length) ? $throwRuntimeError("index out of range") : m.$array[m.$offset + j] = i);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$s = -1; return m;
		return m;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Perm }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.j = j; $f.m = m; $f.n = n; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Perm = function(n) { return this.$val.Perm(n); };
	Rand.ptr.prototype.Read = function(p) {
		var $ptr, _r, _r$1, _tuple, _tuple$1, _tuple$2, err, lk, n, ok, p, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; err = $f.err; lk = $f.lk; n = $f.n; ok = $f.ok; p = $f.p; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		_tuple = $assertType(r.src, ptrType, true);
		lk = _tuple[0];
		ok = _tuple[1];
		/* */ if (ok) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (ok) { */ case 1:
			_r = lk.read(p, (r.$ptr_readVal || (r.$ptr_readVal = new ptrType$2(function() { return this.$target.readVal; }, function($v) { this.$target.readVal = $v; }, r))), (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple$1 = _r;
			n = _tuple$1[0];
			err = _tuple$1[1];
			$s = -1; return [n, err];
			return [n, err];
		/* } */ case 2:
		_r$1 = read(p, $methodVal(r, "Int63"), (r.$ptr_readVal || (r.$ptr_readVal = new ptrType$2(function() { return this.$target.readVal; }, function($v) { this.$target.readVal = $v; }, r))), (r.$ptr_readPos || (r.$ptr_readPos = new ptrType$1(function() { return this.$target.readPos; }, function($v) { this.$target.readPos = $v; }, r)))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$2 = _r$1;
		n = _tuple$2[0];
		err = _tuple$2[1];
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Rand.ptr.prototype.Read }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.err = err; $f.lk = lk; $f.n = n; $f.ok = ok; $f.p = p; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	Rand.prototype.Read = function(p) { return this.$val.Read(p); };
	read = function(p, int63, readVal, readPos) {
		var $ptr, _r, err, int63, n, p, pos, readPos, readVal, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; int63 = $f.int63; n = $f.n; p = $f.p; pos = $f.pos; readPos = $f.readPos; readVal = $f.readVal; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		pos = readPos.$get();
		val = readVal.$get();
		n = 0;
		/* while (true) { */ case 1:
			/* if (!(n < p.$length)) { break; } */ if(!(n < p.$length)) { $s = 2; continue; }
			/* */ if (pos === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (pos === 0) { */ case 3:
				_r = int63(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				val = _r;
				pos = 7;
			/* } */ case 4:
			((n < 0 || n >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + n] = (val.$low << 24 >>> 24));
			val = $shiftRightInt64(val, (8));
			pos = pos - (1) << 24 >> 24;
			n = n + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		readPos.$set(pos);
		readVal.$set(val);
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: read }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.int63 = int63; $f.n = n; $f.p = p; $f.pos = pos; $f.readPos = readPos; $f.readVal = readVal; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Seed = function(seed) {
		var $ptr, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = globalRand.Seed(seed); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Seed }; } $f.$ptr = $ptr; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Seed = Seed;
	Float64 = function() {
		var $ptr, _r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = globalRand.Float64(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		$s = -1; return _r;
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Float64 }; } $f.$ptr = $ptr; $f._r = _r; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Float64 = Float64;
	lockedSource.ptr.prototype.Int63 = function() {
		var $ptr, _r, n, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		r = this;
		r.lk.Lock();
		_r = r.src.Int63(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n = _r;
		r.lk.Unlock();
		$s = -1; return n;
		return n;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.Int63 }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.Int63 = function() { return this.$val.Int63(); };
	lockedSource.ptr.prototype.Seed = function(seed) {
		var $ptr, r, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		r.lk.Lock();
		$r = r.src.Seed(seed); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r.lk.Unlock();
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.Seed }; } $f.$ptr = $ptr; $f.r = r; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	lockedSource.ptr.prototype.seedPos = function(seed, readPos) {
		var $ptr, r, readPos, seed, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; readPos = $f.readPos; seed = $f.seed; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		r.lk.Lock();
		$r = r.src.Seed(seed); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		readPos.$set(0);
		r.lk.Unlock();
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.seedPos }; } $f.$ptr = $ptr; $f.r = r; $f.readPos = readPos; $f.seed = seed; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.seedPos = function(seed, readPos) { return this.$val.seedPos(seed, readPos); };
	lockedSource.ptr.prototype.read = function(p, readVal, readPos) {
		var $ptr, _r, _tuple, err, n, p, r, readPos, readVal, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; err = $f.err; n = $f.n; p = $f.p; r = $f.r; readPos = $f.readPos; readVal = $f.readVal; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = 0;
		err = $ifaceNil;
		r = this;
		r.lk.Lock();
		_r = read(p, $methodVal(r.src, "Int63"), readVal, readPos); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		n = _tuple[0];
		err = _tuple[1];
		r.lk.Unlock();
		$s = -1; return [n, err];
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: lockedSource.ptr.prototype.read }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.err = err; $f.n = n; $f.p = p; $f.r = r; $f.readPos = readPos; $f.readVal = readVal; $f.$s = $s; $f.$r = $r; return $f;
	};
	lockedSource.prototype.read = function(p, readVal, readPos) { return this.$val.read(p, readVal, readPos); };
	seedrand = function(x) {
		var $ptr, _q, _r, hi, lo, x;
		hi = (_q = x / 44488, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		lo = (_r = x % 44488, _r === _r ? _r : $throwRuntimeError("integer divide by zero"));
		x = ($imul(48271, lo)) - ($imul(3399, hi)) >> 0;
		if (x < 0) {
			x = x + (2147483647) >> 0;
		}
		return x;
	};
	rngSource.ptr.prototype.Seed = function(seed) {
		var $ptr, i, rng, seed, u, x, x$1, x$2, x$3, x$4, x$5;
		rng = this;
		rng.tap = 0;
		rng.feed = 334;
		seed = $div64(seed, new $Int64(0, 2147483647), true);
		if ((seed.$high < 0 || (seed.$high === 0 && seed.$low < 0))) {
			seed = (x = new $Int64(0, 2147483647), new $Int64(seed.$high + x.$high, seed.$low + x.$low));
		}
		if ((seed.$high === 0 && seed.$low === 0)) {
			seed = new $Int64(0, 89482311);
		}
		x$1 = ((seed.$low + ((seed.$high >> 31) * 4294967296)) >> 0);
		i = -20;
		while (true) {
			if (!(i < 607)) { break; }
			x$1 = seedrand(x$1);
			if (i >= 0) {
				u = new $Int64(0, 0);
				u = $shiftLeft64(new $Int64(0, x$1), 40);
				x$1 = seedrand(x$1);
				u = (x$2 = $shiftLeft64(new $Int64(0, x$1), 20), new $Int64(u.$high ^ x$2.$high, (u.$low ^ x$2.$low) >>> 0));
				x$1 = seedrand(x$1);
				u = (x$3 = new $Int64(0, x$1), new $Int64(u.$high ^ x$3.$high, (u.$low ^ x$3.$low) >>> 0));
				u = (x$4 = ((i < 0 || i >= rng_cooked.length) ? $throwRuntimeError("index out of range") : rng_cooked[i]), new $Int64(u.$high ^ x$4.$high, (u.$low ^ x$4.$low) >>> 0));
				(x$5 = rng.vec, ((i < 0 || i >= x$5.length) ? $throwRuntimeError("index out of range") : x$5[i] = new $Int64(u.$high & 2147483647, (u.$low & 4294967295) >>> 0)));
			}
			i = i + (1) >> 0;
		}
	};
	rngSource.prototype.Seed = function(seed) { return this.$val.Seed(seed); };
	rngSource.ptr.prototype.Int63 = function() {
		var $ptr, rng, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		rng = this;
		rng.tap = rng.tap - (1) >> 0;
		if (rng.tap < 0) {
			rng.tap = rng.tap + (607) >> 0;
		}
		rng.feed = rng.feed - (1) >> 0;
		if (rng.feed < 0) {
			rng.feed = rng.feed + (607) >> 0;
		}
		x$7 = (x = (x$1 = (x$2 = rng.vec, x$3 = rng.feed, ((x$3 < 0 || x$3 >= x$2.length) ? $throwRuntimeError("index out of range") : x$2[x$3])), x$4 = (x$5 = rng.vec, x$6 = rng.tap, ((x$6 < 0 || x$6 >= x$5.length) ? $throwRuntimeError("index out of range") : x$5[x$6])), new $Int64(x$1.$high + x$4.$high, x$1.$low + x$4.$low)), new $Int64(x.$high & 2147483647, (x.$low & 4294967295) >>> 0));
		(x$8 = rng.vec, x$9 = rng.feed, ((x$9 < 0 || x$9 >= x$8.length) ? $throwRuntimeError("index out of range") : x$8[x$9] = x$7));
		return x$7;
	};
	rngSource.prototype.Int63 = function() { return this.$val.Int63(); };
	ptrType$3.methods = [{prop: "ExpFloat64", name: "ExpFloat64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "NormFloat64", name: "NormFloat64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint32", name: "Uint32", pkg: "", typ: $funcType([], [$Uint32], false)}, {prop: "Int31", name: "Int31", pkg: "", typ: $funcType([], [$Int32], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int63n", name: "Int63n", pkg: "", typ: $funcType([$Int64], [$Int64], false)}, {prop: "Int31n", name: "Int31n", pkg: "", typ: $funcType([$Int32], [$Int32], false)}, {prop: "Intn", name: "Intn", pkg: "", typ: $funcType([$Int], [$Int], false)}, {prop: "Float64", name: "Float64", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Float32", name: "Float32", pkg: "", typ: $funcType([], [$Float32], false)}, {prop: "Perm", name: "Perm", pkg: "", typ: $funcType([$Int], [sliceType], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType$1], [$Int, $error], false)}];
	ptrType.methods = [{prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "seedPos", name: "seedPos", pkg: "math/rand", typ: $funcType([$Int64, ptrType$1], [], false)}, {prop: "read", name: "read", pkg: "math/rand", typ: $funcType([sliceType$1, ptrType$2, ptrType$1], [$Int, $error], false)}];
	ptrType$5.methods = [{prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}];
	Source.init([{prop: "Int63", name: "Int63", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seed", name: "Seed", pkg: "", typ: $funcType([$Int64], [], false)}]);
	Rand.init("math/rand", [{prop: "src", name: "src", exported: false, typ: Source, tag: ""}, {prop: "readVal", name: "readVal", exported: false, typ: $Int64, tag: ""}, {prop: "readPos", name: "readPos", exported: false, typ: $Int8, tag: ""}]);
	lockedSource.init("math/rand", [{prop: "lk", name: "lk", exported: false, typ: nosync.Mutex, tag: ""}, {prop: "src", name: "src", exported: false, typ: Source, tag: ""}]);
	rngSource.init("math/rand", [{prop: "tap", name: "tap", exported: false, typ: $Int, tag: ""}, {prop: "feed", name: "feed", exported: false, typ: $Int, tag: ""}, {prop: "vec", name: "vec", exported: false, typ: arrayType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = nosync.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ke = $toNativeArray($kindUint32, [3801129273, 0, 2615860924, 3279400049, 3571300752, 3733536696, 3836274812, 3906990442, 3958562475, 3997804264, 4028649213, 4053523342, 4074002619, 4091154507, 4105727352, 4118261130, 4129155133, 4138710916, 4147160435, 4154685009, 4161428406, 4167506077, 4173011791, 4178022498, 4182601930, 4186803325, 4190671498, 4194244443, 4197554582, 4200629752, 4203493986, 4206168142, 4208670408, 4211016720, 4213221098, 4215295924, 4217252177, 4219099625, 4220846988, 4222502074, 4224071896, 4225562770, 4226980400, 4228329951, 4229616109, 4230843138, 4232014925, 4233135020, 4234206673, 4235232866, 4236216336, 4237159604, 4238064994, 4238934652, 4239770563, 4240574564, 4241348362, 4242093539, 4242811568, 4243503822, 4244171579, 4244816032, 4245438297, 4246039419, 4246620374, 4247182079, 4247725394, 4248251127, 4248760037, 4249252839, 4249730206, 4250192773, 4250641138, 4251075867, 4251497493, 4251906522, 4252303431, 4252688672, 4253062674, 4253425844, 4253778565, 4254121205, 4254454110, 4254777611, 4255092022, 4255397640, 4255694750, 4255983622, 4256264513, 4256537670, 4256803325, 4257061702, 4257313014, 4257557464, 4257795244, 4258026541, 4258251531, 4258470383, 4258683258, 4258890309, 4259091685, 4259287526, 4259477966, 4259663135, 4259843154, 4260018142, 4260188212, 4260353470, 4260514019, 4260669958, 4260821380, 4260968374, 4261111028, 4261249421, 4261383632, 4261513736, 4261639802, 4261761900, 4261880092, 4261994441, 4262105003, 4262211835, 4262314988, 4262414513, 4262510454, 4262602857, 4262691764, 4262777212, 4262859239, 4262937878, 4263013162, 4263085118, 4263153776, 4263219158, 4263281289, 4263340187, 4263395872, 4263448358, 4263497660, 4263543789, 4263586755, 4263626565, 4263663224, 4263696735, 4263727099, 4263754314, 4263778377, 4263799282, 4263817020, 4263831582, 4263842955, 4263851124, 4263856071, 4263857776, 4263856218, 4263851370, 4263843206, 4263831695, 4263816804, 4263798497, 4263776735, 4263751476, 4263722676, 4263690284, 4263654251, 4263614520, 4263571032, 4263523724, 4263472530, 4263417377, 4263358192, 4263294892, 4263227394, 4263155608, 4263079437, 4262998781, 4262913534, 4262823581, 4262728804, 4262629075, 4262524261, 4262414220, 4262298801, 4262177846, 4262051187, 4261918645, 4261780032, 4261635148, 4261483780, 4261325704, 4261160681, 4260988457, 4260808763, 4260621313, 4260425802, 4260221905, 4260009277, 4259787550, 4259556329, 4259315195, 4259063697, 4258801357, 4258527656, 4258242044, 4257943926, 4257632664, 4257307571, 4256967906, 4256612870, 4256241598, 4255853155, 4255446525, 4255020608, 4254574202, 4254106002, 4253614578, 4253098370, 4252555662, 4251984571, 4251383021, 4250748722, 4250079132, 4249371435, 4248622490, 4247828790, 4246986404, 4246090910, 4245137315, 4244119963, 4243032411, 4241867296, 4240616155, 4239269214, 4237815118, 4236240596, 4234530035, 4232664930, 4230623176, 4228378137, 4225897409, 4223141146, 4220059768, 4216590757, 4212654085, 4208145538, 4202926710, 4196809522, 4189531420, 4180713890, 4169789475, 4155865042, 4137444620, 4111806704, 4073393724, 4008685917, 3873074895]);
		we = $toNativeArray($kindFloat32, [2.0249555365836613e-09, 1.4866739783681027e-11, 2.4409616689036184e-11, 3.1968806074589295e-11, 3.844677007314168e-11, 4.42282044321729e-11, 4.951644302919611e-11, 5.443358958023836e-11, 5.905943789574764e-11, 6.34494193296753e-11, 6.764381416113352e-11, 7.167294535648239e-11, 7.556032188826833e-11, 7.932458162551725e-11, 8.298078890689453e-11, 8.654132271912474e-11, 9.001651507523079e-11, 9.341507428706208e-11, 9.674443190998971e-11, 1.0001099254308699e-10, 1.0322031424037093e-10, 1.0637725422757427e-10, 1.0948611461891744e-10, 1.1255067711157807e-10, 1.1557434870246297e-10, 1.1856014781042035e-10, 1.2151082917633005e-10, 1.2442885610752796e-10, 1.2731647680563896e-10, 1.3017574518325858e-10, 1.330085347417409e-10, 1.3581656632677408e-10, 1.386014220061682e-10, 1.413645728254309e-10, 1.4410737880776736e-10, 1.4683107507629245e-10, 1.4953686899854546e-10, 1.522258291641876e-10, 1.5489899640730442e-10, 1.575573282952547e-10, 1.6020171300645814e-10, 1.628330109637588e-10, 1.6545202707884954e-10, 1.68059510752272e-10, 1.7065616975120435e-10, 1.73242697965037e-10, 1.758197337720091e-10, 1.783878739169964e-10, 1.8094774290045024e-10, 1.834998542005195e-10, 1.8604476292871652e-10, 1.8858298256319017e-10, 1.9111498494872592e-10, 1.9364125580789704e-10, 1.9616222535212557e-10, 1.9867835154840918e-10, 2.011900368525943e-10, 2.0369768372052732e-10, 2.062016807302669e-10, 2.0870240258208383e-10, 2.1120022397624894e-10, 2.136955057352452e-10, 2.1618855317040442e-10, 2.1867974098199738e-10, 2.2116936060356807e-10, 2.2365774510202385e-10, 2.2614519978869652e-10, 2.2863201609713002e-10, 2.3111849933865614e-10, 2.3360494094681883e-10, 2.3609159072179864e-10, 2.3857874009713953e-10, 2.4106666662859766e-10, 2.4355562011635357e-10, 2.460458781161634e-10, 2.485376904282077e-10, 2.5103127909709144e-10, 2.5352694943414633e-10, 2.560248957284017e-10, 2.585253955356137e-10, 2.610286709003873e-10, 2.6353494386732734e-10, 2.6604446423661443e-10, 2.6855745405285347e-10, 2.71074163116225e-10, 2.7359478571575835e-10, 2.7611959940720965e-10, 2.786487707240326e-10, 2.8118254946640775e-10, 2.8372118543451563e-10, 2.8626484516180994e-10, 2.8881380620404684e-10, 2.9136826285025563e-10, 2.9392840938946563e-10, 2.96494523377433e-10, 2.990667713476114e-10, 3.016454031001814e-10, 3.042306406797479e-10, 3.068226783753403e-10, 3.09421765987139e-10, 3.12028125559749e-10, 3.1464195138219964e-10, 3.17263521010247e-10, 3.1989300097734485e-10, 3.225306410836737e-10, 3.2517669112941405e-10, 3.2783134540359526e-10, 3.3049485370639786e-10, 3.3316743808242677e-10, 3.3584937608743815e-10, 3.385408342548857e-10, 3.4124211789610115e-10, 3.4395342130011386e-10, 3.4667499426710435e-10, 3.494071143528288e-10, 3.521500313574677e-10, 3.54903967325626e-10, 3.576691720574843e-10, 3.6044595086437425e-10, 3.632345535464765e-10, 3.660352021483959e-10, 3.688482297370399e-10, 3.716738583570134e-10, 3.7451239331964814e-10, 3.773641121807003e-10, 3.802292924959261e-10, 3.831082673322328e-10, 3.8600128648980103e-10, 3.8890865527996255e-10, 3.9183070676962473e-10, 3.9476774627011935e-10, 3.977200790927782e-10, 4.006880383045086e-10, 4.0367195697221803e-10, 4.066721681628138e-10, 4.0968900494320337e-10, 4.127228558914453e-10, 4.15774054074447e-10, 4.188429603146915e-10, 4.2192993543466173e-10, 4.25035395767992e-10, 4.2815970213716525e-10, 4.313032986313914e-10, 4.3446651831757777e-10, 4.376498607960855e-10, 4.408536868893975e-10, 4.4407846844229937e-10, 4.4732464954400086e-10, 4.5059267428371186e-10, 4.538830145062178e-10, 4.5719619756745544e-10, 4.605326675566346e-10, 4.638929240741163e-10, 4.672775499869886e-10, 4.706869893844612e-10, 4.74121908400349e-10, 4.775827511238617e-10, 4.810701836888143e-10, 4.845848167178701e-10, 4.881271498113904e-10, 4.916979601254923e-10, 4.952977472605369e-10, 4.989272883726414e-10, 5.025872495956207e-10, 5.062783525744408e-10, 5.100013189540675e-10, 5.13756870379467e-10, 5.175458395179078e-10, 5.21369003525507e-10, 5.252272505806843e-10, 5.29121357839557e-10, 5.330522134805449e-10, 5.3702081670437e-10, 5.41028055689452e-10, 5.450749851476644e-10, 5.491624932574268e-10, 5.532918012640664e-10, 5.574638528571541e-10, 5.616799247931681e-10, 5.659410717839819e-10, 5.702485705860738e-10, 5.746036979559221e-10, 5.790077306500052e-10, 5.83462111958255e-10, 5.879682296594524e-10, 5.925275825546805e-10, 5.971417249561739e-10, 6.01812211176167e-10, 6.065408175714992e-10, 6.113292094767075e-10, 6.16179329782085e-10, 6.21092954844471e-10, 6.260721940876124e-10, 6.311191569352559e-10, 6.362359528111483e-10, 6.414249686947926e-10, 6.466885360545405e-10, 6.520292639144998e-10, 6.574497612987784e-10, 6.629528592760892e-10, 6.685415554485985e-10, 6.742187919073217e-10, 6.799880103436351e-10, 6.858525969377638e-10, 6.918161599145378e-10, 6.978825850545434e-10, 7.040559801829716e-10, 7.103406751696184e-10, 7.167412219288849e-10, 7.232625609532306e-10, 7.2990985477972e-10, 7.366885990123251e-10, 7.436047333442275e-10, 7.506645305355164e-10, 7.57874762946642e-10, 7.652426470272644e-10, 7.727759543385559e-10, 7.804830115532013e-10, 7.883728114777e-10, 7.964550685635174e-10, 8.047402189070851e-10, 8.132396422944055e-10, 8.219657177122031e-10, 8.309318788590758e-10, 8.401527806789488e-10, 8.496445214056791e-10, 8.594246980742071e-10, 8.695127395874636e-10, 8.799300732498239e-10, 8.90700457834015e-10, 9.01850316648023e-10, 9.134091816243028e-10, 9.254100818978372e-10, 9.37890431984556e-10, 9.508922538259412e-10, 9.64463842123564e-10, 9.78660263939446e-10, 9.935448019859905e-10, 1.0091912860943353e-09, 1.0256859805934937e-09, 1.0431305819125214e-09, 1.0616465484503124e-09, 1.0813799855569073e-09, 1.1025096391392708e-09, 1.1252564435793033e-09, 1.149898620766976e-09, 1.176793218427008e-09, 1.2064089727203964e-09, 1.2393785997488749e-09, 1.2765849488616254e-09, 1.319313880365769e-09, 1.36954347862428e-09, 1.4305497897382224e-09, 1.5083649884672923e-09, 1.6160853766322703e-09, 1.7921247819074893e-09]);
		fe = $toNativeArray($kindFloat32, [1, 0.9381436705589294, 0.900469958782196, 0.8717043399810791, 0.847785472869873, 0.8269932866096497, 0.8084216713905334, 0.7915276288986206, 0.7759568691253662, 0.7614634037017822, 0.7478685975074768, 0.7350381016731262, 0.7228676676750183, 0.7112747430801392, 0.7001926302909851, 0.6895664930343628, 0.6793505549430847, 0.669506311416626, 0.6600008606910706, 0.6508058309555054, 0.6418967247009277, 0.633251965045929, 0.62485271692276, 0.6166821718215942, 0.608725368976593, 0.6009689569473267, 0.5934008955955505, 0.5860103368759155, 0.5787873864173889, 0.5717230439186096, 0.5648092031478882, 0.5580382943153381, 0.5514034032821655, 0.5448982119560242, 0.5385168790817261, 0.5322538614273071, 0.526104211807251, 0.5200631618499756, 0.5141264200210571, 0.5082897543907166, 0.5025495290756226, 0.4969019889831543, 0.4913438558578491, 0.4858720004558563, 0.48048335313796997, 0.4751752018928528, 0.4699448347091675, 0.4647897481918335, 0.4597076177597046, 0.4546961486339569, 0.4497532546520233, 0.44487687945365906, 0.4400651156902313, 0.4353161156177521, 0.4306281507015228, 0.42599955201148987, 0.42142874002456665, 0.4169141948223114, 0.4124544560909271, 0.40804818272590637, 0.4036940038204193, 0.39939069747924805, 0.3951369822025299, 0.39093172550201416, 0.38677382469177246, 0.38266217708587646, 0.378595769405365, 0.37457355856895447, 0.37059465050697327, 0.366658091545105, 0.362762987613678, 0.358908474445343, 0.35509374737739563, 0.35131800174713135, 0.3475804924964905, 0.34388044476509094, 0.34021714329719543, 0.33658990263938904, 0.3329980671405792, 0.3294409513473511, 0.32591795921325684, 0.32242849469184875, 0.3189719021320343, 0.3155476748943329, 0.31215524673461914, 0.3087940812110901, 0.30546361207962036, 0.30216339230537415, 0.29889291524887085, 0.29565170407295227, 0.2924392819404602, 0.2892552316188812, 0.28609907627105713, 0.2829704284667969, 0.27986884117126465, 0.2767939269542694, 0.2737452983856201, 0.2707225978374481, 0.26772540807724, 0.26475343108177185, 0.2618062496185303, 0.258883535861969, 0.2559850215911865, 0.25311028957366943, 0.25025907158851624, 0.24743106961250305, 0.2446259707212448, 0.24184346199035645, 0.23908329010009766, 0.23634515702724457, 0.2336287796497345, 0.23093391954898834, 0.22826029360294342, 0.22560766339302063, 0.22297576069831848, 0.22036437690258026, 0.21777324378490448, 0.21520215272903442, 0.212650865316391, 0.21011915802955627, 0.20760682225227356, 0.20511364936828613, 0.20263944566249847, 0.20018397271633148, 0.19774706661701202, 0.1953285187482834, 0.19292815029621124, 0.19054576754570007, 0.18818120658397675, 0.18583425879478455, 0.18350479006767273, 0.18119260668754578, 0.17889754474163055, 0.17661945521831512, 0.17435817420482635, 0.1721135377883911, 0.16988539695739746, 0.16767361760139465, 0.16547803580760956, 0.16329853236675262, 0.16113494336605072, 0.1589871346950531, 0.15685498714447021, 0.15473836660385132, 0.15263713896274567, 0.1505511850118637, 0.1484803706407547, 0.14642459154129028, 0.1443837285041809, 0.14235764741897583, 0.1403462439775467, 0.13834942877292633, 0.136367067694664, 0.13439907133579254, 0.1324453204870224, 0.1305057406425476, 0.12858019769191742, 0.12666863203048706, 0.12477091699838638, 0.12288697808980942, 0.1210167184472084, 0.11916005611419678, 0.11731690168380737, 0.11548716574907303, 0.11367076635360718, 0.11186762899160385, 0.11007767915725708, 0.1083008274435997, 0.10653700679540634, 0.10478614270687103, 0.1030481606721878, 0.10132300108671188, 0.0996105819940567, 0.09791085124015808, 0.09622374176979065, 0.09454918652772903, 0.09288713335990906, 0.09123751521110535, 0.08960027992725372, 0.08797537535429001, 0.08636274188756943, 0.0847623273730278, 0.08317409455776215, 0.08159798383712769, 0.08003395050764084, 0.07848194986581802, 0.07694194465875626, 0.07541389018297195, 0.07389774918556213, 0.07239348441362381, 0.070901058614254, 0.06942043453454971, 0.06795158982276917, 0.06649449467658997, 0.06504911929368973, 0.06361543387174606, 0.06219341605901718, 0.06078304722905159, 0.0593843050301075, 0.05799717456102371, 0.05662164092063904, 0.05525768920779228, 0.05390531197190285, 0.05256449431180954, 0.05123523622751236, 0.04991753399372101, 0.04861138388514519, 0.047316793352365494, 0.04603376239538193, 0.044762298464775085, 0.04350241273641586, 0.04225412383675575, 0.04101744294166565, 0.039792392402887344, 0.03857899457216263, 0.03737728297710419, 0.03618728369474411, 0.03500903770327568, 0.03384258225560188, 0.0326879620552063, 0.031545232981443405, 0.030414443463087082, 0.0292956605553627, 0.028188949450850487, 0.027094384655356407, 0.02601204626262188, 0.024942025542259216, 0.023884421214461327, 0.022839335724711418, 0.021806888282299042, 0.020787203684449196, 0.019780423492193222, 0.018786700442433357, 0.017806200310587883, 0.016839107498526573, 0.015885621309280396, 0.014945968054234982, 0.01402039173990488, 0.013109165243804455, 0.012212592177093029, 0.011331013403832912, 0.010464809834957123, 0.009614413604140282, 0.008780314587056637, 0.007963077165186405, 0.007163353264331818, 0.0063819061033427715, 0.005619642324745655, 0.004877655766904354, 0.004157294984906912, 0.003460264764726162, 0.0027887988835573196, 0.0021459676790982485, 0.001536299823783338, 0.0009672692976891994, 0.0004541343660093844]);
		kn = $toNativeArray($kindUint32, [1991057938, 0, 1611602771, 1826899878, 1918584482, 1969227037, 2001281515, 2023368125, 2039498179, 2051788381, 2061460127, 2069267110, 2075699398, 2081089314, 2085670119, 2089610331, 2093034710, 2096037586, 2098691595, 2101053571, 2103168620, 2105072996, 2106796166, 2108362327, 2109791536, 2111100552, 2112303493, 2113412330, 2114437283, 2115387130, 2116269447, 2117090813, 2117856962, 2118572919, 2119243101, 2119871411, 2120461303, 2121015852, 2121537798, 2122029592, 2122493434, 2122931299, 2123344971, 2123736059, 2124106020, 2124456175, 2124787725, 2125101763, 2125399283, 2125681194, 2125948325, 2126201433, 2126441213, 2126668298, 2126883268, 2127086657, 2127278949, 2127460589, 2127631985, 2127793506, 2127945490, 2128088244, 2128222044, 2128347141, 2128463758, 2128572095, 2128672327, 2128764606, 2128849065, 2128925811, 2128994934, 2129056501, 2129110560, 2129157136, 2129196237, 2129227847, 2129251929, 2129268426, 2129277255, 2129278312, 2129271467, 2129256561, 2129233410, 2129201800, 2129161480, 2129112170, 2129053545, 2128985244, 2128906855, 2128817916, 2128717911, 2128606255, 2128482298, 2128345305, 2128194452, 2128028813, 2127847342, 2127648860, 2127432031, 2127195339, 2126937058, 2126655214, 2126347546, 2126011445, 2125643893, 2125241376, 2124799783, 2124314271, 2123779094, 2123187386, 2122530867, 2121799464, 2120980787, 2120059418, 2119015917, 2117825402, 2116455471, 2114863093, 2112989789, 2110753906, 2108037662, 2104664315, 2100355223, 2094642347, 2086670106, 2074676188, 2054300022, 2010539237]);
		wn = $toNativeArray($kindFloat32, [1.7290404663583558e-09, 1.2680928529462676e-10, 1.689751810696194e-10, 1.9862687883343e-10, 2.223243117382978e-10, 2.4244936613904144e-10, 2.601613091623989e-10, 2.761198769629658e-10, 2.9073962681813725e-10, 3.042996965518796e-10, 3.169979556627567e-10, 3.289802041894774e-10, 3.4035738116777736e-10, 3.5121602848242617e-10, 3.61625090983253e-10, 3.7164057942185025e-10, 3.813085680537398e-10, 3.906675816178762e-10, 3.997501218933053e-10, 4.0858399996679395e-10, 4.1719308563337165e-10, 4.255982233303257e-10, 4.3381759295968436e-10, 4.4186720948857783e-10, 4.497613115272969e-10, 4.57512583373898e-10, 4.6513240481438345e-10, 4.726310454117311e-10, 4.800177477726209e-10, 4.873009773476156e-10, 4.944885056978876e-10, 5.015873272284921e-10, 5.086040477664255e-10, 5.155446070048697e-10, 5.224146670812502e-10, 5.292193350214802e-10, 5.359634958068682e-10, 5.426517013518151e-10, 5.492881705038144e-10, 5.558769555769061e-10, 5.624218868405251e-10, 5.689264614971989e-10, 5.75394121238304e-10, 5.818281967329142e-10, 5.882316855831959e-10, 5.946076964136182e-10, 6.009590047817426e-10, 6.072883862451306e-10, 6.135985053390414e-10, 6.19892026598734e-10, 6.261713370037114e-10, 6.324390455780815e-10, 6.386973727678935e-10, 6.449488165749528e-10, 6.511955974453087e-10, 6.574400468473129e-10, 6.636843297158634e-10, 6.699307220081607e-10, 6.761814441702541e-10, 6.824387166481927e-10, 6.887046488657234e-10, 6.949815167800466e-10, 7.012714853260604e-10, 7.075767749498141e-10, 7.13899661608508e-10, 7.202424212593428e-10, 7.266072743483676e-10, 7.329966078550854e-10, 7.394128087589991e-10, 7.458582640396116e-10, 7.523354716987285e-10, 7.588469852493063e-10, 7.653954137154528e-10, 7.719834771435785e-10, 7.786139510912449e-10, 7.852897221383159e-10, 7.920137878869582e-10, 7.987892014504894e-10, 8.056192379868321e-10, 8.125072836762115e-10, 8.194568912323064e-10, 8.264716688799467e-10, 8.3355555791087e-10, 8.407127216614185e-10, 8.479473234679347e-10, 8.552640262671218e-10, 8.626675485068347e-10, 8.701631637464402e-10, 8.777562010564566e-10, 8.854524335966119e-10, 8.932581896381464e-10, 9.011799639857543e-10, 9.092249730890956e-10, 9.174008219758889e-10, 9.25715837318819e-10, 9.341788453909317e-10, 9.42799727177146e-10, 9.515889187738935e-10, 9.605578554783278e-10, 9.697193048552322e-10, 9.790869226478094e-10, 9.886760299337993e-10, 9.985036131254788e-10, 1.008588212947359e-09, 1.0189509236369076e-09, 1.0296150598776421e-09, 1.040606933955246e-09, 1.0519566329136865e-09, 1.0636980185552147e-09, 1.0758701707302976e-09, 1.0885182755160372e-09, 1.101694735439196e-09, 1.115461056855338e-09, 1.1298901814171813e-09, 1.1450695946990663e-09, 1.1611052119775422e-09, 1.178127595480305e-09, 1.1962995039027646e-09, 1.2158286599728285e-09, 1.2369856250415978e-09, 1.2601323318151003e-09, 1.2857697129220469e-09, 1.3146201904845611e-09, 1.3477839955200466e-09, 1.3870635751089821e-09, 1.43574030442295e-09, 1.5008658760251592e-09, 1.6030947680434338e-09]);
		fn = $toNativeArray($kindFloat32, [1, 0.963599681854248, 0.9362826943397522, 0.9130436182022095, 0.8922816514968872, 0.8732430338859558, 0.8555005788803101, 0.8387836217880249, 0.8229072093963623, 0.8077383041381836, 0.7931770086288452, 0.7791460752487183, 0.7655841708183289, 0.7524415850639343, 0.7396772503852844, 0.7272568941116333, 0.7151514887809753, 0.7033361196517944, 0.6917891502380371, 0.6804918646812439, 0.6694276928901672, 0.6585819721221924, 0.6479418277740479, 0.6374954581260681, 0.6272324919700623, 0.6171433925628662, 0.6072195172309875, 0.5974531769752502, 0.5878370404243469, 0.5783646702766418, 0.5690299868583679, 0.5598273873329163, 0.550751805305481, 0.5417983531951904, 0.5329626798629761, 0.5242405533790588, 0.5156282186508179, 0.5071220397949219, 0.49871864914894104, 0.4904148280620575, 0.48220765590667725, 0.47409430146217346, 0.466072142124176, 0.45813870429992676, 0.45029163360595703, 0.44252872467041016, 0.4348478317260742, 0.42724698781967163, 0.41972434520721436, 0.41227802634239197, 0.40490642189979553, 0.39760786294937134, 0.3903807997703552, 0.3832238018512726, 0.3761354684829712, 0.3691144585609436, 0.36215949058532715, 0.3552693724632263, 0.3484429717063904, 0.3416791558265686, 0.33497685194015503, 0.32833510637283325, 0.3217529058456421, 0.3152293860912323, 0.30876362323760986, 0.3023548424243927, 0.2960021495819092, 0.2897048592567444, 0.28346219658851624, 0.2772735059261322, 0.271138072013855, 0.2650552988052368, 0.25902456045150757, 0.25304529070854187, 0.24711695313453674, 0.24123899638652802, 0.23541094362735748, 0.22963231801986694, 0.22390270233154297, 0.21822164952754974, 0.21258877217769623, 0.20700371265411377, 0.20146611332893372, 0.1959756463766098, 0.19053204357624054, 0.18513499200344086, 0.17978426814079285, 0.1744796335697174, 0.16922089457511902, 0.16400785744190216, 0.1588403731584549, 0.15371830761432648, 0.14864157140254974, 0.14361007511615753, 0.13862377405166626, 0.13368265330791473, 0.12878671288490295, 0.12393598258495331, 0.11913054436445236, 0.11437050998210907, 0.10965602099895477, 0.1049872562289238, 0.10036443918943405, 0.09578784555196762, 0.09125780314207077, 0.08677466958761215, 0.08233889937400818, 0.07795098423957825, 0.07361150532960892, 0.06932111829519272, 0.06508058309555054, 0.06089077144861221, 0.05675266310572624, 0.05266740173101425, 0.048636294901371, 0.044660862535238266, 0.040742866694927216, 0.03688438981771469, 0.03308788686990738, 0.029356317594647408, 0.025693291798233986, 0.02210330404341221, 0.018592102453112602, 0.015167297795414925, 0.011839478276669979, 0.0086244847625494, 0.005548994988203049, 0.0026696291752159595]);
		rng_cooked = $toNativeArray($kindInt64, [new $Int64(1173834291, 3952672746), new $Int64(1081821761, 3130416987), new $Int64(324977939, 3414273807), new $Int64(1241840476, 2806224363), new $Int64(669549340, 1997590414), new $Int64(2103305448, 2402795971), new $Int64(1663160183, 1140819369), new $Int64(1120601685, 1788868961), new $Int64(1848035537, 1089001426), new $Int64(1235702047, 873593504), new $Int64(1911387977, 581324885), new $Int64(492609478, 1609182556), new $Int64(1069394745, 1241596776), new $Int64(1895445337, 1771189259), new $Int64(772864846, 3467012610), new $Int64(2006957225, 2344407434), new $Int64(402115761, 782467244), new $Int64(26335124, 3404933915), new $Int64(1063924276, 618867887), new $Int64(1178782866, 520164395), new $Int64(555910815, 1341358184), new $Int64(632398609, 665794848), new $Int64(1527227641, 3183648150), new $Int64(1781176124, 696329606), new $Int64(1789146075, 4151988961), new $Int64(60039534, 998951326), new $Int64(1535158725, 1364957564), new $Int64(63173359, 4090230633), new $Int64(649454641, 4009697548), new $Int64(248009524, 2569622517), new $Int64(778703922, 3742421481), new $Int64(1038377625, 1506914633), new $Int64(1738099768, 1983412561), new $Int64(236311649, 1436266083), new $Int64(1035966148, 3922894967), new $Int64(810508934, 1792680179), new $Int64(563141142, 1188796351), new $Int64(1349617468, 405968250), new $Int64(1044074554, 433754187), new $Int64(870549669, 4073162024), new $Int64(1053232044, 433121399), new $Int64(2451824, 4162580594), new $Int64(2010221076, 4132415622), new $Int64(611252600, 3033822028), new $Int64(2016407895, 824682382), new $Int64(2366218, 3583765414), new $Int64(1522878809, 535386927), new $Int64(1637219058, 2286693689), new $Int64(1453075389, 2968466525), new $Int64(193683513, 1351410206), new $Int64(1863677552, 1412813499), new $Int64(492736522, 4126267639), new $Int64(512765208, 2105529399), new $Int64(2132966268, 2413882233), new $Int64(947457634, 32226200), new $Int64(1149341356, 2032329073), new $Int64(106485445, 1356518208), new $Int64(79673492, 3430061722), new $Int64(663048513, 3820169661), new $Int64(481498454, 2981816134), new $Int64(1017155588, 4184371017), new $Int64(206574701, 2119206761), new $Int64(1295374591, 2472200560), new $Int64(1587026100, 2853524696), new $Int64(1307803389, 1681119904), new $Int64(1972496813, 95608918), new $Int64(392686347, 3690479145), new $Int64(941912722, 1397922290), new $Int64(988169623, 1516129515), new $Int64(1827305493, 1547420459), new $Int64(1311333971, 1470949486), new $Int64(194013850, 1336785672), new $Int64(2102397034, 4131677129), new $Int64(755205548, 4246329084), new $Int64(1004983461, 3788585631), new $Int64(2081005363, 3080389532), new $Int64(1501045284, 2215402037), new $Int64(391002300, 1171593935), new $Int64(1408774047, 1423855166), new $Int64(1628305930, 2276716302), new $Int64(1779030508, 2068027241), new $Int64(1369359303, 3427553297), new $Int64(189241615, 3289637845), new $Int64(1057480830, 3486407650), new $Int64(634572984, 3071877822), new $Int64(1159653919, 3363620705), new $Int64(1213226718, 4159821533), new $Int64(2070861710, 1894661), new $Int64(1472989750, 1156868282), new $Int64(348271067, 776219088), new $Int64(1646054810, 2425634259), new $Int64(1716021749, 680510161), new $Int64(1573220192, 1310101429), new $Int64(1095885995, 2964454134), new $Int64(1821788136, 3467098407), new $Int64(1990672920, 2109628894), new $Int64(7834944, 1232604732), new $Int64(309412934, 3261916179), new $Int64(1699175360, 434597899), new $Int64(235436061, 1624796439), new $Int64(521080809, 3589632480), new $Int64(1198416575, 864579159), new $Int64(208735487, 1380889830), new $Int64(619206309, 2654509477), new $Int64(1419738251, 1468209306), new $Int64(403198876, 100794388), new $Int64(956062190, 2991674471), new $Int64(1938816907, 2224662036), new $Int64(1973824487, 977097250), new $Int64(1351320195, 726419512), new $Int64(1964023751, 1747974366), new $Int64(1394388465, 1556430604), new $Int64(1097991433, 1080776742), new $Int64(1761636690, 280794874), new $Int64(117767733, 919835643), new $Int64(1180474222, 3434019658), new $Int64(196069168, 2461941785), new $Int64(133215641, 3615001066), new $Int64(417204809, 3103414427), new $Int64(790056561, 3380809712), new $Int64(879802240, 2724693469), new $Int64(547796833, 598827710), new $Int64(300924196, 3452273442), new $Int64(2071705424, 649274915), new $Int64(1346182319, 2585724112), new $Int64(636549385, 3165579553), new $Int64(1185578221, 2635894283), new $Int64(2094573470, 2053289721), new $Int64(985976581, 3169337108), new $Int64(1170569632, 144717764), new $Int64(1079216270, 1383666384), new $Int64(2022678706, 681540375), new $Int64(1375448925, 537050586), new $Int64(182715304, 315246468), new $Int64(226402871, 849323088), new $Int64(1262421183, 45543944), new $Int64(1201038398, 2319052083), new $Int64(2106775454, 3613090841), new $Int64(560472520, 2992171180), new $Int64(1765620479, 2068244785), new $Int64(917538188, 4239862634), new $Int64(777927839, 3892253031), new $Int64(720683925, 958186149), new $Int64(1724185863, 1877702262), new $Int64(1357886971, 837674867), new $Int64(1837048883, 1507589294), new $Int64(1905518400, 873336795), new $Int64(267722611, 2764496274), new $Int64(341003118, 4196182374), new $Int64(1080717893, 550964545), new $Int64(818747069, 420611474), new $Int64(222653272, 204265180), new $Int64(1549974541, 1787046383), new $Int64(1215581865, 3102292318), new $Int64(418321538, 1552199393), new $Int64(1243493047, 980542004), new $Int64(267284263, 3293718720), new $Int64(1179528763, 3771917473), new $Int64(599484404, 2195808264), new $Int64(252818753, 3894702887), new $Int64(780007692, 2099949527), new $Int64(1424094358, 338442522), new $Int64(490737398, 637158004), new $Int64(419862118, 281976339), new $Int64(574970164, 3619802330), new $Int64(1715552825, 3084554784), new $Int64(882872465, 4129772886), new $Int64(43084605, 1680378557), new $Int64(525521057, 3339087776), new $Int64(1680500332, 4220317857), new $Int64(211654685, 2959322499), new $Int64(1675600481, 1488354890), new $Int64(1312620086, 3958162143), new $Int64(920972075, 2773705983), new $Int64(1876039582, 225908689), new $Int64(963748535, 908216283), new $Int64(1541787429, 3574646075), new $Int64(319760557, 1936937569), new $Int64(1519770881, 75492235), new $Int64(816689472, 1935193178), new $Int64(2142521206, 2018250883), new $Int64(455141620, 3943126022), new $Int64(1546084160, 3066544345), new $Int64(1932392669, 2793082663), new $Int64(908474287, 3297036421), new $Int64(1640597065, 2206987825), new $Int64(1594236910, 807894872), new $Int64(366158341, 766252117), new $Int64(2060649606, 3833114345), new $Int64(845619743, 1255067973), new $Int64(1201145605, 741697208), new $Int64(671241040, 2810093753), new $Int64(1109032642, 4229340371), new $Int64(1462188720, 1361684224), new $Int64(988084219, 1906263026), new $Int64(475781207, 3904421704), new $Int64(1523946520, 1769075545), new $Int64(1062308525, 2621599764), new $Int64(1279509432, 3431891480), new $Int64(404732502, 1871896503), new $Int64(128756421, 1412808876), new $Int64(1605404688, 952876175), new $Int64(1917039957, 1824438899), new $Int64(1662295856, 1005035476), new $Int64(1990909507, 527508597), new $Int64(1288873303, 3066806859), new $Int64(565995893, 3244940914), new $Int64(1257737460, 209092916), new $Int64(1899814242, 1242699167), new $Int64(1433653252, 456723774), new $Int64(1776978905, 1001252870), new $Int64(1468772157, 2026725874), new $Int64(857254202, 2137562569), new $Int64(765939740, 3183366709), new $Int64(1533887628, 2612072960), new $Int64(56977098, 1727148468), new $Int64(949899753, 3803658212), new $Int64(1883670356, 479946959), new $Int64(685713571, 1562982345), new $Int64(201241205, 1766109365), new $Int64(700596547, 3257093788), new $Int64(1962768719, 2365720207), new $Int64(93384808, 3742754173), new $Int64(1689098413, 2878193673), new $Int64(1096135042, 2174002182), new $Int64(1313222695, 3573511231), new $Int64(1392911121, 1760299077), new $Int64(771856457, 2260779833), new $Int64(1281464374, 1452805722), new $Int64(917811730, 2940011802), new $Int64(1890251082, 1886183802), new $Int64(893897673, 2514369088), new $Int64(1644345561, 3924317791), new $Int64(172616216, 500935732), new $Int64(1403501753, 676580929), new $Int64(581571365, 1184984890), new $Int64(1455515235, 1271474274), new $Int64(318728910, 3163791473), new $Int64(2051027584, 2842487377), new $Int64(1511537551, 2170968612), new $Int64(573262976, 3535856740), new $Int64(94256461, 1488599718), new $Int64(966951817, 3408913763), new $Int64(60951736, 2501050084), new $Int64(1272353200, 1639124157), new $Int64(138001144, 4088176393), new $Int64(1574896563, 3989947576), new $Int64(1982239940, 3414355209), new $Int64(1355154361, 2275136352), new $Int64(89709303, 2151835223), new $Int64(1216338715, 1654534827), new $Int64(1467562197, 377892833), new $Int64(1664767638, 660204544), new $Int64(85706799, 390828249), new $Int64(725310955, 3402783878), new $Int64(678849488, 3717936603), new $Int64(1113532086, 2211058823), new $Int64(1564224320, 2692150867), new $Int64(1952770442, 1928910388), new $Int64(788716862, 3931011137), new $Int64(1083670504, 1112701047), new $Int64(2079333076, 2452299106), new $Int64(1251318826, 2337204777), new $Int64(1774877857, 273889282), new $Int64(1798719843, 1462008793), new $Int64(2138834788, 1554494002), new $Int64(952516517, 182675323), new $Int64(548928884, 1882802136), new $Int64(589279648, 3700220025), new $Int64(381039426, 3083431543), new $Int64(1295624457, 3622207527), new $Int64(338126939, 432729309), new $Int64(480013522, 2391914317), new $Int64(297925497, 235747924), new $Int64(2120733629, 3088823825), new $Int64(1402403853, 2314658321), new $Int64(1165929723, 2957634338), new $Int64(501323675, 4117056981), new $Int64(1564699815, 1482500298), new $Int64(1406657158, 840489337), new $Int64(799522364, 3483178565), new $Int64(532129761, 2074004656), new $Int64(724246478, 3643392642), new $Int64(1482330167, 1583624461), new $Int64(1261660694, 287473085), new $Int64(1667835381, 3136843981), new $Int64(1138806821, 1266970974), new $Int64(135185781, 1998688839), new $Int64(392094735, 1492900209), new $Int64(1031326774, 1538112737), new $Int64(76914806, 2207265429), new $Int64(260686035, 963263315), new $Int64(1671145500, 2295892134), new $Int64(1068469660, 2002560897), new $Int64(1791233343, 1369254035), new $Int64(33436120, 3353312708), new $Int64(57507843, 947771099), new $Int64(201728503, 1747061399), new $Int64(1507240140, 2047354631), new $Int64(720000810, 4165367136), new $Int64(479265078, 3388864963), new $Int64(1195302398, 286492130), new $Int64(2045622690, 2795735007), new $Int64(1431753082, 3703961339), new $Int64(1999047161, 1797825479), new $Int64(1429039600, 1116589674), new $Int64(482063550, 2593309206), new $Int64(1329049334, 3404995677), new $Int64(1396904208, 3453462936), new $Int64(1014767077, 3016498634), new $Int64(75698599, 1650371545), new $Int64(1592007860, 212344364), new $Int64(1127766888, 3843932156), new $Int64(1399463792, 3573129983), new $Int64(1256901817, 665897820), new $Int64(1071492673, 1675628772), new $Int64(243225682, 2831752928), new $Int64(2120298836, 1486294219), new $Int64(193076235, 268782709), new $Int64(1145360145, 4186179080), new $Int64(624342951, 1613720397), new $Int64(857179861, 2703686015), new $Int64(1235864944, 2205342611), new $Int64(1474779655, 1411666394), new $Int64(619028749, 677744900), new $Int64(270855115, 4172867247), new $Int64(135494707, 2163418403), new $Int64(849547544, 2841526879), new $Int64(1029966689, 1082141470), new $Int64(377371856, 4046134367), new $Int64(51415528, 2142943655), new $Int64(1897659315, 3124627521), new $Int64(998228909, 219992939), new $Int64(1068692697, 1756846531), new $Int64(1283749206, 1225118210), new $Int64(1621625642, 1647770243), new $Int64(111523943, 444807907), new $Int64(2036369448, 3952076173), new $Int64(53201823, 1461839639), new $Int64(315761893, 3699250910), new $Int64(702974850, 1373688981), new $Int64(734022261, 147523747), new $Int64(100152742, 1211276581), new $Int64(1294440951, 2548832680), new $Int64(1144696256, 1995631888), new $Int64(154500578, 2011457303), new $Int64(796460974, 3057425772), new $Int64(667839456, 81484597), new $Int64(465502760, 3646681560), new $Int64(775020923, 635548515), new $Int64(602489502, 2508044581), new $Int64(353263531, 1014917157), new $Int64(719992433, 3214891315), new $Int64(852684611, 959582252), new $Int64(226415134, 3347040449), new $Int64(1784615552, 4102971975), new $Int64(397887437, 4078022210), new $Int64(1610679822, 2851767182), new $Int64(749162636, 1540160644), new $Int64(598384772, 1057290595), new $Int64(2034890660, 3907769253), new $Int64(579300318, 4248952684), new $Int64(1092907599, 132554364), new $Int64(1061621234, 1029351092), new $Int64(697840928, 2583007416), new $Int64(298619124, 1486185789), new $Int64(55905697, 2871589073), new $Int64(2017643612, 723203291), new $Int64(146250550, 2494333952), new $Int64(1064490251, 2230939180), new $Int64(342915576, 3943232912), new $Int64(1768732449, 2181367922), new $Int64(1418222537, 2889274791), new $Int64(1824032949, 2046728161), new $Int64(1653899792, 1376052477), new $Int64(1022327048, 381236993), new $Int64(1034385958, 3188942166), new $Int64(2073003539, 350070824), new $Int64(144881592, 61758415), new $Int64(1405659422, 3492950336), new $Int64(117440928, 3093818430), new $Int64(1693893113, 2962480613), new $Int64(235432940, 3154871160), new $Int64(511005079, 3228564679), new $Int64(610731502, 888276216), new $Int64(1200780674, 3574998604), new $Int64(870415268, 1967526716), new $Int64(591335707, 1554691298), new $Int64(574459414, 339944798), new $Int64(1223764147, 1154515356), new $Int64(1825645307, 967516237), new $Int64(1546195135, 596588202), new $Int64(279882768, 3764362170), new $Int64(492091056, 266611402), new $Int64(1754227768, 2047856075), new $Int64(1146757215, 21444105), new $Int64(1198058894, 3065563181), new $Int64(1915064845, 1140663212), new $Int64(633187674, 2323741028), new $Int64(2126290159, 3103873707), new $Int64(1008658319, 2766828349), new $Int64(1661896145, 1970872996), new $Int64(1628585413, 3766615585), new $Int64(1552335120, 2036813414), new $Int64(152606527, 3105536507), new $Int64(13954645, 3396176938), new $Int64(1426081645, 1377154485), new $Int64(2085644467, 3807014186), new $Int64(543009040, 3710110597), new $Int64(396058129, 916420443), new $Int64(734556788, 2103831255), new $Int64(381322154, 717331943), new $Int64(572884752, 3550505941), new $Int64(45939673, 378749927), new $Int64(149867929, 611017331), new $Int64(592130075, 758907650), new $Int64(1012992349, 154266815), new $Int64(1107028706, 1407468696), new $Int64(469292398, 970098704), new $Int64(1862426162, 1971660656), new $Int64(998365243, 3332747885), new $Int64(1947089649, 1935189867), new $Int64(1510248801, 203520055), new $Int64(842317902, 3916463034), new $Int64(1758884993, 3474113316), new $Int64(1036101639, 316544223), new $Int64(373738757, 1650844677), new $Int64(1240292229, 4267565603), new $Int64(1077208624, 2501167616), new $Int64(626831785, 3929401789), new $Int64(56122796, 337170252), new $Int64(1186981558, 2061966842), new $Int64(1843292800, 2508461464), new $Int64(206012532, 2791377107), new $Int64(1240791848, 1227227588), new $Int64(1813978778, 1709681848), new $Int64(1153692192, 3768820575), new $Int64(1145186199, 2887126398), new $Int64(700372314, 296561685), new $Int64(700300844, 3729960077), new $Int64(575172304, 372833036), new $Int64(2078875613, 2409779288), new $Int64(1829161290, 555274064), new $Int64(1041887929, 4239804901), new $Int64(1839403216, 3723486978), new $Int64(498390553, 2145871984), new $Int64(564717933, 3565480803), new $Int64(578829821, 2197313814), new $Int64(974785092, 3613674566), new $Int64(438638731, 3042093666), new $Int64(2050927384, 3324034321), new $Int64(869420878, 3708873369), new $Int64(946682149, 1698090092), new $Int64(1618900382, 4213940712), new $Int64(304003901, 2087477361), new $Int64(381315848, 2407950639), new $Int64(851258090, 3942568569), new $Int64(923583198, 4088074412), new $Int64(723260036, 2964773675), new $Int64(1473561819, 1539178386), new $Int64(1062961552, 2694849566), new $Int64(460977733, 2120273838), new $Int64(542912908, 2484608657), new $Int64(880846449, 2956190677), new $Int64(1970902366, 4223313749), new $Int64(662161910, 3502682327), new $Int64(705634754, 4133891139), new $Int64(1116124348, 1166449596), new $Int64(1038247601, 3362705993), new $Int64(93734798, 3892921029), new $Int64(1876124043, 786869787), new $Int64(1057490746, 1046342263), new $Int64(242763728, 493777327), new $Int64(1293910447, 3304827646), new $Int64(616460742, 125356352), new $Int64(499300063, 74094113), new $Int64(1351896723, 2500816079), new $Int64(1657235204, 514015239), new $Int64(1377565129, 543520454), new $Int64(107706923, 3614531153), new $Int64(2056746300, 2356753985), new $Int64(1390062617, 2018141668), new $Int64(131272971, 2087974891), new $Int64(644556607, 3166972343), new $Int64(372256200, 1517638666), new $Int64(1212207984, 173466846), new $Int64(1451709187, 4241513471), new $Int64(733932806, 2783126920), new $Int64(1972004134, 4167264826), new $Int64(29260506, 3907395640), new $Int64(1236582087, 1539634186), new $Int64(1551526350, 178241987), new $Int64(2034206012, 182168164), new $Int64(1044953189, 2386154934), new $Int64(1379126408, 4077374341), new $Int64(32803926, 1732699140), new $Int64(1726425903, 1041306002), new $Int64(1860414813, 2068001749), new $Int64(1005320202, 3208962910), new $Int64(844054010, 697710380), new $Int64(638124245, 2228431183), new $Int64(1337169671, 3554678728), new $Int64(1396494601, 173470263), new $Int64(2061597383, 3848297795), new $Int64(1220546671, 246236185), new $Int64(163293187, 2066374846), new $Int64(1771673660, 312890749), new $Int64(703378057, 3573310289), new $Int64(1548631747, 143166754), new $Int64(613554316, 2081511079), new $Int64(1197802104, 486038032), new $Int64(240999859, 2982218564), new $Int64(364901986, 1000939191), new $Int64(1902782651, 2750454885), new $Int64(1475638791, 3375313137), new $Int64(503615608, 881302957), new $Int64(638698903, 2514186393), new $Int64(443860803, 360024739), new $Int64(1399671872, 292500025), new $Int64(1381210821, 2276300752), new $Int64(521803381, 4069087683), new $Int64(208500981, 1637778212), new $Int64(720490469, 1676670893), new $Int64(1067262482, 3855174429), new $Int64(2114075974, 2067248671), new $Int64(2058057389, 2884561259), new $Int64(1341742553, 2456511185), new $Int64(983726246, 561175414), new $Int64(427994085, 432588903), new $Int64(885133709, 4059399550), new $Int64(2054387382, 1075014784), new $Int64(413651020, 2728058415), new $Int64(1839142064, 1299703678), new $Int64(1262333188, 2347583393), new $Int64(1285481956, 2468164145), new $Int64(989129637, 1140014346), new $Int64(2033889184, 1936972070), new $Int64(409904655, 3870530098), new $Int64(1662989391, 1717789158), new $Int64(1914486492, 1153452491), new $Int64(1157059232, 3948827651), new $Int64(790338018, 2101413152), new $Int64(1495744672, 3854091229), new $Int64(83644069, 4215565463), new $Int64(762206335, 1202710438), new $Int64(1582574611, 2072216740), new $Int64(705690639, 2066751068), new $Int64(33900336, 173902580), new $Int64(1405499842, 142459001), new $Int64(172391592, 1889151926), new $Int64(1648540523, 3034199774), new $Int64(1618587731, 516490102), new $Int64(93114264, 3692577783), new $Int64(68662295, 2953948865), new $Int64(1826544975, 4041040923), new $Int64(204965672, 592046130), new $Int64(1441840008, 384297211), new $Int64(95834184, 265863924), new $Int64(2101717619, 1333136237), new $Int64(1499611781, 1406273556), new $Int64(1074670496, 426305476), new $Int64(125704633, 2750898176), new $Int64(488068495, 1633944332), new $Int64(2037723464, 3236349343), new $Int64(444060402, 4013676611), new $Int64(1718532237, 2265047407), new $Int64(1433593806, 875071080), new $Int64(1804436145, 1418843655), new $Int64(2009228711, 451657300), new $Int64(1229446621, 1866374663), new $Int64(1653472867, 1551455622), new $Int64(577191481, 3560962459), new $Int64(1669204077, 3347903778), new $Int64(1849156454, 2675874918), new $Int64(316128071, 2762991672), new $Int64(530492383, 3689068477), new $Int64(844089962, 4071997905), new $Int64(1508155730, 1381702441), new $Int64(2089931018, 2373284878), new $Int64(1283216186, 2143983064), new $Int64(308739063, 1938207195), new $Int64(1754949306, 1188152253), new $Int64(1272345009, 615870490), new $Int64(742653194, 2662252621), new $Int64(1477718295, 3839976789), new $Int64(56149435, 306752547), new $Int64(720795581, 2162363077), new $Int64(2090431015, 2767224719), new $Int64(675859549, 2628837712), new $Int64(1678405918, 2967771969), new $Int64(1694285728, 499792248), new $Int64(403352367, 4285253508), new $Int64(962357072, 2856511070), new $Int64(679471692, 2526409716), new $Int64(353777175, 1240875658), new $Int64(1232590226, 2577342868), new $Int64(1146185433, 4136853496), new $Int64(670368674, 2403540137), new $Int64(1372824515, 1371410668), new $Int64(1970921600, 371758825), new $Int64(1706420536, 1528834084), new $Int64(2075795018, 1504757260), new $Int64(685663576, 699052551), new $Int64(1641940109, 3347789870), new $Int64(1951619734, 3430604759), new $Int64(2119672219, 1935601723), new $Int64(966789690, 834676166)]);
		globalRand = New(new lockedSource.ptr(new nosync.Mutex.ptr(false), NewSource(new $Int64(0, 1))));
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, js, rbush, math, rand, time, Tree, rectT, ptrType, sliceType, funcType, ptrType$1, ptrType$2, sliceType$1, sliceType$2, ptrType$3, funcType$1, ptrType$4, start, leafColor, colors, pad, main, itoa, ftoa, NewTree, genRandomData, consoleTime, consoleTimeEnd;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	rbush = $packages["github.com/tidwall/rbush"];
	math = $packages["math"];
	rand = $packages["math/rand"];
	time = $packages["time"];
	Tree = $pkg.Tree = $newType(0, $kindStruct, "main.Tree", true, "main", true, function(tr_, data_, parent_, canvas_, width_, height_, ratio_, ctx_, rects_, ts_, dirty_, linkover_, Clicked_, showWireframes_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.tr = ptrType$1.nil;
			this.data = sliceType$1.nil;
			this.parent = null;
			this.canvas = null;
			this.width = 0;
			this.height = 0;
			this.ratio = 0;
			this.ctx = null;
			this.rects = sliceType$2.nil;
			this.ts = 0;
			this.dirty = false;
			this.linkover = false;
			this.Clicked = $throwNilPointerError;
			this.showWireframes = false;
			return;
		}
		this.tr = tr_;
		this.data = data_;
		this.parent = parent_;
		this.canvas = canvas_;
		this.width = width_;
		this.height = height_;
		this.ratio = ratio_;
		this.ctx = ctx_;
		this.rects = rects_;
		this.ts = ts_;
		this.dirty = dirty_;
		this.linkover = linkover_;
		this.Clicked = Clicked_;
		this.showWireframes = showWireframes_;
	});
	rectT = $pkg.rectT = $newType(0, $kindStruct, "main.rectT", true, "main", false, function(color_, stroke_, node_, ts_, dur_, backwards_, loop_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.color = "";
			this.stroke = 0;
			this.node = ptrType$2.nil;
			this.ts = 0;
			this.dur = 0;
			this.backwards = false;
			this.loop = 0;
			return;
		}
		this.color = color_;
		this.stroke = stroke_;
		this.node = node_;
		this.ts = ts_;
		this.dur = dur_;
		this.backwards = backwards_;
		this.loop = loop_;
	});
	ptrType = $ptrType(time.Location);
	sliceType = $sliceType($String);
	funcType = $funcType([], [], false);
	ptrType$1 = $ptrType(rbush.RBush);
	ptrType$2 = $ptrType(rbush.Node);
	sliceType$1 = $sliceType(ptrType$2);
	sliceType$2 = $sliceType(rectT);
	ptrType$3 = $ptrType(js.Object);
	funcType$1 = $funcType([ptrType$3], [], false);
	ptrType$4 = $ptrType(Tree);
	main = function() {
		var $ptr, sheet;
		sheet = $global.document.createElement($externalize("style", $String));
		sheet.innerHTML = $externalize("html, body { \n\t\t\tpadding:0; margin:0; border:0; width:100%; height:100%; overflow:hidden;\n\t\t}\n\t\thtml{\n\t\t\tbackground: black;\n\t\t}", $String);
		$global.document.head.appendChild(sheet);
		$global.document.title = $externalize("uh huh", $String);
		$global.addEventListener($externalize("load", $String), $externalize((function $b() {
			var $ptr, _r, cover, tree, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; cover = $f.cover; tree = $f.tree; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			tree = [tree];
			cover = $global.document.createElement($externalize("div", $String));
			cover.style.height = $externalize("100%", $String);
			cover.style.width = $externalize("100%", $String);
			cover.style[$externalize("background-image", $String)] = $externalize("radial-gradient(ellipse farthest-corner at 45px 45px , #00FFFF 0%, rgba(0, 0, 255, 0) 50%, #0000FF 95%)", $String);
			cover.style.opacity = $externalize("0.15", $String);
			cover.style.position = $externalize("absolute", $String);
			$global.document.body.appendChild(cover);
			_r = NewTree($global.document.body); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			tree[0] = _r;
			$global.addEventListener($externalize("resize", $String), $externalize((function(tree) { return function() {
				var $ptr;
				tree[0].layout();
			}; })(tree), funcType));
			$s = -1; return;
			return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f.cover = cover; $f.tree = tree; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType));
	};
	itoa = function(i) {
		var $ptr, i;
		return $internalize(new ($global.String)(i), $String);
	};
	ftoa = function(f) {
		var $ptr, f;
		return $internalize(new ($global.String)(f), $String);
	};
	NewTree = function(parent) {
		var $ptr, parent, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; parent = $f.parent; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = new Tree.ptr(rbush.New(16), sliceType$1.nil, parent, null, 0, 0, 0, null, sliceType$2.nil, 0, true, false, $throwNilPointerError, false);
		$r = t.genBulkInsert(7500, 30); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		t.rects = t.buildRects(sliceType$2.nil, t.tr.Data, 0);
		t.start();
		$s = -1; return t;
		return t;
		/* */ } return; } if ($f === undefined) { $f = { $blk: NewTree }; } $f.$ptr = $ptr; $f.parent = parent; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.NewTree = NewTree;
	Tree.ptr.prototype.start = function() {
		var $ptr, _i, _ref, f, raf, s, t, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		t = this;
		raf = "";
		_ref = new sliceType(["requestAnimationFrame", "webkitRequestAnimationFrame", "mozRequestAnimationFrame"]);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (!($global[$externalize(s, $String)] === undefined)) {
				raf = s;
				break;
			}
			_i++;
		}
		if (raf === "") {
			$panic(new $String("requestAnimationFrame is not available"));
		}
		$deferred.push([$methodVal(t, "layout"), []]);
		f = $throwNilPointerError;
		f = (function $b(timestampJS) {
			var $ptr, timestampJS, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; timestampJS = $f.timestampJS; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$global[$externalize(raf, $String)]($externalize(f, funcType$1));
			$r = t.loop($parseFloat(timestampJS) / 1000); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = -1; return;
			return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.timestampJS = timestampJS; $f.$s = $s; $f.$r = $r; return $f;
		});
		$global[$externalize(raf, $String)]($externalize(f, funcType$1));
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); }
	};
	Tree.prototype.start = function() { return this.$val.start(); };
	Tree.ptr.prototype.genBulkInsert = function(K, M) {
		var $ptr, K, M, _r, data2, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; K = $f.K; M = $f.M; _r = $f._r; data2 = $f.data2; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r = genRandomData(K); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		data2 = _r;
		consoleTime("bulk-insert " + itoa(K) + " items");
		$r = t.tr.Load(data2); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		consoleTimeEnd("bulk-insert " + itoa(K) + " items");
		t.data = $appendSlice(t.data, data2);
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Tree.ptr.prototype.genBulkInsert }; } $f.$ptr = $ptr; $f.K = K; $f.M = M; $f._r = _r; $f.data2 = data2; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Tree.prototype.genBulkInsert = function(K, M) { return this.$val.genBulkInsert(K, M); };
	genRandomData = function(N) {
		var $ptr, N, _r, _r$1, _r$2, _r$3, data, h, i, w, x, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; N = $f.N; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; data = $f.data; h = $f.h; i = $f.i; w = $f.w; x = $f.x; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = rand.Seed(time.Now().UnixNano()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		data = sliceType$1.nil;
		i = 0;
		/* while (true) { */ case 2:
			/* if (!(i < N)) { break; } */ if(!(i < N)) { $s = 3; continue; }
			_r = rand.Float64(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			w = 1 * _r;
			_r$1 = rand.Float64(); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			h = 1 * _r$1;
			_r$2 = rand.Float64(); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			x = (1000 - w) * _r$2;
			_r$3 = rand.Float64(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			y = (1000 - w) * _r$3;
			data = $append(data, new rbush.Node.ptr(x, y, x + w, y + h, sliceType$1.nil, 0, false, new $Bool(true)));
			i = i + (1) >> 0;
		/* } */ $s = 2; continue; case 3:
		$s = -1; return data;
		return data;
		/* */ } return; } if ($f === undefined) { $f = { $blk: genRandomData }; } $f.$ptr = $ptr; $f.N = N; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f.data = data; $f.h = h; $f.i = i; $f.w = w; $f.x = x; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	consoleTime = function(s) {
		var $ptr, s;
		time.Time.copy(start, time.Now());
	};
	consoleTimeEnd = function(s) {
		var $ptr, end, s, x;
		end = time.Since(start);
		console.log(s + ": " + itoa(((x = $div64(end, new time.Duration(0, 1000000), false), x.$low + ((x.$high >> 31) * 4294967296)) >> 0)) + "ms");
	};
	Tree.ptr.prototype.layout = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, height, ratio, t, width;
		t = this;
		ratio = $parseFloat($global.devicePixelRatio);
		width = $parseFloat(t.parent.offsetWidth) * ratio;
		height = $parseFloat(t.parent.offsetHeight) * ratio;
		if (!(t.canvas === null) && (t.width === width) && (t.height === height) && (t.ratio === ratio)) {
			return;
		}
		_tmp = width;
		_tmp$1 = height;
		_tmp$2 = ratio;
		t.width = _tmp;
		t.height = _tmp$1;
		t.ratio = _tmp$2;
		if (!(t.canvas === null)) {
			t.parent.removeChild(t.canvas);
		}
		t.canvas = $global.document.createElement($externalize("canvas", $String));
		t.ctx = t.canvas.getContext($externalize("2d", $String));
		t.canvas.width = t.width;
		t.canvas.height = t.height;
		t.canvas.style.width = $externalize(ftoa(t.width / t.ratio) + "px", $String);
		t.canvas.style.height = $externalize(ftoa(t.height / t.ratio) + "px", $String);
		t.canvas.style.position = $externalize("absolute", $String);
		t.parent.appendChild(t.canvas);
		t.canvas.addEventListener($externalize("click", $String), $externalize((function $b(ev) {
			var $ptr, ev, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; ev = $f.ev; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			/* */ if (t.overLink($parseInt(ev.x) >> 0, $parseInt(ev.y) >> 0)) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (t.overLink($parseInt(ev.x) >> 0, $parseInt(ev.y) >> 0)) { */ case 1:
				$global.location = $externalize("http://github.com/tidwall/rbush", $String);
				$s = 3; continue;
			/* } else { */ case 2:
				/* */ if (!(t.Clicked === $throwNilPointerError)) { $s = 4; continue; }
				/* */ $s = 5; continue;
				/* if (!(t.Clicked === $throwNilPointerError)) { */ case 4:
					$r = t.Clicked(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 5:
			/* } */ case 3:
			$s = -1; return;
			return;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.ev = ev; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType$1));
		t.canvas.addEventListener($externalize("mousemove", $String), $externalize((function(ev) {
			var $ptr, ev;
			if (t.overLink($parseInt(ev.x) >> 0, $parseInt(ev.y) >> 0)) {
				t.canvas.style.cursor = $externalize("pointer", $String);
				t.linkover = true;
			} else {
				t.canvas.style.cursor = $externalize("default", $String);
				t.linkover = false;
			}
		}), funcType$1));
		t.Clicked = (function() {
			var $ptr;
			t.showWireframes = !t.showWireframes;
		});
		t.dirty = true;
	};
	Tree.prototype.layout = function() { return this.$val.layout(); };
	Tree.ptr.prototype.overLink = function(x, y) {
		var $ptr, t, x, y;
		t = this;
		return x > ((t.width / t.ratio >> 0) - 320 >> 0) && y > ((t.height / t.ratio >> 0) - 50 >> 0);
	};
	Tree.prototype.overLink = function(x, y) { return this.$val.overLink(x, y); };
	Tree.ptr.prototype.buildRects = function(rects, node, level) {
		var $ptr, _i, _r, _ref, child, level, node, rect, rects, t, x;
		t = this;
		if (node === ptrType$2.nil) {
			return rects;
		}
		rect = new rectT.ptr("", 0, ptrType$2.nil, 0, 0, false, 0);
		if (node.Leaf) {
			rect.color = leafColor;
			rect.stroke = 0.8;
		} else {
			if (level === 0) {
				rect.color = "grey";
			} else {
				rect.color = (x = (_r = ((node.Height - 1 >> 0)) % colors.$length, _r === _r ? _r : $throwRuntimeError("integer divide by zero")), ((x < 0 || x >= colors.$length) ? $throwRuntimeError("index out of range") : colors.$array[colors.$offset + x]));
			}
			if (level === 0) {
				rect.stroke = 0.2;
			} else {
				rect.stroke = 1 / math.Pow(level, 1);
			}
			rect.stroke = 0.8;
		}
		rect.node = node;
		rects = $append(rects, rect);
		if (node.Leaf) {
			return rects;
		}
		if (level === 6) {
			return rects;
		}
		_ref = node.Children;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			rects = t.buildRects(rects, child, level + 1 >> 0);
			_i++;
		}
		return rects;
	};
	Tree.prototype.buildRects = function(rects, node, level) { return this.$val.buildRects(rects, node, level); };
	Tree.ptr.prototype.tx = function(x) {
		var $ptr, t, x;
		t = this;
		if (t.width > t.height) {
			x = x / 1000 * (t.height - (pad * 2 * t.ratio));
		} else {
			x = x / 1000 * (t.width - (pad * 2 * t.ratio));
		}
		return x;
	};
	Tree.prototype.tx = function(x) { return this.$val.tx(x); };
	Tree.ptr.prototype.ty = function(y) {
		var $ptr, t, y;
		t = this;
		if (t.width > t.height) {
			y = y / 1000 * (t.height - (pad * 2 * t.ratio));
		} else {
			y = y / 1000 * (t.width - (pad * 2 * t.ratio));
		}
		return y;
	};
	Tree.prototype.ty = function(y) { return this.$val.ty(y); };
	Tree.ptr.prototype.draw = function() {
		var $ptr, _i, _r, _r$1, _ref, child, diff, h, i, opacity, rect, stroke, t, w, x, x$1, x$2, x$3, y, y$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; child = $f.child; diff = $f.diff; h = $f.h; i = $f.i; opacity = $f.opacity; rect = $f.rect; stroke = $f.stroke; t = $f.t; w = $f.w; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; y = $f.y; y$1 = $f.y$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!t.dirty) {
		}
		t.ctx.clearRect(0, 0, t.width, t.height);
		t.ctx.fillStyle = $externalize("rgba(0,128,255,0.05)", $String);
		stroke = 0;
		i = t.rects.$length - 1 >> 0;
		/* while (true) { */ case 1:
			/* if (!(i >= 0)) { break; } */ if(!(i >= 0)) { $s = 2; continue; }
			rect = $clone((x = t.rects, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])), rectT);
			opacity = 0;
			/* */ if (rect.node.Leaf) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (rect.node.Leaf) { */ case 3:
				/* */ if (rect.ts === 0) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (rect.ts === 0) { */ case 6:
					rect.ts = t.ts;
					/* */ if (rect.loop === 0) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (rect.loop === 0) { */ case 8:
						_r = rand.Float64(); /* */ $s = 11; case 11: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
						rect.dur = _r * 1 + 0.5;
						$s = 10; continue;
					/* } else { */ case 9:
						_r$1 = rand.Float64(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						rect.dur = _r$1 * 1 + 0.5;
					/* } */ case 10:
				/* } */ case 7:
				diff = t.ts - rect.ts;
				if (rect.backwards) {
					opacity = 1 - (diff / rect.dur);
					if (opacity < 0.5) {
						opacity = 0.5;
						rect.ts = 0;
						rect.backwards = !rect.backwards;
						rect.loop = rect.loop + (1) >> 0;
					}
				} else {
					opacity = diff / rect.dur;
					if (rect.loop > 0) {
						opacity = opacity * 0.5 + 0.5;
					}
					if (opacity > 1) {
						opacity = 1;
						rect.ts = 0;
						rect.backwards = !rect.backwards;
						rect.loop = rect.loop + (1) >> 0;
					}
				}
				$s = 5; continue;
			/* } else { */ case 4:
				if (t.showWireframes) {
					opacity = 1;
				}
			/* } */ case 5:
			x$1 = t.tx(rect.node.MinX);
			y = t.ty(rect.node.MinY);
			w = t.tx(rect.node.MaxX) - t.tx(rect.node.MinX);
			h = t.ty(rect.node.MaxY) - t.ty(rect.node.MinY);
			if (t.width > t.height) {
				x$1 = x$1 + (t.width / 2 - (t.height - pad * t.ratio) / 2 + pad / 2 * t.ratio);
				y = y + (pad * t.ratio);
			} else {
				x$1 = x$1 + (pad * t.ratio);
				y = y + (t.height / 2 - (t.width - pad * t.ratio) / 2 + pad / 2 * t.ratio);
			}
			t.ctx.strokeStyle = $externalize(rect.color + ftoa(opacity) + ")", $String);
			if (!((rect.stroke === stroke))) {
				t.ctx.lineWidth = rect.stroke * t.ratio;
				stroke = rect.stroke;
			}
			if (rect.node.Leaf) {
				if (t.showWireframes) {
					t.ctx.beginPath();
					_ref = rect.node.Children;
					_i = 0;
					while (true) {
						if (!(_i < _ref.$length)) { break; }
						child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
						x$2 = t.tx(child.MinX);
						y$1 = t.ty(child.MinY);
						if (t.width > t.height) {
							x$2 = x$2 + (t.width / 2 - (t.height - pad * t.ratio) / 2 + pad / 2 * t.ratio);
							y$1 = y$1 + (pad * t.ratio);
						} else {
							x$2 = x$2 + (pad * t.ratio);
							y$1 = y$1 + (t.height / 2 - (t.width - pad * t.ratio) / 2 + pad / 2 * t.ratio);
						}
						t.ctx.moveTo(x$2, y$1);
						t.ctx.arc(x$2, y$1, 1 * t.ratio, 0, 3.141592653589793, $externalize(false, $Bool));
						t.ctx.fill();
						_i++;
					}
				}
				t.strokeRect(x$1, y, w, h, 5 * t.ratio);
			} else {
				t.strokeRect(x$1, y, w, h, 1 * t.ratio);
			}
			rectT.copy((x$3 = t.rects, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i])), rect);
			i = i - (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		t.drawTitles();
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Tree.ptr.prototype.draw }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f.child = child; $f.diff = diff; $f.h = h; $f.i = i; $f.opacity = opacity; $f.rect = rect; $f.stroke = stroke; $f.t = t; $f.w = w; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.y = y; $f.y$1 = y$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Tree.prototype.draw = function() { return this.$val.draw(); };
	Tree.ptr.prototype.strokeRect = function(x, y, width, height, radius) {
		var $ptr, height, radius, t, width, x, y;
		t = this;
		if (radius * 2 > width) {
			radius = width / 2;
		}
		if (radius * 2 > height) {
			radius = height / 2;
		}
		t.ctx.beginPath();
		t.ctx.moveTo(x + radius, y);
		t.ctx.lineTo(x + width - radius, y);
		t.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		t.ctx.lineTo(x + width, y + height - radius);
		t.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		t.ctx.lineTo(x + radius, y + height);
		t.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		t.ctx.lineTo(x, y + radius);
		t.ctx.quadraticCurveTo(x, y, x + radius, y);
		t.ctx.closePath();
		t.ctx.stroke();
	};
	Tree.prototype.strokeRect = function(x, y, width, height, radius) { return this.$val.strokeRect(x, y, width, height, radius); };
	Tree.ptr.prototype.loop = function(dur) {
		var $ptr, dur, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; dur = $f.dur; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		t.ts = dur;
		$r = t.draw(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$s = -1; return;
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Tree.ptr.prototype.loop }; } $f.$ptr = $ptr; $f.dur = dur; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Tree.prototype.loop = function(dur) { return this.$val.loop(dur); };
	Tree.ptr.prototype.drawTitles = function() {
		var $ptr, t, y;
		t = this;
		y = 0;
		if (t.linkover) {
			y = t.drawTitle("github.com/tidwall/rbush", leafColor + "1.0)", 15 * t.ratio, y);
		} else {
			y = t.drawTitle("github.com/tidwall/rbush", leafColor + "0.7)", 15 * t.ratio, y);
		}
	};
	Tree.prototype.drawTitles = function() { return this.$val.drawTitles(); };
	Tree.ptr.prototype.drawTitle = function(text, color, fontSize, y) {
		var $ptr, color, fontSize, ny, pad$1, t, text, x, y;
		t = this;
		ny = y + (fontSize * 1.5);
		pad$1 = 15 * t.ratio;
		x = t.width - pad$1;
		y = t.height - pad$1 - y;
		t.ctx.save();
		t.ctx.font = $externalize(itoa((fontSize >> 0)) + "px Menlo, Consolas, Monospace, Helvetica, Arial, Sans-Serif", $String);
		t.ctx.textAlign = $externalize("right", $String);
		t.ctx.lineWidth = 0;
		t.ctx.shadowColor = $externalize(color, $String);
		t.ctx.shadowBlur = fontSize;
		t.ctx.fillStyle = $externalize(color, $String);
		t.ctx.fillText($externalize(text, $String), x, y);
		t.ctx.restore();
		return ny;
	};
	Tree.prototype.drawTitle = function(text, color, fontSize, y) { return this.$val.drawTitle(text, color, fontSize, y); };
	ptrType$4.methods = [{prop: "start", name: "start", pkg: "main", typ: $funcType([], [], false)}, {prop: "genBulkInsert", name: "genBulkInsert", pkg: "main", typ: $funcType([$Int, $Int], [], false)}, {prop: "layout", name: "layout", pkg: "main", typ: $funcType([], [], false)}, {prop: "overLink", name: "overLink", pkg: "main", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "buildRects", name: "buildRects", pkg: "main", typ: $funcType([sliceType$2, ptrType$2, $Int], [sliceType$2], false)}, {prop: "tx", name: "tx", pkg: "main", typ: $funcType([$Float64], [$Float64], false)}, {prop: "ty", name: "ty", pkg: "main", typ: $funcType([$Float64], [$Float64], false)}, {prop: "draw", name: "draw", pkg: "main", typ: $funcType([], [], false)}, {prop: "strokeRect", name: "strokeRect", pkg: "main", typ: $funcType([$Float64, $Float64, $Float64, $Float64, $Float64], [], false)}, {prop: "loop", name: "loop", pkg: "main", typ: $funcType([$Float64], [], false)}, {prop: "drawTitles", name: "drawTitles", pkg: "main", typ: $funcType([], [], false)}, {prop: "drawTitle", name: "drawTitle", pkg: "main", typ: $funcType([$String, $String, $Float64, $Float64], [$Float64], false)}];
	Tree.init("main", [{prop: "tr", name: "tr", exported: false, typ: ptrType$1, tag: ""}, {prop: "data", name: "data", exported: false, typ: sliceType$1, tag: ""}, {prop: "parent", name: "parent", exported: false, typ: ptrType$3, tag: ""}, {prop: "canvas", name: "canvas", exported: false, typ: ptrType$3, tag: ""}, {prop: "width", name: "width", exported: false, typ: $Float64, tag: ""}, {prop: "height", name: "height", exported: false, typ: $Float64, tag: ""}, {prop: "ratio", name: "ratio", exported: false, typ: $Float64, tag: ""}, {prop: "ctx", name: "ctx", exported: false, typ: ptrType$3, tag: ""}, {prop: "rects", name: "rects", exported: false, typ: sliceType$2, tag: ""}, {prop: "ts", name: "ts", exported: false, typ: $Float64, tag: ""}, {prop: "dirty", name: "dirty", exported: false, typ: $Bool, tag: ""}, {prop: "linkover", name: "linkover", exported: false, typ: $Bool, tag: ""}, {prop: "Clicked", name: "Clicked", exported: true, typ: funcType, tag: ""}, {prop: "showWireframes", name: "showWireframes", exported: false, typ: $Bool, tag: ""}]);
	rectT.init("main", [{prop: "color", name: "color", exported: false, typ: $String, tag: ""}, {prop: "stroke", name: "stroke", exported: false, typ: $Float64, tag: ""}, {prop: "node", name: "node", exported: false, typ: ptrType$2, tag: ""}, {prop: "ts", name: "ts", exported: false, typ: $Float64, tag: ""}, {prop: "dur", name: "dur", exported: false, typ: $Float64, tag: ""}, {prop: "backwards", name: "backwards", exported: false, typ: $Bool, tag: ""}, {prop: "loop", name: "loop", exported: false, typ: $Int, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = rbush.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = rand.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		start = new time.Time.ptr(new $Int64(0, 0), 0, ptrType.nil);
		leafColor = "rgba(200,39,33,";
		colors = new sliceType(["rgba(" + itoa(0) + "," + itoa(0) + "," + itoa(255) + ",", "rgba(" + itoa(255) + "," + itoa(0) + "," + itoa(255) + ","]);
		pad = 50;
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=goviz.js.map

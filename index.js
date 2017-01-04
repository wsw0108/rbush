'use strict';

module.exports = rbush;

var fs = require('fs');
var quickselect = require('quickselect');
eval(fs.readFileSync('md5.js') + '');
var md5 = global.md5;


function rbush(maxEntries, format) {
    if (!(this instanceof rbush)) return new rbush(maxEntries, format);

    // max entries in a node is 9 by default; min node fill is 40% for best performance
    this._maxEntries = Math.max(4, maxEntries || 9);
    this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));

    if (format) {
        this._initFormat(format);
    }

    this.clear();
}

rbush.prototype = {

    all: function () {
        return this._all(this.data, []);
    },

    search: function (bbox) {

        var node = this.data,
            result = [],
            toBBox = this.toBBox;

        if (!intersects(bbox, node)) return result;

        var nodesToSearch = [],
            i, len, child, childBBox;

        while (node) {
            for (i = 0, len = node.children.length; i < len; i++) {

                child = node.children[i];
                childBBox = node.leaf ? toBBox(child) : child;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf) result.push(child);
                    else if (contains(bbox, childBBox)) this._all(child, result);
                    else nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return result;
    },

    collides: function (bbox) {

        var node = this.data,
            toBBox = this.toBBox;

        if (!intersects(bbox, node)) return false;

        var nodesToSearch = [],
            i, len, child, childBBox;

        while (node) {
            for (i = 0, len = node.children.length; i < len; i++) {

                child = node.children[i];
                childBBox = node.leaf ? toBBox(child) : child;

                if (intersects(bbox, childBBox)) {
                    if (node.leaf || contains(bbox, childBBox)) return true;
                    nodesToSearch.push(child);
                }
            }
            node = nodesToSearch.pop();
        }

        return false;
    },

    load: function (data) {
        tp('load 1');

        if (!(data && data.length)) return this;
        tp('load 2: ' + data.length);
        if (data.length < this._minEntries) {
            tp('load 3');
            for (var i = 0, len = data.length; i < len; i++) {
                tp('load 4: ' + i);
                this.insert(data[i]);
            }
            tp('load 5');
            return this;
        }

        tp('load 6');
        // recursively build the tree with the given data from scratch using OMT algorithm
        var node = this._build(data.slice(), 0, data.length - 1, 0);
        tp('load 7: ' + nodeString(node));
		//if (true) throw new Error("?")
        if (!this.data.children.length) {
            tp('load 8');
            // save as is if tree is empty
            this.data = node;

        } else if (this.data.height === node.height) {
            tp('load 9');
            // split root if trees have the same height
            this._splitRoot(this.data, node);

        } else {
            tp('load 10');
            if (this.data.height < node.height) {
                tp('load 11');
                // swap trees if inserted one is bigger
                var tmpNode = this.data;
                this.data = node;
                node = tmpNode;
            }

            tp('load 12');
            // insert the small tree into the large tree at appropriate level
            this._insert(node, this.data.height - node.height - 1, true);
        }
        tp('load 13');

        for (var j = 0; j < node.children.length; j++) {
            tp('load 14: ' + j + ',' + nodeString(node.children[j]));
        }
        return this;
    },

    insert: function (item, t) {
        tp('insert 1: ' + nodeString(item));
        if (item) {
            tp('insert 2');
            this._insert(item, this.data.height - 1, false, t);
            tp('insert 3: ' + nodeString(this.data));
        }
        tp('insert 4: ' + nodeString(this.data));
        return this;
    },

    clear: function () {
        this.data = createNode([]);
        return this;
    },

    remove: function (item, equalsFn) {
        if (!item) return this;

        var node = this.data,
            bbox = this.toBBox(item),
            path = [],
            indexes = [],
            i, parent, index, goingUp;

        // depth-first iterative tree traversal
        while (node || path.length) {

            if (!node) { // go up
                node = path.pop();
                parent = path[path.length - 1];
                i = indexes.pop();
                goingUp = true;
            }

            if (node.leaf) { // check current node
                index = findItem(item, node.children, equalsFn);

                if (index !== -1) {
                    // item found, remove the item and condense tree upwards
                    node.children.splice(index, 1);
                    path.push(node);
                    this._condense(path);
                    return this;
                }
            }

            if (!goingUp && !node.leaf && contains(node, bbox)) { // go down
                path.push(node);
                indexes.push(i);
                i = 0;
                parent = node;
                node = node.children[0];

            } else if (parent) { // go right
                i++;
                node = parent.children[i];
                goingUp = false;

            } else node = null; // nothing found
        }

        return this;
    },

    toBBox: function (item) { return item; },

    compareMinX: compareNodeMinX,
    compareMinY: compareNodeMinY,

    toJSON: function () { return this.data; },

    fromJSON: function (data) {
        this.data = data;
        return this;
    },

    _all: function (node, result) {
        var nodesToSearch = [];
        while (node) {
            if (node.leaf) result.push.apply(result, node.children);
            else nodesToSearch.push.apply(nodesToSearch, node.children);

            node = nodesToSearch.pop();
        }
        return result;
    },

    _build: function (items, left, right, height) {
//tp("_build 1: "+items.length+","+left+","+right+","+height)
        var N = right - left + 1,
            M = this._maxEntries,
            node;

	//tp("_build 2: "+N+","+M)
        if (N <= M) {
			//tp("_build 3")
            // reached leaf level; return leaf
            node = createNode(items.slice(left, right + 1));
		//tp("_build 4: "+ nodeString(node))
            calcBBox(node, this.toBBox, this.t);
		//tp("_build 5: "+ nodeString(node))
            return node;
        }
	//tp("_build 6")
        if (!height) {
	//tp("_build 7")
            // target height of the bulk-loaded tree
            height = Math.ceil(Math.log(N) / Math.log(M));
		//tp("_build 8: "+ height)

            // target number of root entries to maximize storage utilization
            M = Math.ceil(N / Math.pow(M, height - 1));
			//tp("_build 9: "+ M)
        }

        node = createNode([]);
        node.leaf = false;
        node.height = height;
		//tp("_build 10: "+ nodeString(node))

        // split the items into M mostly square tiles

        var N2 = Math.ceil(N / M),
            N1 = N2 * Math.ceil(Math.sqrt(M)),
            i, j, right2, right3;
	//tp("_build 11: "+N1 + ","+N2)

        multiSelect(items, left, right, N1, this.compareMinX, this.t);
			//tp("_build 12: "+ nodeString(node))

        for (i = left; i <= right; i += N1) {

            right2 = Math.min(i + N1 - 1, right);
		//tp("_build 13: "+i+":"+right2)

            multiSelect(items, i, right2, N2, this.compareMinY, this.t);
//tp("_build 14")
            for (j = i; j <= right2; j += N2) {

                right3 = Math.min(j + N2 - 1, right2);
		//tp("_build 15: "+j+":"+right3+":"+items.length)

                // pack each entry recursively
                var child = this._build(items, j, right3, height - 1);
			//tp("_build 16: "+j+","+ nodeString(child))
                node.children.push(child);
            }
        }
//if (true) throw new Error("?")
	//tp("_build 17: "+ nodeString(node))
        calcBBox(node, this.toBBox, this.t);
	//tp("_build 18: "+ nodeString(node))

        return node;
    },

    _chooseSubtree: function (bbox, node, level, path) {

        var i, len, child, targetNode, area, enlargement, minArea, minEnlargement;

        while (true) {
            path.push(node);

            if (node.leaf || path.length - 1 === level) break;

            minArea = minEnlargement = Infinity;

            for (i = 0, len = node.children.length; i < len; i++) {
                child = node.children[i];
                area = bboxArea(child);
                enlargement = enlargedArea(bbox, child) - area;

                // choose entry with the least area enlargement
                if (enlargement < minEnlargement) {
                    minEnlargement = enlargement;
                    minArea = area < minArea ? area : minArea;
                    targetNode = child;

                } else if (enlargement === minEnlargement) {
                    // otherwise choose one with the smallest area
                    if (area < minArea) {
                        minArea = area;
                        targetNode = child;
                    }
                }
            }

            node = targetNode || node.children[0];
        }

        return node;
    },

    _insert: function (item, level, isNode, t) {
        tp('_insert 1: %v', nodeSum(item));
        tp('_insert 2: ' + level + ',' + isNode);
        var toBBox = this.toBBox,
            bbox = isNode ? item : toBBox(item),
            insertPath = [];

        // find the best node for accommodating the item, saving all nodes along the path too
        var node = this._chooseSubtree(bbox, this.data, level, insertPath);
        tp('_insert 3: %v', nodeSum(node));
        tp('_insert 4: %v,%v', insertPath.length, nodeString(node));
		// put the item into the node
        tp('_insert 5: %v', nodeJSONString(item));
        tp('_insert 6: %v', nodeJSONString(node));
        tp('_insert 7: %v', nodeJSONString(this.data));
        node.children.push(item);
        tp('_insert 8: %v', nodeJSONString(item));
        tp('_insert 9: %v', nodeJSONString(node));
        tp('_insert 10: %v', nodeJSONString(this.data));
        tp('_insert 11: ' + node.children.length);
        extend(node, bbox);
        //tp('_insert 4: ' + nodeJSONString(node))
        tp('_insert 12: %v', nodeJSONString(this.data));
        tp('_insert 13: ' + nodeString(node));

        // split on node overflow; propagate upwards if necessary
        while (level >= 0) {
            tp('_insert 14: ' + level + ',' + insertPath[level].children.length);
            if (insertPath[level].children.length > this._maxEntries) {
                tp('_insert 15: ' + nodeString(this.data));
                this._split(insertPath, level, t);
                tp('_insert 16: ' + nodeString(this.data));
                tp('_insert 17: ' + insertPath.length);
                level--;
            } else {
                tp('_insert 18: ' + nodeJSONString(this.data, 1));
                //tp('_insert 9: ' + nodeString(this.data));
                break;
            }
        }
        tp('_insert 19');
        // adjust bboxes along the insertion path
        this._adjustParentBBoxes(bbox, insertPath, level, t);
    },

    // split overflowed node into two
    _split: function (insertPath, level) {
        for (var j = 0; j < insertPath.length; j++) {
            tp('_split 1: %v,%v,%v', j, level, nodeString(insertPath[j]));
        }
        var node = insertPath[level],
            M = node.children.length,
            m = this._minEntries;

        tp('_split 2: ' + nodeString(node));
        tp('_split 3: ' + nodeString(this.data));
        this._chooseSplitAxis(node, m, M);
        tp('_split 4: ' + nodeString(node));
        tp('_split 5: ' + nodeString(this.data));
        tp('_split 6: ' + m + ',' + M);
        var splitIndex = this._chooseSplitIndex(node, m, M);
        tp('_split 7: ' + node.children.length + ',' + (splitIndex || 0) + ',' + (node.children.length - splitIndex));
        var spliced = node.children.splice(splitIndex, node.children.length - splitIndex);
        tp('_split 8: ' + spliced.length);
        var newNode = createNode(spliced);

        tp('_split 9: ' + nodeString(newNode));
        newNode.height = node.height;
        newNode.leaf = node.leaf;

        calcBBox(node, this.toBBox, this.t);
        calcBBox(newNode, this.toBBox, this.t);

        if (level) insertPath[level - 1].children.push(newNode);
        else this._splitRoot(node, newNode);
    },

    _splitRoot: function (node, newNode) {
        // split root node
        this.data = createNode([node, newNode]);
        this.data.height = node.height + 1;
        this.data.leaf = false;
        calcBBox(this.data, this.toBBox, this.t);
    },

    _chooseSplitIndex: function (node, m, M) {
        tp('_chooseSplitIndex 1: %v,%v', m, M);
        tp('_chooseSplitIndex 2: %v', nodeString(node));
        var i, bbox1, bbox2, overlap, area, minOverlap, minArea, index;

        minOverlap = minArea = Infinity;

        tp('_chooseSplitIndex 3: %v,%v', minOverlap, minArea);
        for (i = m; i <= M - m; i++) {
            tp('_chooseSplitIndex 4: %v', i);
            bbox1 = distBBox(node, 0, i, this.toBBox);
            tp('_chooseSplitIndex 5: %v', nodeString(bbox1));
            bbox2 = distBBox(node, i, M, this.toBBox);
            tp('_chooseSplitIndex 6: %v', nodeString(bbox2));

            overlap = intersectionArea(bbox1, bbox2);
            tp('_chooseSplitIndex 7: %v', overlap);
            area = bboxArea(bbox1) + bboxArea(bbox2);
            tp('_chooseSplitIndex 8: %v', area);

            // choose distribution with minimum overlap
            if (overlap < minOverlap) {
                tp('_chooseSplitIndex 9');
                minOverlap = overlap;
                index = i;
                minArea = area < minArea ? area : minArea;
                tp('_chooseSplitIndex 10: %v,%v,%v', minOverlap, index, area);

            } else if (overlap === minOverlap) {
                tp('_chooseSplitIndex 11');
                // otherwise choose distribution with minimum area
                if (area < minArea) {
                    minArea = area;
                    index = i;
                }
                tp('_chooseSplitIndex 12: %v,%v', minArea, index);
            }
        }
        tp('_chooseSplitIndex 13');

        return index;
    },

    // sorts node children by the best axis for split
    _chooseSplitAxis: function (node, m, M) {

        tp('_chooseSplitAxis 1: %v,%v', m, M);
        tp('_chooseSplitAxis 2: %v', nodeString(node));
        var compareMinX = node.leaf ? this.compareMinX : compareNodeMinX,
            compareMinY = node.leaf ? this.compareMinY : compareNodeMinY;
        var xMargin = this._allDistMargin(node, m, M, compareMinX);
        tp('_chooseSplitAxis 3: %v', xMargin);
        var yMargin = this._allDistMargin(node, m, M, compareMinY);
        tp('_chooseSplitAxis 4: %v', yMargin);
        // if total distributions margin value is minimal for x, sort by minX,
        // otherwise it's already sorted by minY
        if (xMargin < yMargin) {
            tp('_chooseSplitAxis 5');
            node.children.sort(compareMinX);
        }
    },

    // total margin of all possible split distributions where each node is at least m full
    _allDistMargin: function (node, m, M, compare) {
        tp('_allDistMargin 1: %v', nodeString(node));
        tp('_allDistMargin 2: %v,%v', m, M);

        for (var j = 0; j < node.children.length; j++) {
            tp('_allDistMargin A: %v,%v', j, nodeString(node.children[j]));
        }
        node.children.sort(compare);
        for (j = 0; j < node.children.length; j++) {
            tp('_allDistMargin B: %v,%v', j, nodeString(node.children[j]));
        }


        var toBBox = this.toBBox,
            leftBBox = distBBox(node, 0, m, toBBox),
            rightBBox = distBBox(node, M - m, M, toBBox),
            margin = bboxMargin(leftBBox) + bboxMargin(rightBBox),
            i, child;

        tp('_allDistMargin 3: %v', nodeString(leftBBox));
        tp('_allDistMargin 4: %v', nodeString(leftBBox));
        tp('_allDistMargin 5: %v', margin);
        for (i = m; i < M - m; i++) {
            tp('_allDistMargin 6: %v', i);
            child = node.children[i];
            extend(leftBBox, node.leaf ? toBBox(child) : child);
            margin += bboxMargin(leftBBox);
        }

        for (i = M - m - 1; i >= m; i--) {
            tp('_allDistMargin 7: %v', i);
            child = node.children[i];
            extend(rightBBox, node.leaf ? toBBox(child) : child);
            margin += bboxMargin(rightBBox);
        }
        tp('_allDistMargin 8: %v', margin);

        return margin;
    },

    _adjustParentBBoxes: function (bbox, path, level) {
        tp('_adjustParentBBoxes 1: %v', nodeString(this.data));
        tp('_adjustParentBBoxes 2: %v,%v,%v', nodeString(bbox), path.length, level);
        // adjust bboxes along the given tree path
        for (var i = level; i >= 0; i--) {
            tp('_adjustParentBBoxes 3: ' + i + ': ' + nodeString(path[i]));
            extend(path[i], bbox);
        }
        tp('_adjustParentBBoxes 4: ' + nodeString(this.data));
    },

    _condense: function (path) {
        // go through the path, removing empty nodes and updating bboxes
        for (var i = path.length - 1, siblings; i >= 0; i--) {
            if (path[i].children.length === 0) {
                if (i > 0) {
                    siblings = path[i - 1].children;
                    siblings.splice(siblings.indexOf(path[i]), 1);

                } else this.clear();

            } else calcBBox(path[i], this.toBBox, this.t);
        }
    },

    _initFormat: function (format) {
        // data format (minX, minY, maxX, maxY accessors)

        // uses eval-type function compilation instead of just accepting a toBBox function
        // because the algorithms are very sensitive to sorting functions performance,
        // so they should be dead simple and without inner calls

        var compareArr = ['return a', ' - b', ';'];

        this.compareMinX = new Function('a', 'b', compareArr.join(format[0]));
        this.compareMinY = new Function('a', 'b', compareArr.join(format[1]));

        this.toBBox = new Function('a',
            'return {minX: a' + format[0] +
            ', minY: a' + format[1] +
            ', maxX: a' + format[2] +
            ', maxY: a' + format[3] + '};');
    }
};

function findItem(item, items, equalsFn) {
    if (!equalsFn) return items.indexOf(item);

    for (var i = 0; i < items.length; i++) {
        if (equalsFn(item, items[i])) return i;
    }
    return -1;
}

// calculate node's bbox from bboxes of its children
function calcBBox(node, toBBox, t) {
//tp("calcBBox 1: "+nodeString(node))
    distBBox(node, 0, node.children.length, toBBox, node, t);
//tp("calcBBox 2: "+nodeString(node))
}

// min bounding rectangle of node children from k to p-1
function distBBox(node, k, p, toBBox, destNode) {
    tp('distBBox 1: %v,%v', k, p);
    tp('distBBox 2: %v', nodeString(node));
    tp('distBBox 3: %v', nodeString(destNode));
    if (!destNode) {
        tp('distBBox 4');
        destNode = createNode(null);
    }
    tp('distBBox 5');
    destNode.minX = Infinity;
    destNode.minY = Infinity;
    destNode.maxX = -Infinity;
    destNode.maxY = -Infinity;
    tp('distBBox 6: %v', nodeString(destNode));

    for (var i = k, child; i < p; i++) {
        child = node.children[i];
        tp('distBBox 7: %v,%v', i, nodeString(child));
        extend(destNode, node.leaf ? toBBox(child) : child);
        tp('distBBox 8: %v,%v', i, nodeString(destNode));
    }
    tp('distBBox 9: %v', nodeString(destNode));

    return destNode;
}

function extend(a, b) {
    a.minX = Math.min(a.minX, b.minX);
    a.minY = Math.min(a.minY, b.minY);
    a.maxX = Math.max(a.maxX, b.maxX);
    a.maxY = Math.max(a.maxY, b.maxY);
    return a;
}

function compareNodeMinX(a, b) { return a.minX - b.minX; }
function compareNodeMinY(a, b) { return a.minY - b.minY; }

function bboxArea(a)   { return (a.maxX - a.minX) * (a.maxY - a.minY); }
function bboxMargin(a) { return (a.maxX - a.minX) + (a.maxY - a.minY); }

function enlargedArea(a, b) {
    return (Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
           (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY));
}

function intersectionArea(a, b) {
    var minX = Math.max(a.minX, b.minX),
        minY = Math.max(a.minY, b.minY),
        maxX = Math.min(a.maxX, b.maxX),
        maxY = Math.min(a.maxY, b.maxY);

    return Math.max(0, maxX - minX) *
           Math.max(0, maxY - minY);
}

function contains(a, b) {
    return a.minX <= b.minX &&
           a.minY <= b.minY &&
           b.maxX <= a.maxX &&
           b.maxY <= a.maxY;
}

function intersects(a, b) {
    return b.minX <= a.maxX &&
           b.minY <= a.maxY &&
           b.maxX >= a.minX &&
           b.maxY >= a.minY;
}

function createNode(children) {
    return {
        children: children,
        height: 1,
        leaf: true,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach

function multiSelect(arr, left, right, n, compare) {
	//tp("_multiSelect 1: "+left+","+right+","+n)
    var stack = [left, right],
        mid;

    while (stack.length) {
        right = stack.pop();
        left = stack.pop();
//tp("_multiSelect 2: "+stack.length+","+right+","+left)
        if (right - left <= n) {
//tp("_multiSelect 3: "+stack.length)
            continue;
        }

        mid = left + Math.ceil((right - left) / n / 2) * n;
//tp("_multiSelect 4: "+stack.length+","+mid)
        quickselect(arr, mid, left, right, compare);

        stack.push(left, mid, mid, right);
    }
    if (false) {
        var nodes = arr;
        for (var i = 0; i < nodes.length; i++) {
            tp('_multiSelect 5: ' + i + ',' + nodeString(nodes[i]));
        }
    }
}

function count(node) {
    if (!node.children || !node.children.length) {
        return 1;
    }
    var n = 0;
    for (var i = 0; i < node.children.length; i++) {
        n += count(node.children[i]);
    }
    return n;
}
function nodeString(n) {
    if (!n) {
        return '<nil>';
    }
    var sum = nodeSum(n);
    return ('&{children:"' + (n.children || []).length + ':' + count(n) + '"' +
		' height:' + (n.height || 0) +
		' leaf:' + (n.leaf || false) +
		' minX:' + (n.minX || 0) +
		' minY:' + (n.minY || 0) +
		' maxX:' + (n.maxX || 0) +
		' maxY:' + (n.maxY || 0) +
		'}').split('inity').join('').split(':Inf').join(':+Inf') +
	' (' + sum.substring(sum.length - 7) + ')';
}

function appendNodeJSON(node, depth) {
    var s = '';
    if (!node) {
        return s + 'null';
    }
    s += '{';
    if (node.children && node.children.length) {
        s += '"children":[';
        for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            if (i > 0) {
                s += ',';
            }
            s += appendNodeJSON(child, depth + 1);
        }
        s += '],';
    }
    s += '"leaf":';
    if (node.leaf) {
        s += 'true';
    } else {
        s += 'false';
    }
    s += ',"height":' + (node.height || 0);
    s += ',"minX":' + cinf(node.minX || 0);
    s += ',"minY":' + cinf(node.minY || 0);
    s += ',"maxX":' + cinf(node.maxX || 0);
    s += ',"maxY":' + cinf(node.maxY || 0);
    s += '}';
    return s;
}

function cinf(arg) {
    if (!isNaN(arg)) {
        arg = arg + '';
        if (arg === 'Infinity') {
            arg = '+Inf';
        } else if (arg === '-Infinity') {
            arg = '-Inf';
        }
    }
    return arg;
}

function nodeJSONString(n) {
    return appendNodeJSON(n, 0);
}
function nodeSum(n) {
    return md5(nodeJSONString(n));
}

var tpon = false;

function tpsum(s) {
    var hash = md5(s);
    return hash.substring(hash.length - 4).toUpperCase();
}

function tp(s) {
    var t = global.tpt;
    if (!tpon) {
        return;
    }
    for (var i = 1; i < arguments.length; i++) {
        var idx = s.indexOf('%v');
        if (idx !== -1) {
            var arg = arguments[i];
            if (!isNaN(arg)) {
                arg = arg + '';
                if (arg === 'Infinity') {
                    arg = '+Inf';
                } else if (arg === '-Infinity') {
                    arg = '-Inf';
                }
            }
            s = s.substring(0, idx) + arg + s.substring(idx + 2);
        }
    }

    if (!t.tpc) {
        try {
            fs.unlinkSync('out.log');
        } catch (e) {
            if (false) return;
        }
        t.tpc = 0;
    }
    if (!t.tpall) {
        t.tpall = '';
    }
    var ln = '0000' + t.tpc;
    ln = ln.substring(ln.length - 4);
    t.tpall += s;
    var head = ln + ':' + tpsum(t.tpall) + ' ';
    var line = head + s;
    t.comment(line);
    fs.appendFileSync('out.log', line + '\n');
    t.tpc++;
}
global.tp = tp;


package rbush

import (
	"crypto/md5"
	"fmt"
	"io/ioutil"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
)

//(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.rbush = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
//'use strict';

//module.exports = rbush;

//var quickselect = require('quickselect');
const DefaultMaxEntries = 9

type nodeT struct {
	children   []*nodeT
	height     int
	leaf       bool
	minX, minY float64
	maxX, maxY float64
}

func (n *nodeT) MinX() float64 { return n.minX }
func (n *nodeT) MinY() float64 { return n.minY }
func (n *nodeT) MaxX() float64 { return n.maxX }
func (n *nodeT) MaxY() float64 { return n.maxY }

type RBush struct {
	_maxEntries int
	_minEntries int
	data        *nodeT
}

type bboxI interface {
	MinX() float64
	MinY() float64
	MaxX() float64
	MaxY() float64
}

type byMinX []*nodeT

func (arr byMinX) At(i int) interface{} {
	return arr[i]
}
func (arr byMinX) Compare(a, b interface{}) int {
	na, nb := a.(*nodeT), b.(*nodeT)
	if na.minX < nb.minX {
		return -1
	}
	if na.minX > nb.minX {
		return +1
	}
	return 0
}
func (arr byMinX) Less(i, j int) bool {
	return arr[i].minX < arr[j].minX
}

func (arr byMinX) Swap(i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}

func (arr byMinX) Len() int {
	return len(arr)
}

type byMinY []*nodeT

func (arr byMinY) At(i int) interface{} {
	return arr[i]
}
func (arr byMinY) Compare(a, b interface{}) int {
	na, nb := a.(*nodeT), b.(*nodeT)
	if na.minY < nb.minY {
		return -1
	}
	if na.minY > nb.minY {
		return +1
	}
	return 0
}
func (arr byMinY) Less(i, j int) bool {
	return arr[i].minY < arr[j].minY
}

func (arr byMinY) Swap(i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}

func (arr byMinY) Len() int {
	return len(arr)
}

//function rbush(maxEntries, format) {
func New(maxEntries int) *RBush {
	//    if (!(this instanceof rbush)) return new rbush(maxEntries, format);
	this := &RBush{}

	//    // max entries in a node is 9 by default; min node fill is 40% for best performance
	//    this._maxEntries = Math.max(4, maxEntries || 9)
	if maxEntries == 0 {
		maxEntries = DefaultMaxEntries
	}
	this._maxEntries = int(math.Max(4, float64(maxEntries)))
	//    this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));
	this._minEntries = int(math.Max(2, math.Ceil(float64(this._maxEntries)*0.4)))

	//    if format {
	//        this._initFormat(format)
	//    }

	this.clear()
	return this
}

//rbush.prototype = {

//    all: function () {
func (this *RBush) all() []*nodeT {
	//    return this._all(this.data, []);
	return this._all(this.data, nil)
	// }
}

//    search: function (bbox) {
func (this *RBush) search(bbox bboxI) []*nodeT {

	//        var node = this.data,
	var node = this.data
	//            result = [],
	var result []*nodeT
	//            toBBox = this.toBBox;

	//        if (!intersects(bbox, node)) return result;
	if !intersects(bbox, node) {
		return result
	}
	//        var nodesToSearch = [],
	var nodesToSearch []*nodeT
	//            i, len, child, childBBox;
	var i int
	var len_ int
	var child *nodeT
	var childBBox bboxI
	//        while (node) {
	for node != nil {
		//            for (i = 0, len = node.children.length; i < len; i++) {
		for i, len_ = 0, len(node.children); i < len_; i++ {
			//                child = node.children[i];
			child = node.children[i]
			//                childBBox = node.leaf ? toBBox(child) : child;
			childBBox = child
			//                if (intersects(bbox, childBBox)) {
			if intersects(bbox, childBBox) {
				//                    if (node.leaf) result.push(child);
				if node.leaf {
					result = append(result, child)
					//                    else if (contains(bbox, childBBox)) this._all(child, result);
				} else if contains(bbox, childBBox) {
					result = this._all(child, result)
					//                    else nodesToSearch.push(child);
				} else {
					nodesToSearch = append(nodesToSearch, child)
				}
				//            }
			}

		}
		//            node = nodesToSearch.pop();
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
		//        }
	}
	//    return result;
	return result
	//}
}

//    collides: function (bbox) {
func (this *RBush) collides(bbox bboxI) bool {
	//
	//        var node = this.data,
	node := this.data
	//            toBBox = this.toBBox;
	//
	//        if (!intersects(bbox, node)) return false;
	if !intersects(bbox, node) {
		return false
	}
	//
	//        var nodesToSearch = [],
	var nodesToSearch []*nodeT
	//            i, len, child, childBBox;
	var i int
	var len_ int
	var child *nodeT
	var childBBox bboxI
	//
	//        while (node) {
	for node != nil {
		//            for (i = 0, len = node.children.length; i < len; i++) {
		for i, len_ = 0, len(node.children); i < len_; i++ {
			//
			//                child = node.children[i];
			child = node.children[i]
			//                childBBox = node.leaf ? toBBox(child) : child;
			childBBox = child
			//
			//                if (intersects(bbox, childBBox)) {
			if intersects(bbox, childBBox) {
				//                    if (node.leaf || contains(bbox, childBBox)) return true;
				if node.leaf || contains(bbox, childBBox) {
					return true
				}
				//                    nodesToSearch.push(child);
				nodesToSearch = append(nodesToSearch, child)
				//                }
			}
			//            }
		}
		//            node = nodesToSearch.pop();
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
		//        }
	}
	//
	//        return false;
	return false
	//    },
}

//    load: function (data) {
func (this *RBush) load(data []*nodeT) *RBush {
	tp("load 1")
	//        if (!(data && data.length)) return this;
	if len(data) == 0 {
		return this
	}
	tp("load 2: %d", len(data))
	//
	//        if (data.length < this._minEntries) {
	if len(data) < this._minEntries {
		tp("load 3")
		//            for (var i = 0, len = data.length; i < len; i++) {
		for i, len_ := 0, len(data); i < len_; i++ {
			//                this.insert(data[i]);
			tp("load 4: %d", i)
			this.insert(data[i])
			//            }
		}
		//            return this;
		tp("load 5")
		return this
		//        }
	}
	tp("load 6")
	//        // recursively build the tree with the given data from scratch using OMT algorithm
	//        var node = this._build(data.slice(), 0, data.length - 1, 0);
	var node = this._build(ncopy(data), 0, len(data)-1, 0)
	tp("load 7: %s", nodeString(node))
	//os.Exit(0)
	//        if (!this.data.children.length) {
	if len(this.data.children) == 0 {
		tp("load 8")
		//            // save as is if tree is empty
		//            this.data = node;
		this.data = node
		//        } else if (this.data.height === node.height) {
	} else if this.data.height == node.height {
		tp("load 9")
		//            // split root if trees have the same height
		//            this._splitRoot(this.data, node);
		this._splitRoot(this.data, node)

		//        } else {
	} else {
		tp("load 10")
		//            if (this.data.height < node.height) {
		if this.data.height < node.height {
			tp("load 11")
			//                // swap trees if inserted one is bigger
			//                var tmpNode = this.data;
			//                this.data = node;
			//                node = tmpNode;
			this.data, node = node, this.data
			//            }
		}
		tp("load 12")

		//            // insert the small tree into the large tree at appropriate level
		//            this._insert(node, this.data.height - node.height - 1, true);
		this._insert(node, this.data.height-node.height-1, true)
		//        }
	}
	tp("load 13")
	for j := 0; j < len(node.children); j++ {
		tp("load 14: %d,%s", j, nodeString(node.children[j]))
	}
	//        return this;
	return this
	//    },
}

//    insert: function (item) {
func (this *RBush) insert(item *nodeT) *RBush {
	tp("insert 1: %s", nodeString(item))
	//        if (item) this._insert(item, this.data.height - 1);
	if item != nil {
		tp("insert 2")
		this._insert(item, this.data.height-1, false)
		tp("insert 3: %v", nodeString(this.data))
	}
	tp("insert 4: %v", nodeString(this.data))
	//        return this;
	return this
	//    },
}

//    clear: function () {
func (this *RBush) clear() *RBush {
	//        this.data = createNode([]);
	this.data = createNode(nil)
	//        return this;
	return this
	//    },
}

//    remove: function (item, equalsFn) {
func (this *RBush) remove(item *nodeT) *RBush {
	//        if (!item) return this;
	if item == nil {
		return this
	}
	//
	//        var node = this.data,
	var node = this.data
	//            bbox = this.toBBox(item),
	var bbox bboxI = item
	//            path = [],
	var path []*nodeT
	//            indexes = [],
	var indexes []int
	//            i, parent, index, goingUp;
	var i int
	var parent *nodeT
	var index int
	var goingUp bool
	//
	//        // depth-first iterative tree traversal
	//        while (node || path.length) {
	for node != nil || len(path) != 0 {
		//
		//            if (!node) { // go up
		if node == nil {
			//                node = path.pop();
			node = path[len(path)-1]
			path = path[:len(path)-1]
			//                parent = path[path.length - 1];
			if len(path) == 0 {
				parent = nil
			} else {
				parent = path[len(path)-1]
			}
			//                i = indexes.pop();
			i = indexes[len(indexes)-1]
			indexes = indexes[:len(indexes)-1]
			//                goingUp = true;
			goingUp = true
			//            }
		}
		//
		//            if (node.leaf) { // check current node
		if node.leaf {
			//                index = findItem(item, node.children, equalsFn);
			index = findItem(item, node.children)
			//
			//                if (index !== -1) {
			if index != -1 {
				//                    // item found, remove the item and condense tree upwards
				//                    node.children.splice(index, 1);
				//node.children = append(node.children[:index], node.children[index+1:]...)
				node.children, _ = splice(node.children, index, 1)
				//                    path.push(node);
				path = append(path, node)
				//                    this._condense(path);
				this._condense(path)
				//                    return this;
				return this
				//                }
			}
			//            }
		}
		//
		//            if (!goingUp && !node.leaf && contains(node, bbox)) { // go down
		if !goingUp && !node.leaf && contains(node, bbox) { // go down
			//                path.push(node);
			path = append(path, node)
			//                indexes.push(i);
			indexes = append(indexes, i)
			//                i = 0;
			i = 0
			//                parent = node;
			parent = node
			//                node = node.children[0];
			node = node.children[0]
			//
			//            } else if (parent) { // go right
		} else if parent != nil { // go right
			//                i++;
			i++
			//                node = parent.children[i];
			if i == len(parent.children) {
				node = nil
			} else {
				node = parent.children[i]
			}
			//                goingUp = false;
			goingUp = false
			//
			//            } else node = null; // nothing found
		} else {
			node = nil
		}
		//        }
	}
	//
	//        return this;
	return this
	//    },
}

/*BIG
    toBBox: function (item) { return item; },

    compareMinX: compareNodeMinX,
    compareMinY: compareNodeMinY,
BIG*/

//    toJSON: function () { return this.data; },
func (this *RBush) toJSON() *nodeT {
	return this.data
}

//
//    fromJSON: function (data) {
func (this *RBush) fromJSON(data *nodeT) *RBush {
	//        this.data = data;
	this.data = data
	//        return this;
	return this
	//    },
}

//    _all: function (node, result) {
func (this *RBush) _all(node *nodeT, result []*nodeT) []*nodeT {
	//        var nodesToSearch = [];
	var nodesToSearch []*nodeT
	//        while (node) {
	for node != nil {
		//            if (node.leaf) result.push.apply(result, node.children);
		if node.leaf {
			result = append(result, node.children...)
			//            else nodesToSearch.push.apply(nodesToSearch, node.children);
		} else {
			nodesToSearch = append(nodesToSearch, node.children...)
		}

		//            node = nodesToSearch.pop();
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
		//        }
	}
	//        return result;
	return result
	//    },
}

//    _build: function (items, left, right, height) {
func (this *RBush) _build(items []*nodeT, left, right, height int) *nodeT {
	//tp("_build 1: %d,%d,%d,%d", len(items), left, right, height)
	//
	//        var N = right - left + 1,
	var N = right - left + 1
	//            M = this._maxEntries,
	var M = this._maxEntries
	//            node;
	var node *nodeT
	//
	//        if (N <= M) {
	//tp("_build 2: %d,%d", N, M)
	if N <= M {
		//tp("_build 3")
		//            // reached leaf level; return leaf
		//            node = createNode(items.slice(left, right + 1));
		node = createNode(append([]*nodeT(nil), items[left:right+1]...))
		//tp("_build 4: %s", nodeString(node))
		//            calcBBox(node, this.toBBox);
		calcBBox(node)
		//tp("_build 5: %s", nodeString(node))
		//            return node;
		return node
		//        }
	}
	//tp("_build 6")
	//
	//        if (!height) {
	if height == 0 {
		//tp("_build 7")
		//            // target height of the bulk-loaded tree
		//            height = Math.ceil(Math.log(N) / Math.log(M));
		height = int(math.Ceil(math.Log(float64(N)) / math.Log(float64(M))))
		//tp("_build 8: %d", height)
		//
		//            // target number of root entries to maximize storage utilization
		//            M = Math.ceil(N / Math.pow(M, height - 1));
		M = int(math.Ceil(float64(N) / math.Pow(float64(M), float64(height)-1)))
		//tp("_build 9: %d", M)
		//        }
	}
	//
	//        node = createNode([]);
	node = createNode(nil)
	//        node.leaf = false;
	node.leaf = false
	//        node.height = height;
	node.height = height
	//tp("_build 10: %s", nodeString(node))
	//
	//        // split the items into M mostly square tiles
	//
	//        var N2 = Math.ceil(N / M),
	var N2 = int(math.Ceil(float64(N) / float64(M)))
	//            N1 = N2 * Math.ceil(Math.sqrt(M)),
	var N1 = N2 * int(math.Ceil(math.Sqrt(float64(M))))
	//            i, j, right2, right3;
	var i, j, right2, right3 int
	//tp("_build 11: %d,%d", N1, N2)
	//
	//        multiSelect(items, left, right, N1, this.compareMinX);
	multiSelect(byMinX(items), left, right, N1)
	//tp("_build 12: %s", nodeString(node))
	//os.Exit(0)
	//
	//        for (i = left; i <= right; i += N1) {
	for i = left; i <= right; i += N1 {
		//
		//            right2 = Math.min(i + N1 - 1, right);
		right2 = int(math.Min(float64(i+N1-1), float64(right)))
		//tp("_build 13: %d:%d", i, right2)
		//
		//            multiSelect(items, i, right2, N2, this.compareMinY);
		multiSelect(byMinY(items), i, right2, N2)
		//tp("_build 14")
		//
		//            for (j = i; j <= right2; j += N2) {
		for j = i; j <= right2; j += N2 {
			//
			//                right3 = Math.min(j + N2 - 1, right2);
			right3 = int(math.Min(float64(j+N2-1), float64(right2)))
			//tp("_build 15: %d:%d:%d", j, right3, len(items))
			//
			//                // pack each entry recursively
			//                node.children.push(this._build(items, j, right3, height - 1));
			child := this._build(items, j, right3, height-1)
			//tp("_build 16: %d: %s", j, nodeString(child))
			node.children = append(node.children, child)
			//            }
		}
		//        }
	}
	//
	//        calcBBox(node, this.toBBox);
	//tp("_build 17: %s", nodeString(node))
	calcBBox(node)
	//tp("_build 18: %s", nodeString(node))

	//
	//        return node;
	return node
	//    },
}

//    _chooseSubtree: function (bbox, node, level, path) {
func (this *RBush) _chooseSubtree(bbox bboxI, node *nodeT, level int, path []*nodeT) (
	*nodeT, []*nodeT,
) {
	//
	//        var i, len, child, targetNode, area, enlargement, minArea, minEnlargement;
	var i, len_ int
	var child, targetNode *nodeT
	var area, enlargement, minArea, minEnlargement float64
	//
	//        while (true) {
	for {
		//            path.push(node);
		path = append(path, node)
		//
		//            if (node.leaf || path.length - 1 === level) break;
		if node.leaf || len(path)-1 == level {
			break
		}
		//
		//            minArea = minEnlargement = Infinity;
		minEnlargement = math.Inf(+1)
		minArea = minEnlargement
		//
		//            for (i = 0, len = node.children.length; i < len; i++) {
		for i, len_ = 0, len(node.children); i < len_; i++ {
			//                child = node.children[i];
			child = node.children[i]
			//                area = bboxArea(child);
			area = bboxArea(child)
			//                enlargement = enlargedArea(bbox, child) - area;
			enlargement = enlargedArea(bbox, child) - area
			//
			//                // choose entry with the least area enlargement
			//                if (enlargement < minEnlargement) {
			if enlargement < minEnlargement {
				//                    minEnlargement = enlargement;
				minEnlargement = enlargement
				//                    minArea = area < minArea ? area : minArea;
				if area < minArea {
					minArea = area
				}
				//                    targetNode = child;
				targetNode = child
				//
				//                } else if (enlargement === minEnlargement) {
			} else if enlargement == minEnlargement {
				//                    // otherwise choose one with the smallest area
				//                    if (area < minArea) {
				if area < minArea {
					//                        minArea = area;
					minArea = area
					//                        targetNode = child;
					targetNode = child
					//                    }
				}
				//                }
			}
			//            }
		}
		//
		//            node = targetNode || node.children[0];
		if targetNode != nil {
			node = targetNode
		} else if len(node.children) > 0 {
			node = node.children[0]
		} else {
			node = nil
		}
		//        }
	}
	//
	//        return node;
	return node, path
	//    },
}

//    _insert: function (item, level, isNode) {
func (this *RBush) _insert(item *nodeT, level int, isNode bool) {
	tp("_insert 1: %v", nodeSum(item))
	tp("_insert 2: %v,%v", level, isNode)
	//
	//        var toBBox = this.toBBox,
	//            bbox = isNode ? item : toBBox(item),
	var bbox bboxI = item
	//            insertPath = [];
	var insertPath []*nodeT
	//
	//        // find the best node for accommodating the item, saving all nodes along the path too
	//        var node = this._chooseSubtree(bbox, this.data, level, insertPath);
	var node *nodeT
	node, insertPath = this._chooseSubtree(bbox, this.data, level, insertPath)
	tp("_insert 3: %v", nodeSum(node))
	tp("_insert 4: %v,%v", len(insertPath), nodeString(node))
	//
	//        // put the item into the node
	//        node.children.push(item);
	tp("_insert 5: %v", nodeJSONString(item))
	tp("_insert 6: %v", nodeJSONString(node))
	tp("_insert 7: %v", nodeJSONString(this.data))
	node.children = append(node.children, item)
	tp("_insert 8: %v", nodeJSONString(item))
	tp("_insert 9: %v", nodeJSONString(node))
	tp("_insert 10: %v", nodeJSONString(this.data))
	tp("_insert 11: %v", len(node.children))
	//        extend(node, bbox);
	extend(node, bbox)
	//tp("_insert 4: %v", nodeJSONString(node))
	tp("_insert 12: %v", nodeJSONString(this.data))
	tp("_insert 13: %v", nodeString(node))
	//
	//        // split on node overflow; propagate upwards if necessary
	//        while (level >= 0) {
	for level >= 0 {
		tp("_insert 14: %d,%d", level, len(insertPath[level].children))
		//            if (insertPath[level].children.length > this._maxEntries) {
		if len(insertPath[level].children) > this._maxEntries {
			tp("_insert 15: %v", nodeString(this.data))
			//                this._split(insertPath, level);
			insertPath = this._split(insertPath, level)
			tp("_insert 16: %v", nodeString(this.data))
			tp("_insert 17: %v", len(insertPath))
			//                level--;
			level--
			//            } else break;
		} else {
			tp("_insert 18: %v", nodeJSONString(this.data))
			//tp("_insert 9: %v", nodeString(this.data))
			break
		}
		//        }
	}
	tp("_insert 19")
	//
	//        // adjust bboxes along the insertion path
	//        this._adjustParentBBoxes(bbox, insertPath, level);
	this._adjustParentBBoxes(bbox, insertPath, level)
	//    },
}

//    // split overflowed node into two
//    _split: function (insertPath, level) {
func (this *RBush) _split(insertPath []*nodeT, level int) []*nodeT {
	for j := 0; j < len(insertPath); j++ {
		tp("_split 1: %v,%v,%v", j, level, nodeString(insertPath[j]))
	}
	//
	//        var node = insertPath[level],
	var node = insertPath[level]
	//            M = node.children.length,
	var M = len(node.children)
	//            m = this._minEntries;
	var m = this._minEntries
	//
	//        this._chooseSplitAxis(node, m, M);
	tp("_split 2: %v", nodeString(node))
	tp("_split 3: %v", nodeString(this.data))
	this._chooseSplitAxis(node, m, M)
	tp("_split 4: %v", nodeString(node))
	tp("_split 5: %v", nodeString(this.data))
	tp("_split 6: %v,%v", m, M)
	//
	//        var splitIndex = this._chooseSplitIndex(node, m, M);
	var splitIndex = this._chooseSplitIndex(node, m, M)
	tp("_split 7: %v,%v,%v", len(node.children), splitIndex, len(node.children)-splitIndex)
	//
	//        var newNode = createNode(node.children.splice(splitIndex, node.children.length - splitIndex));
	//spliced := append(node.children[:splitIndex], node.children[splitIndex+(len(node.children)-splitIndex):]...)
	var spliced []*nodeT
	node.children, spliced = splice(node.children, splitIndex, len(node.children)-splitIndex)
	tp("_split 8: %v", len(spliced))
	var newNode = createNode(spliced)
	tp("_split 9: %v", nodeString(newNode))
	//        newNode.height = node.height;
	newNode.height = node.height
	//        newNode.leaf = node.leaf;
	newNode.leaf = node.leaf
	//
	//        calcBBox(node, this.toBBox);
	calcBBox(node)
	//        calcBBox(newNode, this.toBBox);
	calcBBox(newNode)
	//
	//        if (level) insertPath[level - 1].children.push(newNode);
	if level != 0 {
		insertPath[level-1].children = append(ncopy(insertPath[level-1].children), newNode)
		//        else this._splitRoot(node, newNode);
	} else {
		this._splitRoot(node, newNode)
	}
	return insertPath
	//    },
}

//    _splitRoot: function (node, newNode) {
func (this *RBush) _splitRoot(node *nodeT, newNode *nodeT) {
	//        // split root node
	//        this.data = createNode([node, newNode]);
	this.data = createNode([]*nodeT{node, newNode})
	//        this.data.height = node.height + 1;
	this.data.height = node.height + 1
	//        this.data.leaf = false;
	this.data.leaf = false
	//        calcBBox(this.data, this.toBBox);
	calcBBox(this.data)
	//    },
}

//    _chooseSplitIndex: function (node, m, M) {
func (this *RBush) _chooseSplitIndex(node *nodeT, m, M int) int {
	tp("_chooseSplitIndex 1: %v,%v", m, M)
	tp("_chooseSplitIndex 2: %v", nodeString(node))
	//
	//        var i, bbox1, bbox2, overlap, area, minOverlap, minArea, index;
	var i int
	var bbox1, bbox2 *nodeT
	var overlap, area, minOverlap, minArea float64
	var index int
	//
	//        minOverlap = minArea = Infinity;
	minArea = math.Inf(+1)
	minOverlap = minArea
	tp("_chooseSplitIndex 3: %v,%v", minOverlap, minArea)
	//
	//        for (i = m; i <= M - m; i++) {
	for i = m; i <= M-m; i++ {
		tp("_chooseSplitIndex 4: %v", i)
		//            bbox1 = distBBox(node, 0, i, this.toBBox);
		bbox1 = distBBox(node, 0, i, nil)
		tp("_chooseSplitIndex 5: %v", nodeString(bbox1))
		//            bbox2 = distBBox(node, i, M, this.toBBox);
		bbox2 = distBBox(node, i, M, nil)
		tp("_chooseSplitIndex 6: %v", nodeString(bbox2))
		//
		//            overlap = intersectionArea(bbox1, bbox2);
		overlap = intersectionArea(bbox1, bbox2)
		tp("_chooseSplitIndex 7: %v", overlap)
		//            area = bboxArea(bbox1) + bboxArea(bbox2);
		area = bboxArea(bbox1) + bboxArea(bbox2)
		tp("_chooseSplitIndex 8: %v", area)
		//
		//            // choose distribution with minimum overlap
		//            if (overlap < minOverlap) {
		if overlap < minOverlap {
			tp("_chooseSplitIndex 9")
			//                minOverlap = overlap;
			minOverlap = overlap
			//                index = i;
			index = i
			//
			//                minArea = area < minArea ? area : minArea;
			if area < minArea {
				minArea = area
			}
			tp("_chooseSplitIndex 10: %v,%v,%v", minOverlap, index, area)
			//
			//            } else if (overlap === minOverlap) {
		} else if overlap == minOverlap {
			tp("_chooseSplitIndex 11")
			//                // otherwise choose distribution with minimum area
			//                if (area < minArea) {
			if area < minArea {
				//                    minArea = area;
				minArea = area
				//                    index = i;
				index = i
				//                }
			}
			//            }
			tp("_chooseSplitIndex 12: %v,%v", minArea, index)
		}
		//        }
	}
	tp("_chooseSplitIndex 13")
	//
	//        return index;
	return index
	//    },
}

//    // sorts node children by the best axis for split
//    _chooseSplitAxis: function (node, m, M) {
func (this *RBush) _chooseSplitAxis(node *nodeT, m, M int) {
	tp("_chooseSplitAxis 1: %v,%v", m, M)
	tp("_chooseSplitAxis 2: %v", nodeString(node))
	//
	//        var compareMinX = node.leaf ? this.compareMinX : compareNodeMinX,
	//            compareMinY = node.leaf ? this.compareMinY : compareNodeMinY,
	//            xMargin = this._allDistMargin(node, m, M, compareMinX),
	var xMargin = this._allDistMargin(node, m, M, 1)
	tp("_chooseSplitAxis 3: %v", xMargin)
	//            yMargin = this._allDistMargin(node, m, M, compareMinY);
	var yMargin = this._allDistMargin(node, m, M, 2)
	tp("_chooseSplitAxis 4: %v", yMargin)
	//
	//        // if total distributions margin value is minimal for x, sort by minX,
	//        // otherwise it's already sorted by minY
	//        if (xMargin < yMargin) node.children.sort(compareMinX);
	if xMargin < yMargin {
		tp("_chooseSplitAxis 5")
		sort.Sort(byMinX(node.children))
	}
	//    },
}

//    // total margin of all possible split distributions where each node is at least m full
//    _allDistMargin: function (node, m, M, compare) {
func (this *RBush) _allDistMargin(node *nodeT, m, M int, dim int) float64 {
	tp("_allDistMargin 1: %v", nodeString(node))
	tp("_allDistMargin 2: %v,%v", m, M)
	//
	//        node.children.sort(compare);
	for j := 0; j < len(node.children); j++ {
		tp("_allDistMargin A: %v,%v", j, nodeString(node.children[j]))
	}
	switch dim {
	default:
		panic("invalid dimension")
	case 1:
		sort.Sort(byMinX(node.children))
	case 2:
		sort.Sort(byMinY(node.children))
	}
	for j := 0; j < len(node.children); j++ {
		tp("_allDistMargin B: %v,%v", j, nodeString(node.children[j]))
	}
	//
	//        var toBBox = this.toBBox,
	//            leftBBox = distBBox(node, 0, m, toBBox),
	var leftBBox = distBBox(node, 0, m, nil)
	//            rightBBox = distBBox(node, M - m, M, toBBox),
	var rightBBox = distBBox(node, M-m, M, nil)
	//            margin = bboxMargin(leftBBox) + bboxMargin(rightBBox),
	var margin = bboxMargin(leftBBox) + bboxMargin(rightBBox)
	//            i, child;
	tp("_allDistMargin 3: %v", nodeString(leftBBox))
	tp("_allDistMargin 4: %v", nodeString(leftBBox))
	tp("_allDistMargin 5: %v", margin)
	var i int
	var child *nodeT
	//
	//        for (i = m; i < M - m; i++) {
	for i = m; i < M-m; i++ {
		tp("_allDistMargin 6: %v", i)
		//            child = node.children[i];
		child = node.children[i]
		//            extend(leftBBox, node.leaf ? toBBox(child) : child);
		extend(leftBBox, child)
		//            margin += bboxMargin(leftBBox);
		margin += bboxMargin(leftBBox)
		//        }
	}
	//
	//        for (i = M - m - 1; i >= m; i--) {
	for i = M - m - 1; i >= m; i-- {
		tp("_allDistMargin 7: %v", i)
		//            child = node.children[i];
		child = node.children[i]
		//            extend(rightBBox, node.leaf ? toBBox(child) : child);
		extend(rightBBox, child)
		//            margin += bboxMargin(rightBBox);
		margin += bboxMargin(rightBBox)
		//        }
	}
	//
	//        return margin;
	tp("_allDistMargin 8: %v", margin)
	return margin
	//    },
}

//    _adjustParentBBoxes: function (bbox, path, level) {
func (this *RBush) _adjustParentBBoxes(bbox bboxI, path []*nodeT, level int) {
	tp("_adjustParentBBoxes 1: %v", nodeString(this.data))
	tp("_adjustParentBBoxes 2: %v,%v,%v", nodeString(bbox.(*nodeT)), len(path), level)
	//        // adjust bboxes along the given tree path
	//        for (var i = level; i >= 0; i--) {
	for i := level; i >= 0; i-- {
		tp("_adjustParentBBoxes 3: %d: %v", i, nodeString(path[i]))
		//            extend(path[i], bbox);
		extend(path[i], bbox)
		//        }
	}
	tp("_adjustParentBBoxes 4: %v", nodeString(this.data))
	//    },
}

//    _condense: function (path) {
func (this *RBush) _condense(path []*nodeT) {
	//        // go through the path, removing empty nodes and updating bboxes
	//        for (var i = path.length - 1, siblings; i >= 0; i--) {
	var siblings []*nodeT
	for i := len(path) - 1; i >= 0; i-- {
		//            if (path[i].children.length === 0) {
		if len(path[i].children) == 0 {
			//                if (i > 0) {
			if i > 0 {
				//                    siblings = path[i - 1].children;
				siblings = path[i-1].children
				//                    siblings.splice(siblings.indexOf(path[i]), 1);
				index := -1
				for j := 0; j < len(siblings); j++ {
					if siblings[j] == path[i] {
						index = j
						break
					}
				}
				//siblings = append(siblings[:index], siblings[index+1:]...)
				siblings, _ = splice(ncopy(siblings), index, 1)
				path[i-1].children = siblings
				//
				//                } else this.clear();
			} else {
				this.clear()
			}
			//
			//            } else calcBBox(path[i], this.toBBox);
		} else {
			calcBBox(path[i])
		}
		//        }
	}
	//    },
}

/*BIG

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
//};
BIG*/
//function findItem(item, items, equalsFn) {
func findItem(item *nodeT, items []*nodeT) int {
	//    if (!equalsFn) return items.indexOf(item);
	for i := 0; i < len(items); i++ {
		if items[i] == item {
			return i
		}
	}
	//
	//    for (var i = 0; i < items.length; i++) {
	//        if (equalsFn(item, items[i])) return i;
	//    }
	//    return -1;
	return -1
	//}
}

//// calculate node's bbox from bboxes of its children
//function calcBBox(node, toBBox) {
func calcBBox(node *nodeT) {
	//tp("calcBBox 1: %s", nodeString(node))
	//    distBBox(node, 0, node.children.length, toBBox, node);
	distBBox(node, 0, len(node.children), node)
	//}
	//tp("calcBBox 2: %s", nodeString(node))
}

//
//// min bounding rectangle of node children from k to p-1
//function distBBox(node, k, p, toBBox, destNode) {
func distBBox(node *nodeT, k, p int, destNode *nodeT) *nodeT {
	tp("distBBox 1: %v,%v", k, p)
	tp("distBBox 2: %v", nodeString(node))
	//    if (!destNode) destNode = createNode(null);
	tp("distBBox 3: %v", nodeString(destNode))
	if destNode == nil {
		tp("distBBox 4")
		destNode = createNode(nil)
	}
	tp("distBBox 5")
	//    destNode.minX = Infinity;
	destNode.minX = math.Inf(+1)
	//    destNode.minY = Infinity;
	destNode.minY = math.Inf(+1)
	//    destNode.maxX = -Infinity;
	destNode.maxX = math.Inf(-1)
	//    destNode.maxY = -Infinity;
	destNode.maxY = math.Inf(-1)
	//
	//    for (var i = k, child; i < p; i++) {
	tp("distBBox 6: %v", nodeString(destNode))
	var child *nodeT
	for i := k; i < p; i++ {
		//        child = node.children[i];
		child = node.children[i]
		tp("distBBox 7: %v,%v", i, nodeString(child))
		//        extend(destNode, node.leaf ? toBBox(child) : child);
		extend(destNode, child)

		tp("distBBox 8: %v,%v", i, nodeString(destNode))
		//    }
	}
	//
	//    return destNode;
	tp("distBBox 9: %v", nodeString(destNode))
	return destNode
	//}
}

//function extend(a, b) {
func extend(a *nodeT, b bboxI) *nodeT {
	//    a.minX = Math.min(a.minX, b.minX);
	a.minX = math.Min(a.minX, b.MinX())
	//    a.minY = Math.min(a.minY, b.minY);
	a.minY = math.Min(a.minY, b.MinY())
	//    a.maxX = Math.max(a.maxX, b.maxX);
	a.maxX = math.Max(a.maxX, b.MaxX())
	//    a.maxY = Math.max(a.maxY, b.maxY);
	a.maxY = math.Max(a.maxY, b.MaxY())
	//    return a;
	return a
	//}
}

//function compareNodeMinX(a, b) { return a.minX - b.minX; }
func compareNodeMinX(a, b bboxI) float64 { return a.MinX() - b.MinX() }

//function compareNodeMinY(a, b) { return a.minY - b.minY; }
func compareNodeMinY(a, b bboxI) float64 { return a.MinY() - b.MinY() }

//
//function bboxArea(a)   { return (a.maxX - a.minX) * (a.maxY - a.minY); }
func bboxArea(a bboxI) float64 {
	return (a.MaxX() - a.MinX()) * (a.MaxY() - a.MinY())
}

//function bboxMargin(a) { return (a.maxX - a.minX) + (a.maxY - a.minY); }
func bboxMargin(a bboxI) float64 {
	return (a.MaxX() - a.MinX()) + (a.MaxY() - a.MinY())
}

//function enlargedArea(a, b) {
func enlargedArea(a, b bboxI) float64 {
	//    return (Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
	return (math.Max(b.MaxX(), a.MaxX()) - math.Min(b.MinX(), a.MinX())) *
		//           (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY));
		(math.Max(b.MaxY(), a.MaxY()) - math.Min(b.MinY(), a.MinY()))
	//}
}

//
//function intersectionArea(a, b) {
func intersectionArea(a, b bboxI) float64 {
	//    var minX = Math.max(a.minX, b.minX),
	var minX = math.Max(a.MinX(), b.MinX())
	//        minY = Math.max(a.minY, b.minY),
	var minY = math.Max(a.MinY(), b.MinY())
	//        maxX = Math.min(a.maxX, b.maxX),
	var maxX = math.Min(a.MaxX(), b.MaxX())
	//        maxY = Math.min(a.maxY, b.maxY);
	var maxY = math.Min(a.MaxY(), b.MaxY())
	//
	//    return Math.max(0, maxX - minX) *
	return math.Max(0, maxX-minX) *
		//           Math.max(0, maxY - minY);
		math.Max(0, maxY-minY)
	//}
}

//function contains(a, b) {
func contains(a, b bboxI) bool {
	//    return a.minX <= b.minX &&
	return a.MinX() <= b.MinX() &&
		//           a.minY <= b.minY &&
		a.MinY() <= b.MinY() &&
		//           b.maxX <= a.maxX &&
		b.MaxX() <= a.MaxX() &&
		//           b.maxY <= a.maxY;
		b.MaxY() <= a.MaxY()
	//}
}

//function intersects(a, b) {
func intersects(a, b bboxI) bool {
	//    return b.minX <= a.maxX &&
	return b.MinX() <= a.MaxX() &&
		//           b.minY <= a.maxY &&
		b.MinY() <= a.MaxY() &&
		//           b.maxX >= a.minX &&
		b.MaxX() >= a.MinX() &&
		//           b.maxY >= a.minY;
		b.MaxY() >= a.MinY()
}

//function createNode(children) {
func createNode(children []*nodeT) *nodeT {
	//    return {
	return &nodeT{
		//        children: children,
		children: children,
		//        height: 1,
		height: 1,
		//        leaf: true,
		leaf: true,
		//        minX: Infinity,
		minX: math.Inf(+1),
		//        minY: Infinity,
		minY: math.Inf(+1),
		//        maxX: -Infinity,
		maxX: math.Inf(-1),
		//        maxY: -Infinity
		maxY: math.Inf(-1),
		//    };
	}
	//}
}

//// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
//// combines selection algorithm with binary divide & conquer approach
//
//function multiSelect(arr, left, right, n, compare) {
func multiSelect(arr quickSelectArr, left, right, n int) {
	//tp("_multiSelect 1: %d,%d,%d", left, right, n)
	//    var stack = [left, right],
	var stack = []int{left, right}
	//        mid;
	var mid int
	//
	//    while (stack.length) {
	for len(stack) > 0 {
		//        right = stack.pop();
		right = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		//        left = stack.pop();
		left = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		//
		//        if (right - left <= n) continue;
		//tp("_multiSelect 2: %d,%d,%d", len(stack), right, left)
		if right-left <= n {
			//tp("_multiSelect 3: %d", len(stack))
			continue
		}
		//
		//        mid = left + Math.ceil((right - left) / n / 2) * n;
		mid = left + int(math.Ceil(float64(right-left)/float64(n)/2))*n
		//tp("_multiSelect 4: %d,%d", len(stack), mid)
		//        quickselect(arr, mid, left, right, compare);
		quickselect(arr, mid, left, right)

		//
		//        stack.push(left, mid, mid, right);
		stack = append(stack, left, mid, mid, right)
		//    }
	}
	//}
	if false {
		switch nodes := arr.(type) {
		case byMinX:
			for i := 0; i < len(nodes); i++ {
				tp("_multiSelect 5: %d: %s", i, nodeString(nodes[i]))
			}
		case byMinY:
			for i := 0; i < len(nodes); i++ {
				tp("_multiSelect 5: %d: %s", i, nodeString(nodes[i]))
			}
		}
	}
}

func splice(nodes []*nodeT, start, deleteCount int, args ...*nodeT) (
	result []*nodeT,
	deleted []*nodeT,
) {
	if start > len(nodes) {
		start = len(nodes)
	}
	if start+deleteCount > len(nodes) {
		deleteCount = len(nodes) - start
	}
	deleted = nodes[start : start+deleteCount]
	result = append(ncopy(nodes[:start]), args...)
	result = append(result, nodes[start+deleteCount:]...)
	return
}

func count(node *nodeT) int {
	if len(node.children) == 0 {
		return 1
	}
	var n int
	for i := 0; i < len(node.children); i++ {
		n += count(node.children[i])
	}
	return n
}
func nodeString(node *nodeT) string {
	if node == nil {
		return "<nil>"
	}
	sum := nodeSum(node)
	return fmt.Sprintf(`&{children:"%d:%d"`+
		` height:%v`+
		` leaf:%v`+
		` minX:%v`+
		` minY:%v`+
		` maxX:%v`+
		` maxY:%v`+
		`} (%v)`,
		len(node.children), count(node),
		node.height, node.leaf,
		node.minX, node.minY, node.maxX, node.maxY,
		sum[len(sum)-7:],
	)
}

func (this *RBush) jsonString() string {
	var b []byte
	b = append(b, `{`+
		`"maxEntries":`+strconv.FormatInt(int64(this._maxEntries), 10)+`,`+
		`"minEntries":`+strconv.FormatInt(int64(this._minEntries), 10)+`,`+
		`"data":`...)
	b = appendNodeJSON(b, this.data, 1)
	b = append(b, '}')
	return string(b)
}

func appendNodeJSON(b []byte, node *nodeT, depth int) []byte {
	if node == nil {
		return append(b, "null"...)
	}
	b = append(b, '{')
	if len(node.children) > 0 {
		b = append(b, `"children":[`...)
		for i, child := range node.children {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendNodeJSON(b, child, depth+1)
		}
		b = append(b, ']', ',')
	}
	b = append(b, `"leaf":`...)
	if node.leaf {
		b = append(b, "true"...)
	} else {
		b = append(b, "false"...)
	}
	b = append(b, `,"height":`...)
	b = append(b, strconv.FormatInt(int64(node.height), 10)...)
	b = append(b, `,"minX":`...)
	b = append(b, strconv.FormatFloat(node.minX, 'f', -1, 64)...)
	b = append(b, `,"minY":`...)
	b = append(b, strconv.FormatFloat(node.minY, 'f', -1, 64)...)
	b = append(b, `,"maxX":`...)
	b = append(b, strconv.FormatFloat(node.maxX, 'f', -1, 64)...)
	b = append(b, `,"maxY":`...)
	b = append(b, strconv.FormatFloat(node.maxY, 'f', -1, 64)...)
	b = append(b, '}')
	return b
}
func nodeJSONString(n *nodeT) string {
	return string(appendNodeJSON([]byte(nil), n, 0))
}
func nodeSum(n *nodeT) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(nodeJSONString(n))))
}
func ncopy(nodes []*nodeT) []*nodeT {
	return append([]*nodeT(nil), nodes...)
}

var tpon = false
var tpc int
var tpall string
var tpt int
var tlines []string
var tbad = false
var tbadcount = 0
var tbadidx = 0

func tpsum(s string) string {
	hex := fmt.Sprintf("%X", md5.Sum([]byte(s)))
	return hex[len(hex)-4:]
}
func tp(format string, args ...interface{}) {
	if !tpon {
		return
	}
	if tpt == 0 {
		fmt.Printf("\n")
	}
	if tpc == 0 {
		data, _ := ioutil.ReadFile("out.log")
		tlines = strings.Split(string(data), "\n")
	}
	s := fmt.Sprintf(format, args...)
	tpall += s
	s = fmt.Sprintf("%04d:%s %s", tpc, tpsum(tpall), s)
	if !tbad {
		if tlines[tpc] != s {
			fmt.Printf("\x1b[91m\x1b[1m✗ %s\x1b[0m\n", s)
			fmt.Printf("# %s\n", tlines[tpc])
			tbad = true
			tbadcount++
			tbadidx = tpc
		} else {
			fmt.Printf("\x1b[38;5;83m\x1b[1m✓ %s\x1b[0m\n", s)
		}
	} else {
		fmt.Printf("\x1b[91m\x1b[1m✗ %s\x1b[0m\n", s)
		//fmt.Printf("# %s\n", tlines[tpc])
		if tbadcount == 5 {
			os.Exit(0)
		}
		tbadcount++
	}
	tpc++
	tpt++
}
func tpn(format string, args ...interface{}) {
	if tpt == 0 {
		fmt.Printf("\n")
	}
	fmt.Printf("\x1b[92m\x1b[1m✓ %s\x1b[0m\n", fmt.Sprintf(format, args...))
	tpt++
}
func tpq(format string, args ...interface{}) {
	tpn(format, args...)
	return
	if tpt == 0 {
		fmt.Printf("\n")
	}
	fmt.Printf("\x1b[35m\x1b[1m✓ %s\x1b[0m\n", fmt.Sprintf(format, args...))
	tpt++
}

type quickSelectArr interface {
	Swap(i, j int)
	Compare(a, b interface{}) int
	At(i int) interface{}
}

func quickselect(arr quickSelectArr, k, left, right int) {
	for right > left {
		if right-left > 600 {
			var n = right - left + 1
			var m = k - left + 1
			var z = math.Log(float64(n))
			var s = 0.5 * math.Exp(2*z/3)
			var tt = 1
			if m-n/2 < 0 {
				tt = -1
			}
			var sd = 0.5 * math.Sqrt(z*s*(float64(n)-s)/float64(n)) * float64(tt)
			var newLeft = int(math.Max(float64(left), math.Floor(float64(k)-float64(m)*s/float64(n)+sd)))
			var newRight = int(math.Min(float64(right), math.Floor(float64(k)+float64(n-m)*s/float64(n)+sd)))
			quickselect(arr, k, newLeft, newRight)
		}

		var t = arr.At(k)
		var i = left
		var j = right

		arr.Swap(left, k)
		if arr.Compare(arr.At(right), t) > 0 {
			arr.Swap(left, right)
		}

		for i < j {
			arr.Swap(i, j)
			i++
			j--
			for arr.Compare(arr.At(i), t) < 0 {
				i++
			}
			for arr.Compare(arr.At(j), t) > 0 {
				j--
			}
		}

		if arr.Compare(arr.At(left), t) == 0 {
			arr.Swap(left, j)
		} else {
			j++
			arr.Swap(j, right)
		}

		if j <= k {
			left = j + 1
		}
		if k <= j {
			right = j - 1
		}
	}
}

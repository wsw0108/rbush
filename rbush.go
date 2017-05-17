package rbush

import (
	"math"
	"sort"
)

var mathInfNeg = math.Inf(-1)
var mathInfPos = math.Inf(+1)

func mathMin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func mathMax(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

type treeNode struct {
	min, max []float64
	children []interface{}
	leaf     bool
	height   int
}

func (a *treeNode) extend(b *treeNode) {
	for i := 0; i < len(a.min); i++ {
		a.min[i] = mathMin(a.min[i], b.min[i])
		a.max[i] = mathMax(a.max[i], b.max[i])
	}
}

func (a *treeNode) intersectionArea(b *treeNode) float64 {
	var area float64
	for i := 0; i < len(a.min); i++ {
		min := mathMax(a.min[i], b.min[i])
		max := mathMin(a.max[i], b.max[i])
		if i == 0 {
			area = mathMax(0, max-min)
		} else {
			area *= mathMax(0, max-min)
		}
	}
	return area
}
func (a *treeNode) area() float64 {
	var area float64
	for i := 0; i < len(a.min); i++ {
		if i == 0 {
			area = a.max[i] - a.min[i]
		} else {
			area *= a.max[i] - a.min[i]
		}
	}
	return area
}

func (a *treeNode) enlargedArea(b *treeNode) float64 {
	var area float64
	for i := 0; i < len(a.min); i++ {
		if i == 0 {
			area = mathMax(b.max[i], a.max[i]) - mathMin(b.min[i], a.min[i])
		} else {
			area *= mathMax(b.max[i], a.max[i]) - mathMin(b.min[i], a.min[i])
		}
	}
	return area
}

func (a *treeNode) intersects(b *treeNode) bool {
	for i := 0; i < len(a.min); i++ {
		if !(b.min[i] <= a.max[i] && b.max[i] >= a.min[i]) {
			return false
		}
	}
	return true
}
func (a *treeNode) contains(b *treeNode) bool {
	for i := 0; i < len(a.min); i++ {
		if !(a.min[i] <= b.min[i] && b.max[i] <= a.max[i]) {
			return false
		}
	}
	return true
}
func (a *treeNode) margin() float64 {
	var area float64
	for i := 0; i < len(a.min); i++ {
		if i == 0 {
			area = a.max[i] - a.min[i]
		} else {
			area += a.max[i] - a.min[i]
		}
	}
	return area
}

type Item interface {
	Rect() (min, max []float64)
}

type RBush struct {
	dims       int
	maxEntries int
	minEntries int
	data       *treeNode
	reusePath  []*treeNode
}

func New(dims int) *RBush {
	maxEntries := 9
	tr := &RBush{}
	tr.dims = dims
	tr.maxEntries = int(mathMax(4, float64(maxEntries)))
	tr.minEntries = int(mathMax(2, math.Ceil(float64(tr.maxEntries)*0.4)))
	tr.data = createNode(nil, dims)
	return tr
}

func createNode(children []interface{}, dims int) *treeNode {
	n := &treeNode{
		children: children,
		height:   1,
		leaf:     true,
		min:      make([]float64, dims),
		max:      make([]float64, dims),
	}
	for i := 0; i < dims; i++ {
		n.min[i] = mathInfPos
		n.max[i] = mathInfNeg
	}
	return n
}
func fillBBox(item Item, bbox *treeNode) {
	bbox.min, bbox.max = item.Rect()
}
func (tr *RBush) Insert(item Item) {
	if item == nil {
		panic("item is nil")
	}
	min, max := item.Rect()
	if len(min) != len(max) || len(min) != tr.dims {
		panic("item dimensions does not match tree dimensions")
	}
	tr.insertBBox(item, min, max)
}
func (tr *RBush) insertBBox(item Item, min, max []float64) {
	var bbox treeNode
	bbox.min = min
	bbox.max = max
	tr.insert(&bbox, item, tr.data.height-1, false)
}

func (tr *RBush) insert(bbox *treeNode, item Item, level int, isNode bool) {
	tr.reusePath = tr.reusePath[:0]
	node, insertPath := tr.chooseSubtree(bbox, tr.data, level, tr.reusePath)
	node.children = append(node.children, item)
	node.extend(bbox)
	for level >= 0 {
		if len(insertPath[level].children) > tr.maxEntries {
			insertPath = tr.split(insertPath, level)
			level--
		} else {
			break
		}
	}
	tr.adjustParentBBoxes(bbox, insertPath, level)
	tr.reusePath = insertPath
}
func (tr *RBush) adjustParentBBoxes(bbox *treeNode, path []*treeNode, level int) {
	// adjust bboxes along the given tree path
	for i := level; i >= 0; i-- {
		path[i].extend(bbox)
	}
}
func (tr *RBush) split(insertPath []*treeNode, level int) []*treeNode {
	var node = insertPath[level]
	var M = len(node.children)
	var m = tr.minEntries

	tr.chooseSplitAxis(node, m, M)
	splitIndex := tr.chooseSplitIndex(node, m, M)

	spliced := make([]interface{}, len(node.children)-splitIndex)
	copy(spliced, node.children[splitIndex:])
	node.children = node.children[:splitIndex]

	newNode := createNode(spliced, tr.dims)
	newNode.height = node.height
	newNode.leaf = node.leaf

	calcBBox(node, tr.dims)
	calcBBox(newNode, tr.dims)

	if level != 0 {
		insertPath[level-1].children = append(insertPath[level-1].children, newNode)
	} else {
		tr.splitRoot(node, newNode)
	}
	return insertPath
}
func (tr *RBush) splitRoot(node, newNode *treeNode) {
	tr.data = createNode([]interface{}{node, newNode}, tr.dims)
	tr.data.height = node.height + 1
	tr.data.leaf = false
	calcBBox(tr.data, tr.dims)
}
func (tr *RBush) chooseSplitIndex(node *treeNode, m, M int) int {
	var i int
	var bbox1, bbox2 *treeNode
	var overlap, area, minOverlap, minArea float64
	var index int

	minArea = mathInfPos
	minOverlap = minArea

	for i = m; i <= M-m; i++ {
		bbox1 = distBBox(node, 0, i, nil, tr.dims)
		bbox2 = distBBox(node, i, M, nil, tr.dims)

		overlap = bbox1.intersectionArea(bbox2)
		area = bbox1.area() + bbox2.area()

		// choose distribution with minimum overlap
		if overlap < minOverlap {
			minOverlap = overlap
			index = i

			if area < minArea {
				minArea = area
			}
		} else if overlap == minOverlap {
			// otherwise choose distribution with minimum area
			if area < minArea {
				minArea = area
				index = i
			}
		}
	}
	return index
}

func (tr *RBush) chooseSplitAxis(node *treeNode, m, M int) {
	var axis int
	var minMargin float64
	for i := 0; i < tr.dims; i++ {
		margin := tr.allDistMargin(node, m, M, i)
		if i == 0 || margin < minMargin {
			minMargin = margin
			axis = i
		}
	}
	if axis < tr.dims-1 {
		sortNodes(node, axis)
	}
}

type leafByDim struct {
	node *treeNode
	axis int
}

func (arr *leafByDim) Len() int { return len(arr.node.children) }
func (arr *leafByDim) Less(i, j int) bool {
	var a, b treeNode
	fillBBox(arr.node.children[i].(Item), &a)
	fillBBox(arr.node.children[j].(Item), &b)
	return a.min[arr.axis] < b.min[arr.axis]
}
func (arr *leafByDim) Swap(i, j int) {
	arr.node.children[i], arr.node.children[j] = arr.node.children[j], arr.node.children[i]
}

type nodeByDim struct {
	node *treeNode
	axis int
}

func (arr *nodeByDim) Len() int { return len(arr.node.children) }
func (arr *nodeByDim) Less(i, j int) bool {
	a := arr.node.children[i].(*treeNode)
	b := arr.node.children[j].(*treeNode)
	return a.min[arr.axis] < b.min[arr.axis]
}
func (arr *nodeByDim) Swap(i, j int) {
	arr.node.children[i], arr.node.children[j] = arr.node.children[j], arr.node.children[i]
}
func sortNodes(node *treeNode, axis int) {
	if node.leaf {
		sort.Sort(&leafByDim{node: node, axis: axis})
	} else {
		sort.Sort(&nodeByDim{node: node, axis: axis})
	}
}

// allDistMargin sorts the node's children based on the their margin for
// the specified axis
func (tr *RBush) allDistMargin(node *treeNode, m, M int, axis int) float64 {
	sortNodes(node, axis)
	var leftBBox = distBBox(node, 0, m, nil, tr.dims)
	var rightBBox = distBBox(node, M-m, M, nil, tr.dims)
	var margin = leftBBox.margin() + rightBBox.margin()

	var i int

	if node.leaf {
		var child treeNode
		for i = m; i < M-m; i++ {
			fillBBox(node.children[i].(Item), &child)
			leftBBox.extend(&child)
			margin += leftBBox.margin()
		}
		for i = M - m - 1; i >= m; i-- {
			fillBBox(node.children[i].(Item), &child)
			leftBBox.extend(&child)
			margin += rightBBox.margin()
		}
	} else {
		for i = m; i < M-m; i++ {
			child := node.children[i].(*treeNode)
			leftBBox.extend(child)
			margin += leftBBox.margin()
		}
		for i = M - m - 1; i >= m; i-- {
			child := node.children[i].(*treeNode)
			leftBBox.extend(child)
			margin += rightBBox.margin()
		}
	}
	return margin
}
func (tr *RBush) chooseSubtree(bbox, node *treeNode, level int, path []*treeNode) (*treeNode, []*treeNode) {
	var targetNode *treeNode
	var area, enlargement, minArea, minEnlargement float64
	for {
		path = append(path, node)
		if node.leaf || len(path)-1 == level {
			break
		}
		minEnlargement = mathInfPos
		minArea = minEnlargement
		for _, ptr := range node.children {
			child := ptr.(*treeNode)
			area = child.area()
			enlargement = bbox.enlargedArea(child) - area
			if enlargement < minEnlargement {
				minEnlargement = enlargement
				if area < minArea {
					minArea = area
				}
				targetNode = child
			} else if enlargement == minEnlargement {
				if area < minArea {
					minArea = area
					targetNode = child
				}
			}
		}
		if targetNode != nil {
			node = targetNode
		} else if len(node.children) > 0 {
			node = node.children[0].(*treeNode)
		} else {
			node = nil
		}
	}
	return node, path
}

func calcBBox(node *treeNode, dims int) {
	distBBox(node, 0, len(node.children), node, dims)
}
func distBBox(node *treeNode, k, p int, destNode *treeNode, dims int) *treeNode {
	if destNode == nil {
		destNode = createNode(nil, dims)
	} else {
		for i := 0; i < dims; i++ {
			destNode.min[i] = mathInfPos
			destNode.max[i] = mathInfNeg
		}
	}

	for i := k; i < p; i++ {
		ptr := node.children[i]
		if node.leaf {
			var child treeNode
			fillBBox(ptr.(Item), &child)
			destNode.extend(&child)
		} else {
			child := ptr.(*treeNode)
			destNode.extend(child)
		}
	}
	return destNode
}

func (tr *RBush) Search(bbox Item, iter func(item Item) bool) bool {
	if bbox == nil {
		panic("bbox is nil")
	}
	min, max := bbox.Rect()
	if len(min) != len(max) || len(min) != tr.dims {
		panic("bbox dimensions does not match tree dimensions")
	}
	return tr.searchBBox(min, max, iter)
}

func (tr *RBush) searchBBox(min, max []float64, iter func(item Item) bool) bool {
	bbox := treeNode{min: min, max: max}
	if !tr.data.intersects(&bbox) {
		return true
	}
	return search(tr.data, &bbox, iter)
}

func search(node, bbox *treeNode, iter func(item Item) bool) bool {
	if node.leaf {
		for i := 0; i < len(node.children); i++ {
			item := node.children[i].(Item)
			var child treeNode
			fillBBox(item, &child)
			if bbox.intersects(&child) {
				if !iter(item) {
					return false
				}
			}
		}
	} else {
		for i := 0; i < len(node.children); i++ {
			child := node.children[i].(*treeNode)
			if bbox.intersects(child) {
				if !search(child, bbox, iter) {
					return false
				}
			}
		}
	}
	return true
}

func (tr *RBush) Remove(item Item) {
	if item == nil {
		panic("item is nil")
	}
	min, max := item.Rect()
	if len(min) != len(max) || len(min) != tr.dims {
		panic("item dimensions does not match tree dimensions")
	}
	tr.removeBBox(item, min, max)
}

func (tr *RBush) removeBBox(item Item, min, max []float64) {
	var bbox treeNode
	bbox.min = min
	bbox.max = max
	path := tr.reusePath[:0]

	var node = tr.data
	var indexes []int

	var i int
	var parent *treeNode
	var index int
	var goingUp bool

	for node != nil || len(path) != 0 {
		if node == nil {
			node = path[len(path)-1]
			path = path[:len(path)-1]
			if len(path) == 0 {
				parent = nil
			} else {
				parent = path[len(path)-1]
			}
			i = indexes[len(indexes)-1]
			indexes = indexes[:len(indexes)-1]
			goingUp = true
		}

		if node.leaf {
			index = findItem(item, node)
			if index != -1 {
				// item found, remove the item and condense tree upwards
				copy(node.children[index:], node.children[index+1:])
				node.children[len(node.children)-1] = nil
				node.children = node.children[:len(node.children)-1]
				path = append(path, node)
				tr.condense(path)
				goto done
			}
		}
		if !goingUp && !node.leaf && node.contains(&bbox) { // go down
			path = append(path, node)
			indexes = append(indexes, i)
			i = 0
			parent = node
			node = node.children[0].(*treeNode)
		} else if parent != nil { // go right
			i++
			if i == len(parent.children) {
				node = nil
			} else {
				node = parent.children[i].(*treeNode)
			}
			goingUp = false
		} else {
			node = nil
		}
	}
done:
	tr.reusePath = path
	return
}
func (tr *RBush) condense(path []*treeNode) {
	// go through the path, removing empty nodes and updating bboxes
	var siblings []interface{}
	for i := len(path) - 1; i >= 0; i-- {
		if len(path[i].children) == 0 {
			if i > 0 {
				siblings = path[i-1].children
				index := -1
				for j := 0; j < len(siblings); j++ {
					if siblings[j] == path[i] {
						index = j
						break
					}
				}
				copy(siblings[index:], siblings[index+1:])
				siblings[len(siblings)-1] = nil
				siblings = siblings[:len(siblings)-1]
				path[i-1].children = siblings
			} else {
				tr.data = createNode(nil, tr.dims) // clear tree
			}
		} else {
			calcBBox(path[i], tr.dims)
		}
	}
}
func findItem(item Item, node *treeNode) int {
	for i := 0; i < len(node.children); i++ {
		if node.children[i] == item {
			return i
		}
	}
	return -1
}
func (tr *RBush) Count() int {
	return count(tr.data)
}
func count(node *treeNode) int {
	if node.leaf {
		return len(node.children)
	}
	var n int
	for _, ptr := range node.children {
		n += count(ptr.(*treeNode))
	}
	return n
}

func (tr *RBush) Traverse(iter func(min, max []float64, level int, item Item) bool) {
	traverse(tr.data, iter)
}

func traverse(node *treeNode, iter func(min, max []float64, level int, item Item) bool) bool {
	if !iter(node.min, node.max, node.height, nil) {
		return false
	}
	if node.leaf {
		for _, ptr := range node.children {
			item := ptr.(Item)
			var bbox treeNode
			fillBBox(item, &bbox)
			if !iter(bbox.min, bbox.max, 0, item) {
				return false
			}
		}
	} else {
		for _, ptr := range node.children {
			if !traverse(ptr.(*treeNode), iter) {
				return false
			}
		}
	}
	return true
}

func (tr *RBush) Scan(iter func(item Item) bool) bool {
	return scan(tr.data, iter)
}

func scan(node *treeNode, iter func(item Item) bool) bool {
	if node.leaf {
		for _, ptr := range node.children {
			if !iter(ptr.(Item)) {
				return false
			}
		}
	} else {
		for _, ptr := range node.children {
			if !scan(ptr.(*treeNode), iter) {
				return false
			}
		}
	}
	return true
}

func (tr *RBush) Bounds() (min, max []float64) {
	if len(tr.data.children) > 0 {
		return tr.data.min, tr.data.max
	}
	return make([]float64, tr.dims), make([]float64, tr.dims)
}

package rbush

import (
	"math"
	"sort"
)

var (
	mathInfNeg = math.Inf(-1)
	mathInfPos = math.Inf(+1)
)

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

type TreeNode struct {
	Min, Max []float64
	Children []interface{}
	Leaf     bool
	height   int
}

func (a *TreeNode) extend(b *TreeNode) {
	for i := 0; i < len(a.Min); i++ {
		a.Min[i] = mathMin(a.Min[i], b.Min[i])
		a.Max[i] = mathMax(a.Max[i], b.Max[i])
	}
}

func (a *TreeNode) intersectionArea(b *TreeNode) float64 {
	var area float64
	for i := 0; i < len(a.Min); i++ {
		min := mathMax(a.Min[i], b.Min[i])
		max := mathMin(a.Max[i], b.Max[i])
		if i == 0 {
			area = mathMax(0, max-min)
		} else {
			area *= mathMax(0, max-min)
		}
	}
	return area
}

func (a *TreeNode) area() float64 {
	var area float64
	for i := 0; i < len(a.Min); i++ {
		if i == 0 {
			area = a.Max[i] - a.Min[i]
		} else {
			area *= a.Max[i] - a.Min[i]
		}
	}
	return area
}

func (a *TreeNode) enlargedArea(b *TreeNode) float64 {
	var area float64
	for i := 0; i < len(a.Min); i++ {
		if i == 0 {
			area = mathMax(b.Max[i], a.Max[i]) - mathMin(b.Min[i], a.Min[i])
		} else {
			area *= mathMax(b.Max[i], a.Max[i]) - mathMin(b.Min[i], a.Min[i])
		}
	}
	return area
}

func (a *TreeNode) intersects(b *TreeNode) bool {
	for i := 0; i < len(a.Min); i++ {
		if !(b.Min[i] <= a.Max[i] && b.Max[i] >= a.Min[i]) {
			return false
		}
	}
	return true
}

func (a *TreeNode) contains(b *TreeNode) bool {
	for i := 0; i < len(a.Min); i++ {
		if !(a.Min[i] <= b.Min[i] && b.Max[i] <= a.Max[i]) {
			return false
		}
	}
	return true
}

func (a *TreeNode) margin() float64 {
	var area float64
	for i := 0; i < len(a.Min); i++ {
		if i == 0 {
			area = a.Max[i] - a.Min[i]
		} else {
			area += a.Max[i] - a.Min[i]
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
	Data       *TreeNode
	reusePath  []*TreeNode
}

func New(dims int) *RBush {
	maxEntries := 9
	tr := &RBush{}
	tr.dims = dims
	tr.maxEntries = int(mathMax(4, float64(maxEntries)))
	tr.minEntries = int(mathMax(2, math.Ceil(float64(tr.maxEntries)*0.4)))
	tr.Data = createNode(nil, dims)
	return tr
}

func createNode(children []interface{}, dims int) *TreeNode {
	n := &TreeNode{
		Children: children,
		height:   1,
		Leaf:     true,
		Min:      make([]float64, dims),
		Max:      make([]float64, dims),
	}
	for i := 0; i < dims; i++ {
		n.Min[i] = mathInfPos
		n.Max[i] = mathInfNeg
	}
	return n
}

func fillBBox(item Item, bbox *TreeNode) {
	bbox.Min, bbox.Max = item.Rect()
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
	var bbox TreeNode
	bbox.Min = min
	bbox.Max = max
	tr.insert(&bbox, item, tr.Data.height-1, false)
}

func (tr *RBush) insert(bbox *TreeNode, item Item, level int, isNode bool) {
	tr.reusePath = tr.reusePath[:0]
	node, insertPath := tr.chooseSubtree(bbox, tr.Data, level, tr.reusePath)
	node.Children = append(node.Children, item)
	node.extend(bbox)
	for level >= 0 {
		if len(insertPath[level].Children) > tr.maxEntries {
			insertPath = tr.split(insertPath, level)
			level--
		} else {
			break
		}
	}
	tr.adjustParentBBoxes(bbox, insertPath, level)
	tr.reusePath = insertPath
}

func (tr *RBush) adjustParentBBoxes(bbox *TreeNode, path []*TreeNode, level int) {
	// adjust bboxes along the given tree path
	for i := level; i >= 0; i-- {
		path[i].extend(bbox)
	}
}

func (tr *RBush) split(insertPath []*TreeNode, level int) []*TreeNode {
	node := insertPath[level]
	M := len(node.Children)
	m := tr.minEntries

	tr.chooseSplitAxis(node, m, M)
	splitIndex := tr.chooseSplitIndex(node, m, M)

	spliced := make([]interface{}, len(node.Children)-splitIndex)
	copy(spliced, node.Children[splitIndex:])
	node.Children = node.Children[:splitIndex]

	newNode := createNode(spliced, tr.dims)
	newNode.height = node.height
	newNode.Leaf = node.Leaf

	calcBBox(node, tr.dims)
	calcBBox(newNode, tr.dims)

	if level != 0 {
		insertPath[level-1].Children = append(insertPath[level-1].Children, newNode)
	} else {
		tr.splitRoot(node, newNode)
	}
	return insertPath
}

func (tr *RBush) splitRoot(node, newNode *TreeNode) {
	tr.Data = createNode([]interface{}{node, newNode}, tr.dims)
	tr.Data.height = node.height + 1
	tr.Data.Leaf = false
	calcBBox(tr.Data, tr.dims)
}

func (tr *RBush) chooseSplitIndex(node *TreeNode, m, M int) int {
	var i int
	var bbox1, bbox2 *TreeNode
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

func (tr *RBush) chooseSplitAxis(node *TreeNode, m, M int) {
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
	node *TreeNode
	axis int
}

func (arr *leafByDim) Len() int { return len(arr.node.Children) }
func (arr *leafByDim) Less(i, j int) bool {
	var a, b TreeNode
	fillBBox(arr.node.Children[i].(Item), &a)
	fillBBox(arr.node.Children[j].(Item), &b)
	return a.Min[arr.axis] < b.Min[arr.axis]
}

func (arr *leafByDim) Swap(i, j int) {
	arr.node.Children[i], arr.node.Children[j] = arr.node.Children[j], arr.node.Children[i]
}

type nodeByDim struct {
	node *TreeNode
	axis int
}

func (arr *nodeByDim) Len() int { return len(arr.node.Children) }
func (arr *nodeByDim) Less(i, j int) bool {
	a := arr.node.Children[i].(*TreeNode)
	b := arr.node.Children[j].(*TreeNode)
	return a.Min[arr.axis] < b.Min[arr.axis]
}

func (arr *nodeByDim) Swap(i, j int) {
	arr.node.Children[i], arr.node.Children[j] = arr.node.Children[j], arr.node.Children[i]
}

func sortNodes(node *TreeNode, axis int) {
	if node.Leaf {
		sort.Sort(&leafByDim{node: node, axis: axis})
	} else {
		sort.Sort(&nodeByDim{node: node, axis: axis})
	}
}

// allDistMargin sorts the node's children based on the their margin for
// the specified axis
func (tr *RBush) allDistMargin(node *TreeNode, m, M int, axis int) float64 {
	sortNodes(node, axis)
	leftBBox := distBBox(node, 0, m, nil, tr.dims)
	rightBBox := distBBox(node, M-m, M, nil, tr.dims)
	margin := leftBBox.margin() + rightBBox.margin()

	var i int

	if node.Leaf {
		var child TreeNode
		for i = m; i < M-m; i++ {
			fillBBox(node.Children[i].(Item), &child)
			leftBBox.extend(&child)
			margin += leftBBox.margin()
		}
		for i = M - m - 1; i >= m; i-- {
			fillBBox(node.Children[i].(Item), &child)
			leftBBox.extend(&child)
			margin += rightBBox.margin()
		}
	} else {
		for i = m; i < M-m; i++ {
			child := node.Children[i].(*TreeNode)
			leftBBox.extend(child)
			margin += leftBBox.margin()
		}
		for i = M - m - 1; i >= m; i-- {
			child := node.Children[i].(*TreeNode)
			leftBBox.extend(child)
			margin += rightBBox.margin()
		}
	}
	return margin
}

func (tr *RBush) chooseSubtree(bbox, node *TreeNode, level int, path []*TreeNode) (*TreeNode, []*TreeNode) {
	var targetNode *TreeNode
	var area, enlargement, minArea, minEnlargement float64
	for {
		path = append(path, node)
		if node.Leaf || len(path)-1 == level {
			break
		}
		minEnlargement = mathInfPos
		minArea = minEnlargement
		for _, ptr := range node.Children {
			child := ptr.(*TreeNode)
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
		} else if len(node.Children) > 0 {
			node = node.Children[0].(*TreeNode)
		} else {
			node = nil
		}
	}
	return node, path
}

func calcBBox(node *TreeNode, dims int) {
	distBBox(node, 0, len(node.Children), node, dims)
}

func distBBox(node *TreeNode, k, p int, destNode *TreeNode, dims int) *TreeNode {
	if destNode == nil {
		destNode = createNode(nil, dims)
	} else {
		for i := 0; i < dims; i++ {
			destNode.Min[i] = mathInfPos
			destNode.Max[i] = mathInfNeg
		}
	}

	for i := k; i < p; i++ {
		ptr := node.Children[i]
		if node.Leaf {
			var child TreeNode
			fillBBox(ptr.(Item), &child)
			destNode.extend(&child)
		} else {
			child := ptr.(*TreeNode)
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
	bbox := TreeNode{Min: min, Max: max}
	if !tr.Data.intersects(&bbox) {
		return true
	}
	return search(tr.Data, &bbox, iter)
}

func search(node, bbox *TreeNode, iter func(item Item) bool) bool {
	if node.Leaf {
		for i := 0; i < len(node.Children); i++ {
			item := node.Children[i].(Item)
			var child TreeNode
			fillBBox(item, &child)
			if bbox.intersects(&child) {
				if !iter(item) {
					return false
				}
			}
		}
	} else {
		for i := 0; i < len(node.Children); i++ {
			child := node.Children[i].(*TreeNode)
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
	var bbox TreeNode
	bbox.Min = min
	bbox.Max = max
	path := tr.reusePath[:0]

	node := tr.Data
	var indexes []int

	var i int
	var parent *TreeNode
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

		if node.Leaf {
			index = findItem(item, node)
			if index != -1 {
				// item found, remove the item and condense tree upwards
				copy(node.Children[index:], node.Children[index+1:])
				node.Children[len(node.Children)-1] = nil
				node.Children = node.Children[:len(node.Children)-1]
				path = append(path, node)
				tr.condense(path)
				goto done
			}
		}
		if !goingUp && !node.Leaf && node.contains(&bbox) { // go down
			path = append(path, node)
			indexes = append(indexes, i)
			i = 0
			parent = node
			node = node.Children[0].(*TreeNode)
		} else if parent != nil { // go right
			i++
			if i == len(parent.Children) {
				node = nil
			} else {
				node = parent.Children[i].(*TreeNode)
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

func (tr *RBush) condense(path []*TreeNode) {
	// go through the path, removing empty nodes and updating bboxes
	var siblings []interface{}
	for i := len(path) - 1; i >= 0; i-- {
		if len(path[i].Children) == 0 {
			if i > 0 {
				siblings = path[i-1].Children
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
				path[i-1].Children = siblings
			} else {
				tr.Data = createNode(nil, tr.dims) // clear tree
			}
		} else {
			calcBBox(path[i], tr.dims)
		}
	}
}

func findItem(item Item, node *TreeNode) int {
	for i := 0; i < len(node.Children); i++ {
		if node.Children[i] == item {
			return i
		}
	}
	return -1
}

func (tr *RBush) Count() int {
	return count(tr.Data)
}

func count(node *TreeNode) int {
	if node.Leaf {
		return len(node.Children)
	}
	var n int
	for _, ptr := range node.Children {
		n += count(ptr.(*TreeNode))
	}
	return n
}

func (tr *RBush) Traverse(iter func(min, max []float64, level int, item Item) bool) {
	traverse(tr.Data, iter)
}

func traverse(node *TreeNode, iter func(min, max []float64, level int, item Item) bool) bool {
	if !iter(node.Min, node.Max, node.height, nil) {
		return false
	}
	if node.Leaf {
		for _, ptr := range node.Children {
			item := ptr.(Item)
			var bbox TreeNode
			fillBBox(item, &bbox)
			if !iter(bbox.Min, bbox.Max, 0, item) {
				return false
			}
		}
	} else {
		for _, ptr := range node.Children {
			if !traverse(ptr.(*TreeNode), iter) {
				return false
			}
		}
	}
	return true
}

func (tr *RBush) Scan(iter func(item Item) bool) bool {
	return scan(tr.Data, iter)
}

func scan(node *TreeNode, iter func(item Item) bool) bool {
	if node.Leaf {
		for _, ptr := range node.Children {
			if !iter(ptr.(Item)) {
				return false
			}
		}
	} else {
		for _, ptr := range node.Children {
			if !scan(ptr.(*TreeNode), iter) {
				return false
			}
		}
	}
	return true
}

func (tr *RBush) Bounds() (min, max []float64) {
	if len(tr.Data.Children) > 0 {
		return tr.Data.Min, tr.Data.Max
	}
	return make([]float64, tr.dims), make([]float64, tr.dims)
}

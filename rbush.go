package rbush

import (
	"math"
	"sort"
)

const defaultMaxEntries = 9
const DIMS = 2

type nodeT struct {
	min, max [DIMS]float64
	children []*nodeT
	height   int
	leaf     bool
}

type RBush struct {
	_maxEntries int
	_minEntries int
	data        *nodeT
}

type byDim struct {
	arr []*nodeT
	dim int
}

func (v byDim) Len() int {
	return len(v.arr)
}
func (v byDim) Less(i, j int) bool {
	return v.arr[i].min[v.dim] < v.arr[j].min[v.dim]
}
func (v byDim) Swap(i, j int) {
	v.arr[i], v.arr[j] = v.arr[j], v.arr[i]
}

// New returns a new RBush object
func New(maxEntries int) *RBush {
	this := &RBush{}
	// max entries in a node is 9 by default; min node fill is 40% for best performance
	if maxEntries <= 0 {
		maxEntries = defaultMaxEntries
	}
	this._maxEntries = int(math.Max(4, float64(maxEntries)))
	this._minEntries = int(math.Max(2, math.Ceil(float64(this._maxEntries)*0.4)))
	this.clear()
	return this
}

func (this *RBush) all() []*nodeT {
	return this._all(this.data, nil)
}

func (this *RBush) search(bbox *nodeT) []*nodeT {
	var node = this.data
	var result []*nodeT
	if !intersects(bbox, node) {
		return result
	}
	var nodesToSearch []*nodeT
	for node != nil {
		for _, child := range node.children {
			if intersects(bbox, child) {
				if node.leaf {
					result = append(result, child)
				} else if contains(bbox, child) {
					result = this._all(child, result)
				} else {
					nodesToSearch = append(nodesToSearch, child)
				}
			}
		}
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
	}
	return result
}

func (this *RBush) collides(bbox *nodeT) bool {
	node := this.data
	if !intersects(bbox, node) {
		return false
	}
	var nodesToSearch []*nodeT
	var i int
	var len_ int
	var child *nodeT
	var childBBox *nodeT
	for node != nil {
		for i, len_ = 0, len(node.children); i < len_; i++ {
			child = node.children[i]
			childBBox = child
			if intersects(bbox, childBBox) {
				if node.leaf || contains(bbox, childBBox) {
					return true
				}
				nodesToSearch = append(nodesToSearch, child)
			}
		}
		if len(nodesToSearch) == 0 {
			node = nil
		} else {
			node = nodesToSearch[len(nodesToSearch)-1]
			nodesToSearch = nodesToSearch[:len(nodesToSearch)-1]
		}
	}
	return false
}

func (this *RBush) load(data []*nodeT) *RBush {
	if len(data) == 0 {
		return this
	}

	if len(data) < this._minEntries {
		for i, len_ := 0, len(data); i < len_; i++ {
			this.insert(data[i])
		}
		return this
	}
	// recursively build the tree with the given data from scratch using OMT algorithm
	var node = this._build(ncopy(data), 0, len(data)-1, 0)
	if len(this.data.children) == 0 {
		// save as is if tree is empty
		this.data = node
	} else if this.data.height == node.height {
		// split root if trees have the same height
		this._splitRoot(this.data, node)
	} else {
		if this.data.height < node.height {
			// swap trees if inserted one is bigger
			this.data, node = node, this.data
		}

		// insert the small tree into the large tree at appropriate level
		this._insert(node, this.data.height-node.height-1, true)
	}
	return this
}

func (this *RBush) insert(item *nodeT) *RBush {
	if item != nil {
		this._insert(item, this.data.height-1, false)
	}
	return this
}

func (this *RBush) clear() *RBush {
	this.data = createNode(nil)
	return this
}

func (this *RBush) remove(item *nodeT) *RBush {
	if item == nil {
		return this
	}

	var node = this.data
	var bbox *nodeT = item
	var path []*nodeT
	var indexes []int

	var i int
	var parent *nodeT
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
			index = findItem(item, node.children)
			if index != -1 {
				// item found, remove the item and condense tree upwards
				node.children, _ = splice(node.children, index, 1)
				path = append(path, node)
				this._condense(path)
				return this
			}
		}

		if !goingUp && !node.leaf && contains(node, bbox) { // go down
			path = append(path, node)
			indexes = append(indexes, i)
			i = 0
			parent = node
			node = node.children[0]
		} else if parent != nil { // go right
			i++
			if i == len(parent.children) {
				node = nil
			} else {
				node = parent.children[i]
			}
			goingUp = false
		} else {
			node = nil
		}
	}
	return this
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) toJSON() *nodeT {
	return this.data
}

// fromJSON really has nothing to do with JSON. It's just here because JS.
func (this *RBush) fromJSON(data *nodeT) *RBush {
	this.data = data
	return this
}

func (this *RBush) _all(node *nodeT, result []*nodeT) []*nodeT {
	if node.leaf {
		return append(result, node.children...)
	}
	for i := len(node.children) - 1; i >= 0; i-- {
		result = this._all(node.children[i], result)
	}
	return result
}

func (this *RBush) _build(items []*nodeT, left, right, height int) *nodeT {
	var N = right - left + 1
	var M = this._maxEntries
	var node *nodeT
	if N <= M {
		// reached leaf level; return leaf
		node = createNode(ncopy(items[left : right+1]))
		calcBBox(node)
		return node
	}
	if height == 0 {
		// target height of the bulk-loaded tree
		height = int(math.Ceil(math.Log(float64(N)) / math.Log(float64(M))))
		// target number of root entries to maximize storage utilization
		M = int(math.Ceil(float64(N) / math.Pow(float64(M), float64(height)-1)))
	}
	node = createNode(nil)
	node.leaf = false
	node.height = height
	// split the items into M mostly square tiles
	var N2 = int(math.Ceil(float64(N) / float64(M)))
	var N1 = N2 * int(math.Ceil(math.Sqrt(float64(M))))
	var i, j, right2, right3 int
	multiSelect(items, left, right, N1, 1)
	for i = left; i <= right; i += N1 {
		right2 = int(math.Min(float64(i+N1-1), float64(right)))
		multiSelect(items, i, right2, N2, 2)
		for j = i; j <= right2; j += N2 {
			right3 = int(math.Min(float64(j+N2-1), float64(right2)))
			// pack each entry recursively
			child := this._build(items, j, right3, height-1)
			node.children = append(node.children, child)
		}
	}
	calcBBox(node)
	return node
}

func (this *RBush) _chooseSubtree(bbox *nodeT, node *nodeT, level int, path []*nodeT) (
	*nodeT, []*nodeT,
) {
	var targetNode *nodeT
	var area, enlargement, minArea, minEnlargement float64
	for {
		path = append(path, node)
		if node.leaf || len(path)-1 == level {
			break
		}
		minEnlargement = math.Inf(+1)
		minArea = minEnlargement
		for _, child := range node.children {
			area = bboxArea(child)
			enlargement = enlargedArea(bbox, child) - area
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
			node = node.children[0]
		} else {
			node = nil
		}
	}
	return node, path
}

func (this *RBush) _insert(item *nodeT, level int, isNode bool) {
	var bbox *nodeT = item
	var insertPath []*nodeT
	var node *nodeT
	node, insertPath = this._chooseSubtree(bbox, this.data, level, insertPath)
	node.children = append(node.children, item)
	extend(node, bbox)
	for level >= 0 {
		if len(insertPath[level].children) > this._maxEntries {
			insertPath = this._split(insertPath, level)
			level--
		} else {
			break
		}
	}
	this._adjustParentBBoxes(bbox, insertPath, level)
}

// split overflowed node into two
func (this *RBush) _split(insertPath []*nodeT, level int) []*nodeT {
	var node = insertPath[level]
	var M = len(node.children)
	var m = this._minEntries

	this._chooseSplitAxis(node, m, M)

	splitIndex := this._chooseSplitIndex(node, m, M)

	var spliced []*nodeT
	node.children, spliced = splice(node.children, splitIndex, len(node.children)-splitIndex)
	var newNode = createNode(spliced)
	newNode.height = node.height
	newNode.leaf = node.leaf

	calcBBox(node)
	calcBBox(newNode)

	if level != 0 {
		insertPath[level-1].children = append(ncopy(insertPath[level-1].children), newNode)
	} else {
		this._splitRoot(node, newNode)
	}
	return insertPath
}

func (this *RBush) _splitRoot(node *nodeT, newNode *nodeT) {
	this.data = createNode([]*nodeT{node, newNode})
	this.data.height = node.height + 1
	this.data.leaf = false
	calcBBox(this.data)
}

func (this *RBush) _chooseSplitIndex(node *nodeT, m, M int) int {
	var i int
	var bbox1, bbox2 *nodeT
	var overlap, area, minOverlap, minArea float64
	var index int

	minArea = math.Inf(+1)
	minOverlap = minArea

	for i = m; i <= M-m; i++ {
		bbox1 = distBBox(node, 0, i, nil)
		bbox2 = distBBox(node, i, M, nil)

		overlap = intersectionArea(bbox1, bbox2)
		area = bboxArea(bbox1) + bboxArea(bbox2)

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

// sorts node children by the best axis for split
func (this *RBush) _chooseSplitAxis(node *nodeT, m, M int) {
	var xMargin = this._allDistMargin(node, m, M, 0)
	var yMargin = this._allDistMargin(node, m, M, 1)
	// if total distributions margin value is minimal for x, sort by minX,
	// otherwise it's already sorted by minY
	if xMargin < yMargin {
		sort.Sort(byDim{node.children, 0})
	}
}

// total margin of all possible split distributions where each node is at least m full
func (this *RBush) _allDistMargin(node *nodeT, m, M int, dim int) float64 {
	sort.Sort(byDim{node.children, dim})

	var leftBBox = distBBox(node, 0, m, nil)
	var rightBBox = distBBox(node, M-m, M, nil)
	var margin = bboxMargin(leftBBox) + bboxMargin(rightBBox)

	var i int
	var child *nodeT

	for i = m; i < M-m; i++ {
		child = node.children[i]
		extend(leftBBox, child)
		margin += bboxMargin(leftBBox)
	}

	for i = M - m - 1; i >= m; i-- {
		child = node.children[i]
		extend(rightBBox, child)
		margin += bboxMargin(rightBBox)
	}

	return margin
}

func (this *RBush) _adjustParentBBoxes(bbox *nodeT, path []*nodeT, level int) {
	// adjust bboxes along the given tree path
	for i := level; i >= 0; i-- {
		extend(path[i], bbox)
	}
}

func (this *RBush) _condense(path []*nodeT) {
	// go through the path, removing empty nodes and updating bboxes
	var siblings []*nodeT
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
				siblings, _ = splice(ncopy(siblings), index, 1)
				path[i-1].children = siblings
			} else {
				this.clear()
			}
		} else {
			calcBBox(path[i])
		}
	}
}

func findItem(item *nodeT, items []*nodeT) int {
	for i := 0; i < len(items); i++ {
		if items[i] == item {
			return i
		}
	}
	return -1
}

// calculate node's bbox from bboxes of its children
func calcBBox(node *nodeT) {
	distBBox(node, 0, len(node.children), node)
}

// min bounding rectangle of node children from k to p-1
func distBBox(node *nodeT, k, p int, destNode *nodeT) *nodeT {
	if destNode == nil {
		destNode = createNode(nil)
	} else {
		for i := 0; i < DIMS; i++ {
			destNode.min[i] = math.Inf(+1)
			destNode.max[i] = math.Inf(-1)
		}
	}
	var child *nodeT
	for i := k; i < p; i++ {
		child = node.children[i]
		extend(destNode, child)
	}
	return destNode
}

func extend(a *nodeT, b *nodeT) *nodeT {
	for i := 0; i < DIMS; i++ {
		a.min[i] = math.Min(a.min[i], b.min[i])
		a.max[i] = math.Max(a.max[i], b.max[i])
	}
	return a
}

func bboxArea(a *nodeT) float64 {
	v := a.max[0] - a.min[0]
	for i := 1; i < DIMS; i++ {
		v *= a.max[i] - a.min[i]
	}
	return v
}

func bboxMargin(a *nodeT) float64 {
	v := a.max[0] - a.min[0]
	for i := 1; i < DIMS; i++ {
		v += a.max[i] - a.min[i]
	}
	return v
}

func enlargedArea(a, b *nodeT) float64 {
	v := math.Max(b.max[0], a.max[0]) - math.Min(b.min[0], a.min[0])
	for i := 1; i < DIMS; i++ {
		v *= math.Max(b.max[i], a.max[i]) - math.Min(b.min[i], a.min[i])
	}
	return v
}

func intersectionArea(a, b *nodeT) float64 {
	var min = math.Max(a.min[0], b.min[0])
	var max = math.Min(a.max[0], b.max[0])
	v := math.Max(0, max-min)
	for i := 1; i < DIMS; i++ {
		min = math.Max(a.min[i], b.min[i])
		max = math.Min(a.max[i], b.max[i])
		v *= math.Max(0, max-min)
	}
	return v
}

func contains(a, b *nodeT) bool {
	for i := 0; i < DIMS; i++ {
		if a.min[i] > b.min[i] || b.max[i] > a.max[i] {
			return false
		}
	}
	return true
}

func intersects(a, b *nodeT) bool {
	for i := 0; i < DIMS; i++ {
		if b.min[i] > a.max[i] || b.max[i] < a.min[i] {
			return false
		}
	}
	return true
}

func createNode(children []*nodeT) *nodeT {
	n := &nodeT{
		children: children,
		height:   1,
		leaf:     true,
	}
	for i := 0; i < DIMS; i++ {
		n.min[i] = math.Inf(+1)
		n.max[i] = math.Inf(-1)
	}
	return n
}

// sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
// combines selection algorithm with binary divide & conquer approach
func multiSelect(arr []*nodeT, left, right, n int, dim int) {
	var stack = []int{left, right}
	var mid int

	for len(stack) > 0 {
		right = stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		left = stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if right-left <= n {
			continue
		}

		mid = left + int(math.Ceil(float64(right-left)/float64(n)/2))*n
		quickselect(arr, mid, left, right, dim)

		stack = append(stack, left, mid, mid, right)
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

func ncopy(nodes []*nodeT) []*nodeT {
	return append([]*nodeT(nil), nodes...)
}

func quickselect(arr []*nodeT, k, left, right, dim int) {
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
			quickselect(arr, k, newLeft, newRight, dim)
		}

		var t = arr[k]
		var i = left
		var j = right

		qsSwap(arr, left, k)
		if qsCompare(arr, arr[right], t) > 0 {
			qsSwap(arr, left, right)
		}

		for i < j {
			qsSwap(arr, i, j)
			i++
			j--
			for qsCompare(arr, arr[i], t) < 0 {
				i++
			}
			for qsCompare(arr, arr[j], t) > 0 {
				j--
			}
		}

		if qsCompare(arr, arr[left], t) == 0 {
			qsSwap(arr, left, j)
		} else {
			j++
			qsSwap(arr, j, right)
		}

		if j <= k {
			left = j + 1
		}
		if k <= j {
			right = j - 1
		}
	}
}

func qsCompare(arr []*nodeT, a, b *nodeT) int {
	for i := 0; i < DIMS; i++ {
		if a.min[i] < b.min[i] {
			return -1
		}
		if a.min[i] > b.min[i] {
			return +1
		}
	}
	return 0
}
func qsSwap(arr []*nodeT, i, j int) {
	arr[i], arr[j] = arr[j], arr[i]
}
